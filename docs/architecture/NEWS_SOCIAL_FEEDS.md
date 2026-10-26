# News and public discussion feed pilot

**Status:** source review registry; one scoped Hinckley metadata pilot admitted
(see decision below), no news or social connector enabled. **Reviewed:** 2026-10-23. This is a bounded pilot sample,
not a representative global directory or legal approval.

The current field adapters remain Wikipedia/Wikimedia and USGS, as described in
[FIELD_PLAN](../FIELD_PLAN.md) and [ADR-005](ADR-005-public-source-governance.md).
This registry records candidate evidence and scoped admission decisions. It follows the topography spec's
sections 4, 16, and 20: record source scope and provenance, make coverage and
uncertainty visible, and treat each connector's availability, terms, rights,
retention, and rate limits as separate checks. The machine-readable entries are
in [public-source-registry.json](../data/public-source-registry.json).

## Candidate registry summary

Direct GET checks on 2026-10-23 returned HTTP 200 for the candidate endpoints
except the Marlborough feed, which returned HTTP 202 with empty HTML and remains
unverified. A successful response is an availability observation, not a
promise of uptime, permission to collect, or a license to display/reuse
content. All records remain `disabled` pending review. The JSON records
response content type and validators observed at check time; missing
`ETag`/`Last-Modified` means no validator was observed in that request.

