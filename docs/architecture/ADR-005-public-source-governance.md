# ADR-005: Public source governance

- Status: Proposed; source review recorded, legal and product decisions open
- Decision owners: project maintainers
- Scope: public records and public aggregates used by the shared frequency field
- Reviewed: 2026-10-23

## Context

The public field currently uses two unlike signals: English Wikipedia article
pageviews and USGS earthquake event records. Neither represents the whole web,
the public's location, truth, importance, or a representative measure of public
opinion. The source adapters are an experimental vertical slice, not approval
to expand or redistribute a source.

This document records the current source behavior and the questions that must
be resolved before these sources are treated as production-governed. It is not
legal advice or legal approval. The current adapters are in
`apps/desktop/src/main/public-field.ts` and
`packages/field-snapshot/src/{wikipedia,usgs,aggregate}.ts`.

## Current source registry

| Registry ID | Source and endpoint | Fields currently used | Current attribution / licence label | Semantics and limits |
|---|---|---|---|---|
| `wiki-geosearch-en` | [English Wikipedia Action API geosearch](https://en.wikipedia.org/w/api.php), `action=query&list=geosearch`; four fixed anchors, `gsradius=10000`, `gslimit=4` | `pageid`, `title`, `lat`, `lon`; emits a link to the English Wikipedia article | Adapter labels the combined record `CC BY-SA 4.0`, attribution `Wikipedia contributors, CC BY-SA 4.0` | Article/page coordinates near a product-chosen anchor; not the viewer's location, article readership location, or proof that the page's topic belongs at that anchor. The topic is assigned from the queried anchor by the adapter. No article body is fetched. |
| `wikimedia-pageviews-en` | [Wikimedia Analytics Pageviews API](https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/{title}/daily/{start}/{end}) | Sums daily `views` values for the matching title. Query uses `en.wikipedia.org`, `all-access`, `user`, daily granularity, and a date range beginning seven days before the request date. | Current combined source record inherits the geosearch adapter's `CC BY-SA 4.0` label and Wikipedia contributor attribution. The Analytics API's current access policy identifies API data as [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). | Page-request counts as defined by Wikimedia's pageview analytics, not unique people, verified human attention, truth, local participation, or importance. `all-access/user` is an API traffic-class selection, not a per-person identity or a guarantee that every request reflects human interest. The count is global; the adapter does not request country breakdowns. A failed/missing per-article response currently becomes a minimum nonzero weight, so no-data and zero-view cases are not distinguishable. |
| `usgs-comcat-m45-week` | [USGS GeoJSON M4.5+ past-week summary feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson) | Feature `id`; geometry longitude/latitude; properties `type`, `mag`, `place`, `url`, and `time`. The adapter keeps earthquake features at magnitude 4.5+, sorts by a derived weight, and retains at most six. | Adapter labels records `Public domain`, attribution `U.S. Geological Survey, public domain`. USGS identifies the [ANSS data and products policy](https://www.usgs.gov/media/files/anss-data-and-products-policy) as Public Domain; verify that the feed and any contributing products are within the cited policy and retain agency attribution. | A physical earthquake event. Magnitude is not a count of interest or public attention. The adapter ignores the feed's `magType` field, uses a bounded transformation of magnitude as weight, and does not encode event uncertainty or revisions. Events are assigned topic `seismic-record`, rather than the Wikipedia topic labels. |

### Implemented collection and refresh behavior

- The main process fetches the field on application startup. Requests use a
  product User-Agent and a 12-second timeout. HTTP 429 receives up to two
  retries with increasing waits. The configured User-Agent identifies the
  product/version but currently has no contact URL or email; Wikimedia's API
  guidance recommends actionable client identification.
- The Wikipedia query checks four hard-coded geographic anchors, requests at
  most four nearby pages per anchor, then makes one pageviews request per page.
  A 400 ms delay follows each anchor batch. The date range is formed as the
  current date and the date seven days earlier; exact inclusive-window meaning
  should be confirmed before the UI calls it a precise seven-day total.
- The USGS feed describes a past-week M4.5+ summary and is updated by USGS every
  minute. Intoponet does not poll at that cadence: a cache younger than six
  hours that includes USGS coverage is reused. If that short-circuit does not
  apply, an expired/missing cache causes a Wikipedia refresh; with a fresh cache
  that lacks USGS coverage, cached Wikipedia records are reused while USGS is
  fetched. Cached records are retained for an individual source when its
  refresh fails.
- A snapshot older than 24 hours is labelled stale. If fetches fail and no
  public snapshot exists, the UI retains the labelled synthetic fixture.
- Aggregation applies recency, geographic relevance to the product anchor,
  diminishing weight for repeated hosts, URL deduplication, and bounded field
  intensity. It is deterministic for a given snapshot and timestamp; it is not
  a privacy-preserving population aggregation or a defense against coordinated
  pageview manipulation. The host-based diminishing factor also treats
  independent USGS events as repeated records from one publisher; review
  whether publisher diversity and event multiplicity should be measured
  separately.

## Attribution and licence review findings

Wikimedia's API policy says licences and attribution can vary by wiki and API;
its content-reuse guide says most Wikipedia articles use CC BY-SA 4.0 but
exceptions exist and reuse should be checked at the source. The Analytics API
access policy separately states that data from that API is CC0 1.0. Therefore
the current single `licence` and attribution values on a combined Wikipedia
record do not accurately express the distinct provenance of geosearch fields
and pageview counts. The product should represent component provenance or
separate the source records before relying on the current label. No legal
conclusion is made here about whether transformed aggregates trigger any
ShareAlike obligation.

For any retained Wikipedia-derived information, keep the article title and a
direct original-source URL available to users, identify the applicable
article/content licence where relevant, and make clear that the displayed
weight is Intoponet's transformation of a Wikimedia metric. Review the
Wikipedia page footer and applicable terms for content being reused; do not
assume a project-wide label covers every page, namespace, or data type.

For USGS, preserve the event URL, agency attribution, event time, magnitude,
and (after review) magnitude type and source update metadata. Do not imply USGS
endorses Intoponet or its scoring. The USGS feed documents event fields and
links to a feed lifecycle policy; ingestion should handle feed updates and
event revisions rather than treating records as immutable facts.

## Proposed registry requirements

Every production source entry must record:

1. Stable registry ID, publisher, exact endpoint/query, data owner, and primary
   documentation/policy links.
2. Exact fields consumed, licence/rights basis per field or component,
   attribution string and source link, retrieval timestamp, and a named
   reviewer/date. Unknown or mixed terms remain marked `review-required`.
3. Measurement meaning, geography and time scope, refresh schedule, expected
   latency, coverage limits, known bias, correction/revision behavior, and
   failure/stale handling.
4. Transformation version, units, bounds, deduplication and grouping rules,
   and how uncertainty/confidence is represented.
5. Whether content is merely linked, cached, displayed, transformed, or
   redistributed; retention and deletion behavior; and any API terms or rate
   limits relevant to the client.

Do not admit a source into the public field solely because it is accessible or
labelled open. A source must have a documented permitted use, an intelligible
measurement, meaningful coverage disclosure, an original-source link, and a
clear place in a measurement category. Do not combine unlike measurements
into an undifferentiated claim of “public interest.”

## ADR-005 decisions still open

1. **Signal policy:** Should article pageviews contribute to a shared field at
   all, and if so should they be presented as Wikimedia article readership
   rather than general or local human interest?
2. **Measurement separation:** Should USGS events remain a distinct objective
   event layer/filter, rather than entering the same intensity scale as
   attention-derived measurements?
3. **Provenance representation:** Should mixed-source records be split, or
   should the schema carry field-level source and rights provenance? How should
   page-level Wikipedia exceptions be resolved?
4. **Attribution UX:** What concise on-field attribution is required, and what
   information must be available in a source inspector for each article/event?
5. **Refresh and windows:** Is a six-hour client refresh acceptable for the
   current feeds? What exact closed/open date interval should “last seven days”
   mean for pageviews and events? How should per-source age be shown when
   cached records are combined into a new snapshot? How should a missing
   pageviews response differ from a real zero count?
6. **Coverage and confidence:** What evidence supports each source's coverage
   and any confidence score? How will the product prevent four fixed anchors
   and global pageview counts from implying local participation?
7. **Manipulation and correction:** What review, anomaly handling, contestation
   and versioning are required before any source-derived signal is described as
   public activity? Should repeated-source diminishing returns apply to
   multiple independent events from the same publisher?
8. **Release review:** Who approves rights/terms, attribution, rate-limit
   compliance (including contactable User-Agent details), retention and
   redistribution for each registry entry, and what evidence is retained for
   that review?

Until these are resolved, treat both adapters as limited experimental public
records. Preserve the distinction between pageviews and earthquake magnitude
in labels, filters, exports, and any later aggregation.

## Primary references consulted

- [Wikimedia APIs: Access policy](https://www.mediawiki.org/wiki/Wikimedia_APIs/Access_policy) — API terms, licence variability, client identification and rate limits.
- [Wikimedia APIs: Content reuse](https://www.mediawiki.org/wiki/Wikimedia_APIs/Content_reuse) — article licence exceptions and attribution guidance.
- [Wikimedia Analytics API: Access policy](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html) — Analytics API data licensing and User-Agent policy.
- [Wikimedia Analytics API: Page views](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html) — pageview definition and automated traffic categories.
- [MediaWiki API: Geosearch](https://www.mediawiki.org/wiki/API:Geosearch) — geosearch fields and query behavior.
- [USGS GeoJSON Summary Format](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) — feed fields, categories and refresh cadence.
- [USGS Feeds and Notifications](https://earthquake.usgs.gov/earthquakes/feed/v1.0/index.php) — developer feed directory and lifecycle policy.
- [USGS ANSS Data and Products Policy](https://www.usgs.gov/media/files/anss-data-and-products-policy) — public-domain designation for covered ANSS data and products.
- [Creative Commons CC BY-SA 4.0 deed](https://creativecommons.org/licenses/by-sa/4.0/deed.en) and [CC0 1.0 deed](https://creativecommons.org/publicdomain/zero/1.0/) — license terms referenced by the source documentation.
