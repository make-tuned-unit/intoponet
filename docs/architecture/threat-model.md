# V1 trust boundaries

## Processes and data

| Boundary | Trust | Allowed |
|---|---|---|
| Intoponet main process | Privileged host | Create sandboxed views; validate typed commands |
| Trusted shell renderer | Limited trusted UI | Invoke the allowlisted browser-host API |
| Website renderer | Untrusted | Normal HTTP(S) browsing inside its Chromium sandbox |
| Local browser profile | Private local state | Cookies and site storage in a dedicated partition |
| Public network | Untrusted | Website traffic initiated by Chromium; public-field requests made by the host |
| Local public-field fetcher | Limited host service | Fetch fixed Wikimedia/Wikipedia, USGS and NASA EONET endpoints; parse and aggregate public records; read/write the local snapshot cache |
| Optional shared snapshot client | Limited host service | Fetch `/latest` and its immutable snapshot from one explicitly configured HTTPS origin; validate and cache public-only artifacts |
| Local public snapshot cache | Public local data | Independently collected records and aggregate metadata in the app user-data directory; separate from the private library |
| Shared public snapshot cache | Public local data | Origin-bound, verified shared artifact and manifest in a separate cache file; atomically replaced with user-data permissions |
| Private library | Private local state | Sealed local knowledge records, accessed only by the explicit private-library commands |

The app includes a consent-gated Beacon publisher for private beta and an
optional on-device Laya service backed by Node workers. Laya installs
JavaScript-level guards for selected network APIs, but worker threads are not an
OS network or filesystem sandbox; native bindings and previously captured
references can bypass those guards. The public-field fetcher and optional
shared snapshot client run in the main process, separate from private-library
commands. Website renderers receive no privileged bridge for field data, Laya,
or Beacon publishing, and the field clients have no code path to read the
private library.

## Public-field data flow

Without `INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL`, startup independently requests
data from public sources. `fetchReadingNow` gets Wikimedia's daily most-read
article list for the newest complete UTC day (falling back to the previous
day), then looks up page metadata and coordinates for up to 60 eligible titles
and retrieves the prior day's view counts for comparison. It also requests the
USGS public GeoJSON feed for magnitude 4.5+ earthquakes and NASA EONET natural
events. The available public records become a versioned
`intoponet.field-snapshot.v2` artifact stored at
`<userData>/public-field-snapshot.json`. Wikipedia pageviews are a bounded
weight, USGS records retain a bounded magnitude weight, and EONET records
represent reported natural events. Earthquake magnitude is a physical
measurement, not a human-interest or importance score. The local snapshot
cache is read with a 5 MiB bound and replaced atomically through a temporary
file created with mode `0600`; failed replacements remove the temporary file
and leave the prior cache in place. A cache write failure is surfaced in local
field status while the refreshed snapshot remains available in memory. This
locally generated cache is distinct from the origin-bound shared-artifact
cache described below. Article body text is not fetched or stored, and
private-library data is not an aggregation input.

When `INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL` is configured, the client instead
requests only `/latest` and the immutable artifact named by that manifest. It
validates the HTTPS origin, canonical manifest/path, exact-byte SHA-256, public
record types, attribution, normalized snapshot identity and evaluation time.
It stores the verified artifact in the separate
`<userData>/public-field-shared-snapshot.json` cache, bound to that origin,
atomically replaced, and created with mode `0600`. On a configured-source
failure it may retain that verified shared artifact with an error/stale status;
it does not silently switch to independently computed local data. With no
verified shared cache it returns no public snapshot. The shared client does
not upload browser activity or personal data. Its manifest digest detects
artifact mismatch but is not a publisher signature.

The independent local path retries HTTP 429 responses, applies request
timeouts, and can retain a source's prior records when that source refresh
fails. The UI discloses source coverage and limits. Shared snapshot status
becomes stale after two hours, matching the globe freshness threshold; this
does not authenticate the publisher or make separate RSS/news data identical
across clients. If neither local nor configured shared mode has a usable
snapshot, the renderer may display the clearly labelled synthetic fixture.

### Implemented safeguards

- Local fetch URLs are constructed from fixed Wikimedia, USGS, and NASA EONET
  endpoints. Wikipedia requests use the daily top-article and page-metadata
  APIs; page titles are URL-encoded before those requests.
- Response parsing rejects malformed records, non-finite coordinates, invalid
  weights/required fields and unsupported snapshot schemas. USGS entries must
  be earthquakes of magnitude 4.5 or greater and have an HTTPS source URL.
- Aggregated weights and field displacement are bounded; duplicate source
  records are collapsed by the aggregation layer.
- Only public source metadata and aggregates enter the field snapshot. The
  field API returns the public snapshot, not private-library contents.