| Candidate | Language and declared scope | Endpoint and observed result | Terms / rights disposition | Status |
|---|---|---|---|---|
| Halifax Regional Municipality news RSS | `en-CA`; municipal news/releases for Halifax Regional Municipality, Nova Scotia. The publisher's own RSS page offers category feeds. | [`https://www.halifax.ca/news/rss-feed`](https://www.halifax.ca/news/rss-feed), 200, `application/rss+xml`, ETag observed. HRM's [RSS directory](https://www.halifax.ca/home/stay-informed/rss-feeds) describes categories as PSAs, municipal statements, and news releases. | Review required. RSS existence does not establish content reuse rights; no explicit feed reuse license, retention permission, or polling limit was verified. Use only links and minimal metadata if later approved. | Candidate; disabled. Municipal-scale only; no claim that Halifax is a small city. Coverage is the publisher's releases, not all Halifax reporting or resident opinion. |
| Torbay Council media releases | `en-GB`; Torbay Council output for the Torbay local authority area, England. | [`https://www.torbay.gov.uk/news-rss/`](https://www.torbay.gov.uk/council/get-in-touch/rss/), 200, `text/xml`; no validators observed. Council's [RSS page](https://www.torbay.gov.uk/council/get-in-touch/rss/) explicitly lists media releases and permits use of its RSS feeds on a website with “Torbay Council” attribution; it bars reuse of logos/graphics. | Candidate for review. Feed use is expressly described, but the exact scope for this app, caching/retention, transformed aggregate use, and fetch interval are not spelled out. Do not reuse graphics. No rate limit was published on the reviewed page. | Candidate; disabled. Local council source from the UK; covers council communications, not all local reporting. |
| Hinckley & Bosworth Borough Council news RSS | `en-GB`; borough-level council news/press, England. Hinckley is a market town within the borough; feed geography is borough-wide, and story-level location still requires item evidence. | [`https://www.hinckley-bosworth.gov.uk/rss/news`](https://www.hinckley-bosworth.gov.uk/rss/news), 200, `text/xml;charset=UTF-8`; no validators observed. The Council's open-data catalog lists “News and press” and identifies its data feeds as RSS. | Open Government Licence v3.0 applies to the listed transparency data: the Council's [open-data statement](https://www.hinckley-bosworth.gov.uk/opendata) says reuse is allowed without asking permission and requires attribution; the [OGL](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) expressly allows use in an application and commercial/non-commercial reuse. Limit ingestion to Council-provided fields covered by OGL; omit logos, personal data, and identified third-party content. | Planner review ready; disabled. Recommend scoped approval for title, item URL, GUID, publication date, and short description with attribution and source links. |
| New Plymouth District Council news/notices RSS | `en-NZ`; New Plymouth District Council district coverage, New Zealand. Stats NZ classifies New Plymouth as a large regional centre and its functional urban-area dataset reports an urban-core population around 70,599. | [`https://www.npdc.govt.nz/council/news-and-notices-rss/`](https://www.npdc.govt.nz/council/news-and-notices-rss/), 200, RSS 2.0 XML body (server labels response `text/html`); no validators observed. The council describes it as the RSS feed for news and public notices. | Blocked for product display/redistribution without permission. NPDC terms say website content is copyrighted, personal/informational/non-commercial use is allowed, and copying/using other content requires written permission; terms also bar distributing any part of the site to anyone else. RSS access does not override these restrictions. No rate limit or RSS-specific retention terms found. | Candidate; disabled. Useful New Zealand municipal feed for proving the local-scale pathway; not rights-cleared. |
| Marlborough District Council RSS | `en-NZ`; district-wide council news/notices, including the Blenheim urban area. Stats NZ's functional-urban-area methodology reports Blenheim urban core at 26,832 usual residents in the 2018 Census (small-city-scale by population); the feed is district-wide and must not be presented as Blenheim-only. | Official [RSS directory](https://www.marlborough.govt.nz/rss-feeds) lists a combined news/notices/media-release feed at `https://www.marlborough.govt.nz/rss/combined-mdc-news-notices-and-media-releases`. Direct GET returned 202 HTML with no feed body during this check, so current endpoint health is unknown. Official search indexing exposed dated feed entries, but that is not a direct endpoint validation. | Blocked for product display/redistribution without permission. Council terms authorize reproduction only for personal/non-commercial use (or limited site tasks), require attribution/accuracy when disseminated, and exclude third-party material. No polling or retention limit was published. | Candidate; disabled. Small-city-scale coverage example only; endpoint must pass direct validation and rights review before any pilot. |
| NOAA general news RSS | `en-US`; US federal agency material, with subject/topic feeds rather than a guarantee of US-only events. | [`https://www.noaa.gov/rss.xml`](https://www.noaa.gov/rss-feeds), 200, `application/rss+xml`, ETag and Last-Modified observed. NOAA documents this endpoint and says feeds contain headlines, summaries, and links. | Review required per item/source. NOAA says nearly all NOAA content is public domain, but third-party content may appear; credit NOAA/program, avoid implied endorsement, and do not present edits as official. This is not a blanket clearance for every item or embedded asset. | Candidate; disabled. |
| BBC UK news RSS | `en-GB`; UK edition and category label. A publisher edition/category is not proof that every story concerns the UK. | [`https://feeds.bbci.co.uk/news/uk/rss.xml`](https://support.bbc.co.uk/platform/feeds/UkNews.htm), 200, `text/xml`; no validator observed. BBC documents RSS 2.0, stable/live, updated ad hoc often by the minute. | Blocked pending business permission/license. BBC's [feed terms](https://downloads.bbc.co.uk/usingthebbc/bbc_terms_of_use.pdf) say businesses need a metadata license and permission for business use of feeds, possibly for a fee. | Candidate; disabled; do not activate without permission. |
| The Guardian world RSS | `en`; international section, with story-level geography unknown until assessed. | [`https://www.theguardian.com/world/rss`](https://www.theguardian.com/help/feeds), 200, `text/xml`, ETag observed. Guardian says append `/rss` to an index page. | Blocked for this product pending permission: Guardian describes RSS use as personal, non-commercial under its terms. Its terms include RSS and restrict use of site material. No product reuse license verified. | Candidate; disabled; do not activate absent permission. |
| Halifax official Bluesky account feed | `en-CA` account feed; declared publisher is HRM, not a geographic guarantee for each post. Halifax's news page points to `@hfxgov.bsky.social` for municipal PSAs/releases. | [Public `getAuthorFeed` request](https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=hfxgov.bsky.social&limit=1), 200, `application/json`; no validator observed. | Review required. Bluesky's terms say authors retain their content and grant Bluesky a limited license for Bluesky/AT Protocol service use; this does not grant Intoponet a general reuse license. Terms mention special government-user terms. AT Protocol sync guidance discusses timely deletion/account-status handling for mirrors and discourages public bulk redistribution of static repository snapshots; those mirror-specific requirements do not automatically apply wholesale to a bounded author-feed client. The client still needs separate retention/deletion review. Keep this bounded to the official account endpoint; do not consume a full-network firehose. | Candidate; disabled. One institutional account, not public-discussion volume. |

The municipal candidates now span Canada, the UK, and New Zealand. Hinckley &
Bosworth is a practical small-town/local pilot: its current RSS endpoint
returned XML and the Council's open-data statement and catalog identify news
data under OGL. It is borough-wide, so only stories with explicit Hinckley
evidence should be placed at the town. Blenheim's 2018 Census urban-core count
of 26,832 is another small-city-scale example within a district-wide source,
but that endpoint remains unavailable to our direct check. This sample is not
enough to claim national, multilingual, regional, or worldwide coverage. The
ABC (Australia)
is deliberately not listed as a live candidate: its official help page says ABC
RSS feeds are no longer updated, despite legacy feed links still being findable.
That is a useful validator against treating an old RSS URL as an operating
source.

## Source semantics, provenance, and geography

An RSS item is evidence that a publisher emitted an item. It is not evidence of
audience interest, truth, consensus, or the event's location. Preserve distinct
`publishedAt`, publisher `updatedAt` when present, `firstSeenAt`, fetch time,
and event time when separately supported. Do not replace missing publication
time with fetch time. A municipal feed's declared scope is only the publisher's
coverage; a section such as “world” is a feed category, not precise event
geography.

Keep **publisher identity**, **independent reporting origin**, **syndication
lineage**, and **event identity** as separate fields. First collapse exact
duplicate items by stable feed ID/GUID and canonical URL (remove tracking
parameters conservatively). Then cluster same-story copies using explicit
canonical links, wire-service attribution, source links, title/time similarity,
and human-reviewable evidence. Copies of one wire story count as one reporting
origin even when different publishers distribute it. Distinct independent
reporting on one event can add corroboration. A publisher group cap must not
merge separate original stories into one event or treat different outlets under
one owner as independent.

For geography, start with an explicit event/place named by the publisher and
retain the exact evidence span or source field plus confidence. Next use
resolvable linked place entities where their relation to the article is clear.
If only the publisher's desk/declared region is known, record that as coverage
scope rather than event location. Leave global/ambiguous items unlocated.
Never substitute publisher headquarters, an author's profile location, or a
social account's self-described location for where an event happened. The
spec's `about_location` is not `audience_location`.

Social posts are their own activity class. An official account feed measures
what that account published, not broad public discussion. For a future
Mastodon adapter, per-instance public timeline access is configurable and may
be disabled; hashtag/account RSS is available on Mastodon pages, but neither
visibility nor RSS syndication grants author copyright. Mastodon's API docs
also warn that the public timeline can be empty/disabled. Any social adapter
must keep canonical post URL, author/server, post time, language, visibility,
source hash, edit/delete state, and minimal text only when retention/use is
approved. Do not treat likes, boosts, replies, or account follower counts as
independent people or field intensity. AT Protocol sync requirements on
seconds/minutes deletion and account-status handling are written for repository
mirrors. They do not automatically apply wholesale to this bounded
`getAuthorFeed` client candidate; any downstream client's retention and delete
behavior still requires its own terms and design review. This pilot does not
mirror repositories or consume a full-network firehose.

## Proposed polling and retention policy

These are proposed product defaults, not verified source limits. Published
source limits and terms take precedence. An unknown limit does not automatically
require a permission request; use the low-frequency default, observe responses,
and back off on throttling or errors. Keep the source disabled if terms prohibit
the intended use or operational behavior indicates the cadence is unwelcome.

1. The live-field latency target is **2–5 minutes where source policy and
   response behavior permit it**. For an approved RSS/Atom source, use
   conditional requests and target **300 seconds** unless a source publishes a
   stricter cadence. Respect `ETag`/`If-Modified-Since`, `Cache-Control`,
   `Retry-After`, and documented limits. Back off on 429/5xx; do not
   parallelize an unreviewed feed directory. The target is not a claim that
   every publisher allows this interval.
2. For an approved single-account social API, target **300 seconds where
   documented limits and observed responses permit**, and use
   documented pagination/cursors. Do not use firehoses or global timelines as
   a shortcut. If the provider publishes stricter request or retention rules,
   use those or do not connect.
3. Record each fetch outcome, status code, validators, response size, parse
   result, last successful fetch, newest item time, and stale/error state. A
   feed outage means coverage is missing; it must not be shown as falling
   activity. A 200 response with no parseable/new records is not proof of a
   healthy content stream.
4. Initially retain only permitted source metadata, canonical URL, stable item
   ID, timestamps, language, source lineage, rights/provenance note, and a hash
   for deduplication. Do not cache full article text, images, or entire social
   archives unless source-specific rights and retention terms have been
   reviewed. Follow corrections, edits, deletions, takedowns, and account
   deactivation; publish a removal/tombstone in derived data where needed.
5. Use article/post creation or publication time for aging. Keep event time
   separate. Decay must not be driven by fetch time, RSS ordering, or repeated
   syndication. The half-life and normalization should be calibrated in replay
   with source outages and corrections before a live “momentum” claim.

RSS and Atom parsing should accept the supported standard formats, treat all
feed fields as untrusted input, and preserve raw source identity without
executing markup. Robots rules can inform crawler behavior but do not grant
content rights. A feed URL returning 200 also does not grant content rights.

## Admission criteria

A candidate may move from `disabled` to an admitted source only after a named
review records all of the following in the registry:

- Primary source proves the endpoint is intended for reuse/syndication; a
  separate primary terms or license source establishes what the product may
  fetch, store, display, transform, and retain. If any material right or limit
  is unknown, status remains `review_required` or `blocked`.
- Exact feed/API URL, language as BCP 47, declared publisher geography, source
  owner/group, endpoint check date/status/content type, validators, polling
  limit, attribution, known updates/deletions, and expected coverage are
  recorded. `Last-Modified` of the feed is not substituted for each story's
  publication time.
- A controlled replay demonstrates stable item IDs, canonicalization, wire
  duplication vs independent reporting, correction/update/deletion handling,
  source failure/staleness, geography evidence and confidence, and versioned
  reproducible output. Coverage must be disclosed by country, language,
  publisher group, age, and missing sources.
- News coverage, public-account posts, objective civic events, Wikimedia
  pageviews, and USGS magnitude remain distinct measurement kinds. No single
  undifferentiated “interest” score may add their raw counts together.
- No private history, bookmarks, absorbed sources, prompts, local graph,
  embeddings, or implicit browsing data enters the pipeline. A user-published
  Beacon is separate and explicitly consented.

Until these checks pass, the sample documents possible feed plumbing and
coverage only. They do not establish legal approval, broad representativeness,
or that the sources describe “what the Internet is interested in.”

## Source approval evidence recommendations

These source-specific recommendations are for a project planner/maintainer;
they do not activate a connector. Record the reviewer's name, date, exact
fields, and approved transformation in the registry when a decision is made.

| Source | Evidence | Recommended bounded decision |
|---|---|---|
| Hinckley & Bosworth Borough Council | Direct GET returned RSS 2.0 XML. The Council's open data catalog lists “News and press” and says some published data is RSS. Its OGL statement says reuse is allowed without requesting permission and requires attribution. The National Archives OGL v3 permits copying, distributing, adapting, and commercial/non-commercial use, including use in an application. | **Recommend planner approval** for title, description, canonical item URL, GUID, and publication date where fields are Council-provided and not marked third-party/personal. Attribute “Contains public sector information licensed under the Open Government Licence v3.0; source: Hinckley & Bosworth Borough Council” with links to source and licence. Exclude logos and media; geolocate to Hinckley only when item evidence names/locates it. No separate operator request is indicated by the published OGL. |
| Torbay Council | Direct GET returned XML. The RSS page expressly permits feed use on a website with Torbay attribution and excludes logos/graphics, but does not spell out app aggregation, caching, or retention. | Keep review-required for the native app display/cache scope. A named planner can decide whether direct headline/link display fits the published permission. Unknown polling limits alone do not require contacting the operator; start with conditional 300-second requests and back off on 429/5xx. |
| NOAA, BBC, Guardian, New Plymouth, Marlborough | Their distinct terms and endpoint observations are recorded above and in the JSON. BBC business feeds need permission/license; Guardian RSS is for personal non-commercial use; New Plymouth/Marlborough terms restrict reproduction; NOAA has item-level third-party exclusions; Marlborough endpoint health is unknown. | Keep disabled pending a source-specific decision or a more permissive verified basis. Do not generalize one publisher's terms to another. |

The proposed polling target is 2–5 minutes where source policy and responses
permit it. Start at 300 seconds with conditional requests. Published limits,
headers, and throttling take precedence; an unknown published rate limit alone
is not a universal reason to request operator consent.

## Primary evidence

- Halifax, [RSS feeds directory](https://www.halifax.ca/home/stay-informed/rss-feeds) and [news page](https://www.halifax.ca/home/news) — category descriptions; page names Bluesky account for PSAs/releases.
- Torbay Council, [RSS feeds and use notes](https://www.torbay.gov.uk/council/get-in-touch/rss/) — local media-release endpoint and attribution/logo guidance.
- Hinckley & Bosworth Borough Council, [open data](https://www.hinckley-bosworth.gov.uk/opendata), [data catalog](https://www.hinckley-bosworth.gov.uk/info/200346/list_of_our_data), and [News and press RSS](https://www.hinckley-bosworth.gov.uk/rss/news) — reuse statement, feed classification, and endpoint.
- The National Archives, [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) — application reuse, commercial/non-commercial use, attribution, and exclusions.
- New Plymouth District Council, [news/notices RSS](https://www.npdc.govt.nz/council/news-and-notices-rss/) and [terms](https://www.npdc.govt.nz/terms-and-conditions/) — live feed and copyright restrictions.
- Marlborough District Council, [RSS directory](https://www.marlborough.govt.nz/rss-feeds) and [terms](https://www.marlborough.govt.nz/terms-and-conditions-of-use) — district feed and personal/non-commercial reuse limits; endpoint check currently inconclusive.
- Stats NZ, [functional urban areas 2023](https://datafinder.stats.govt.nz/layer/111270-functional-urban-area-2023-generalised/) and [functional urban areas methodology/classification](https://www.stats.govt.nz/assets/Methods/Functional-urban-areas-methodology-and-classification.pdf) — population/classification context for New Plymouth and Blenheim.
- NOAA, [RSS feeds](https://www.noaa.gov/rss-feeds) and [product content FAQ](https://www.noaa.gov/office-education/outreach-communication/faq) — endpoint and qualified public-domain guidance.
- BBC, [feed listing](https://support.bbc.co.uk/platform/feeds/UkNews.htm) and [Terms of Use, section 15](https://downloads.bbc.co.uk/usingthebbc/bbc_terms_of_use.pdf) — format/update description and business permission/license requirement.
- The Guardian, [RSS feed help](https://www.theguardian.com/help/feeds) and [terms of service](https://www.theguardian.com/help/terms-of-service) — personal, non-commercial RSS description and applicable site terms.
- ABC, [why RSS feeds are no longer updated](https://help.abc.net.au/hc/en-us/articles/6147104938383-Why-are-RSS-feeds-no-longer-being-updated) — stale candidate exclusion.
- Bluesky, [getAuthorFeed API reference](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed), [Terms of Service](https://bsky.social/about/support/tos), and AT Protocol [sync specification](https://atproto.com/specs/sync) — public API and content/deletion caveats.
- Mastodon, [public timeline API](https://docs.joinmastodon.org/methods/timelines/), [public data guide](https://docs.joinmastodon.org/client/public/), and [syndication feeds](https://docs.joinmastodon.org/user/network/) — future candidate behavior and instance-dependent access.

Endpoint observations in the JSON were gathered with direct GET requests on
2026-10-23 (America/Halifax review date). Terms and source policy pages were reviewed on that date. HTTP
observations are point-in-time checks and should be re-run before implementation.

## Planner review outcome

Candidate research is complete; multi-country live admission is not. Hinckley
provides a working small-place candidate; Blenheim remains unverified. No source is
enabled, and this research JSON is not the runtime PublicSourceRecord schema:
review notes, nullable proposed settings and point-in-time HTTP observations
must be explicitly mapped into a validated runtime registry after admission.
Generic parser fixtures can proceed without fetching these candidate sources.

## Scoped source admission — 2026-10-23

The project planning agent reviewed Hinckley & Bosworth Council's open-data
statement, the catalog entry for News and press, and OGL v3. Metadata-only pilot
use is admitted: Council-supplied title, canonical URL, GUID and publication
time, with Council/OGL attribution and links. Descriptions, article bodies,
media, logos, personal data and marked third-party material are excluded.
Store rolling metadata/snapshots for 30 days as an initial product policy, not
a provider-imposed limit; corrections and exclusions propagate to derived data.
The 300-second polling floor is provisional and yields to source HTTP directives.
The endpoint remains disabled until parser/fetch/replay QA passes. This decision
is specific to this source/use and does not clear other registry candidates.
Publisher timestamps use UTC while review dates use America/Halifax. Preserve
that distinction; genuinely future-dated values must be flagged rather than
interpreted as current growth.
