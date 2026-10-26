# V1 trust boundaries

## Processes and data

| Boundary | Trust | Allowed |
|---|---|---|
| Intoponet main process | Privileged host | Create sandboxed views; validate typed commands |
| Trusted shell renderer | Limited trusted UI | Invoke the allowlisted browser-host API |
| Website renderer | Untrusted | Normal HTTP(S) browsing inside its Chromium sandbox |
| Local browser profile | Private local state | Cookies and site storage in a dedicated partition |
| Public network | Untrusted | Website traffic initiated by Chromium; public-field requests made by the host |
| Public-field fetcher | Limited host service | Fetch fixed Wikimedia/Wikipedia and USGS endpoints; parse and aggregate public records; read/write the public snapshot cache |
| Public snapshot cache | Public local data | Cached, parsed field records and aggregate metadata in the app user-data directory; no personal library data |
| Private library | Private local state | Sealed local knowledge records, accessed only by the explicit private-library commands |

There is no Beacon publisher or Laya worker. The public-field fetcher runs in
the main process and is separate from the private-library command handlers. The
website bridge has no command for fetching or reading field data, and the field
client has no code path to read the private library.

## Public-field data flow

At application startup the main process calls `loadPublicField`. It requests
geosearch results from the English Wikipedia API near four fixed public topic
anchors (within 10 km, at most four results per anchor), then requests recent
daily pageview totals from Wikimedia's pageviews API for those article titles.
It also requests the USGS public GeoJSON feed for magnitude 4.5+ earthquakes in
the last week. Wikipedia records use recent pageviews as a bounded weight;
USGS records retain place, time, location, source URL and a bounded magnitude
weight. These sources have different meanings: earthquake magnitude is a
physical measurement, not a human-interest or importance score.

The host combines available records into the versioned
`intoponet.field-snapshot.v2` snapshot (migrating cached v1 data on read), writes it to
`<userData>/public-field-snapshot.json`, and sends the serialized snapshot to
the trusted UI. The UI can also request the cached snapshot through the typed
host API. Article body text is not fetched or stored. The private library is
stored separately and is not an input to the aggregation or snapshot API.

The fetcher retries HTTP 429 responses, applies request timeouts, and can keep
cached records for a source when that source refresh fails. A fresh cache with
USGS coverage is reused for six hours; snapshots older than 24 hours are
labelled stale in the UI. The field coverage note identifies the sources,
states that coverage is not the whole web, and says the field is not a measure
of importance. Earthquake records are separately categorized as
`seismic-record`. If no public snapshot is available, the renderer displays
the synthetic fixture field with its synthetic/demo label.

### Implemented safeguards

- Fetch URLs are constructed from fixed Wikimedia and USGS endpoints and fixed
  public anchors; page titles are URL-encoded before requesting pageviews.
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

- The fetcher does not authenticate response provenance beyond HTTPS and
  parsing; it has no signed manifest or pinned source data. A compromised
  upstream or network path could supply misleading public records.
- The snapshot cache is written directly (not atomically); newly created files
  request mode `0644` subject to the process umask, while existing-file mode is
  unchanged. Cache integrity, size limits and corruption recovery beyond
  schema parsing need review. Its contents are public metadata, but this write
  mode and platform behavior have not been hardened for release.
- Fixed anchors and a small set of Wikipedia results provide narrow coverage.
  The aggregation is not a privacy-preserving population signal and is not
  resistant to coordinated pageview manipulation. Pageviews must not be
  presented as representative public opinion or importance.
- Per-source failure can retain old records while the newly generated snapshot
  receives a current creation time. Freshness is therefore snapshot-level and
  can overstate the age of an individual cached source; per-source retrieval
  freshness should be represented explicitly.
- Network errors are logged by message in the host. Review logging and
  outbound traffic during release hardening; do not add browsing URLs, private
  library content or user-specific identifiers to fetches or logs.
- There is no Beacon publisher yet. Any future publisher must be a separate,
  consent-gated boundary and must not receive the private library, history,
  bookmarks or embeddings.

## Enforced now

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- no preload or privileged bridge in arbitrary website renderers
- an explicit, discriminated command API in `@intoponet/browser-api`
- runtime validation and trusted-shape copying for every IPC command
- HTTP(S)-only in-panel navigation
- denied website permission requests during the spike
- popup targets denied with an explicit shell error
- HTTPS and insecure HTTP origins have distinct, continuously visible states
- no telemetry or cloud model endpoint

## Known gaps before public beta

- IPC parser fuzz/property tests beyond the current malformed-payload cases
- download, certificate-error, WebAuthn, password/autofill and popup policies
- safe-browsing/malware protection and external-protocol consent
- profile encryption/key management and private browsing partitions
- crash recovery, signed updates, Chromium CVE intake and emergency releases
- dependency lock/SBOM, license review and independent security assessment

Any unsandboxed web content, generic privileged page bridge, hidden inference
egress, or private data in logs remains a release blocker.

### Public RSS pipeline under construction (2026-10-23)

The generic `field-snapshot/feed-adapter` and `feed-history` modules are offline
public-data transforms. They do not read browser history, Laya, bookmarks or
profile paths. The new main-process `feed-service.ts` is not yet wired into the
browser host. It requires explicit approved/enabled registry entries, bounds
XML/body/cache data, rejects DTD/entity expansion and unsafe URLs, preserves
conditional HTTP validators, and applies polling/backoff and no-store rules.
Production requests use HTTPS, same-origin redirects and public-address DNS
preflight; the fetch transport currently resolves again, so this is not a
DNS-pinned defense against rebinding. Restrict pilot operation to reviewed
publisher endpoints; arbitrary user-submitted endpoints are not supported.

History validation rejects unknown/private fields, keeps source health distinct
from activity, excludes missing/future publication times from activity, and
counts explicit syndicated lineage as one qualified origin. These structural
checks do not prove the truth, geography or independence of the source content.
A no-store fetch result must not enter persisted downstream history.

GeoNames imports are public geographic metadata reviewed separately from
interest observations. Importing a place does not establish feed coverage or
human activity there. The independently tested gazetteer extracts currently
live in a temporary development directory and are not read by the browser.