- Source attribution and coverage notes distinguish the available public
  records from comprehensive web activity or measures of importance.

### Remaining gaps

- The local fetcher does not authenticate response provenance beyond HTTPS and
  parsing. Its bounded, atomic local cache has no signed manifest or configured
  origin binding because this mode independently assembles source records. A
  compromised upstream or network path could supply misleading local records.
- The optional shared client's digest verifies consistency between the fetched
  manifest and artifact, not who published either one. There is no signature,
  pinned publisher key, reviewed public endpoint, or scheduled shared-ingestion
  operation. Its atomic, origin-scoped cache is distinct from the local cache.
- The Wikipedia path starts from a ranked daily top-article list and retains
  only a bounded set with usable coordinates. It is a narrow, media- and
  language-biased sample, not a privacy-preserving population signal, and is
  not resistant to coordinated pageview manipulation. Pageviews must not be
  presented as representative public opinion or importance.
- Per-source failure can retain old records while the newly generated snapshot
  receives a current creation time. Freshness is therefore snapshot-level and
  can overstate the age of an individual cached source; per-source retrieval
  freshness should be represented explicitly.
- Network errors are logged by message in the host. Review logging and
  outbound traffic during release hardening; do not add browsing URLs, private
  library content or user-specific identifiers to fetches or logs.
- Beacon publishing exists as an explicit private-beta path. Production
  readiness still requires trusted edge abuse limits and reviewed moderation,
  appeals, audit, and retention policies; it must remain separate from private
  library, history, bookmarks, and embeddings.

## Enforced now

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- no preload or privileged bridge in arbitrary website renderers
- an explicit, discriminated command API in `@intoponet/browser-api`
- runtime validation and trusted-shape copying for every IPC command
- HTTP(S)-only in-panel navigation
- site permission prompts for mapped sensitive requests, remembered per origin;
  private-tab decisions stay in memory and unknown requests are denied
- HTTP(S) popup handling: new-tab dispositions become tabs and sized windows
  remain sandboxed but preserve `window.opener`; burst popups are rate-limited
- renderer crash recovery retries the last URL once per tab in a 60-second
  window; a second crash latches automatic recovery off until explicit Reload,
  new navigation or tab close; page form state is not restored
- HTTPS and insecure HTTP origins have distinct, continuously visible states
- no telemetry or cloud model endpoint

## Known gaps before public beta

- IPC parser fuzz/property tests beyond the current malformed-payload cases
- download, WebAuthn, password/autofill and external-protocol policies
- integration evidence for certificate failures, permission prompts/revocation,
  popup navigation/opener behavior, and private-session cleanup
- safe-browsing/malware protection and external-protocol consent
- profile encryption/key management and verification that private-session data
  clears and stays isolated as intended
- packaged GPU-crash and memory-pressure recovery evidence; signed updates,
  Chromium CVE intake and emergency releases. Packaged renderer crash/retry
  behavior has passed the documented installer smoke test.
- license review and independent security assessment. A CycloneDX SBOM,
  artifact inventory and SHA-256 sums are generated and verified for the
  current unsigned DMG; this does not provide license approval or security
  assurance.

Any unsandboxed web content, generic privileged page bridge, undisclosed
transmission of private inference inputs or outputs, or private data in logs
remains a release blocker.

### RSS and news ingestion

The generic `field-snapshot/feed-adapter` and `feed-history` modules are offline
public-data transforms. The main-process `newsService.ts` is wired into the
browser host and uses `feed-service.ts` for the bundled RSS/Atom feed registry.
It stores only approved item metadata (headline, canonical link, GUID and
publication time), not article bodies or media; the feed cache is per device
and independent of the public-field snapshot contract. Feed parsing bounds
XML/body/cache data, rejects DTD/entity expansion and unsafe URLs, preserves
conditional HTTP validators, and applies polling/backoff and no-store rules.
Production requests use HTTPS, same-origin redirects and public-address DNS
preflight; the fetch transport currently resolves again, so this is not a
DNS-pinned defense against rebinding. Registry admission is app configuration,
not proof of publisher rights: source-specific reuse, retention and polling
limits remain governed by the feed-rights review. Arbitrary user-submitted
endpoints are not supported.

History validation rejects unknown/private fields, keeps source health distinct
from activity, excludes missing/future publication times from activity, and
counts explicit syndicated lineage as one qualified origin. These structural
checks do not prove the truth, geography or independence of the source content.
A no-store fetch result must not enter persisted downstream history.

GeoNames imports are public geographic metadata reviewed separately from
interest observations. Importing a place does not establish feed coverage or
human activity there. The independently tested gazetteer extracts currently
live in a temporary development directory and are not read by the browser.
