# RSS observation freshness verification — 2026-10-29

## Findings and changes

- Persisted coverage previously began at an item's publication timestamp. A successful RSS response does not prove that the service observed the feed during the item's whole publication history. Coverage now begins at the first successful poll and extends only between subsequent successful polls.
- A failed poll or a `no-store` response clears in-process continuity. A later success starts a new observation point instead of bridging across the outage or app restart. An in-process pause longer than the three-poll/tolerance bound (90 minutes with the current 20-minute cadence) also starts a new point.
- A `304 Not Modified` with `Cache-Control: no-store` now returns `persistenceAllowed: false`. It purges retained feed items and validators as before, and the news service does not add persisted coverage or retain no-store headlines from that result in its transient map.
- Stored coverage intervals remain historical observations, but country and place Rising/Fading comparisons now require a currently healthy feed. Stale/error feeds do not count toward comparable or healthy feed totals.
- `news-coverage.json` now uses schema version 2. Unversioned intervals from the older publication-date inference are discarded. When the service supplies a coverage map, missing intervals cannot fall back to old publication timestamps; place trends likewise require an interval. This deliberately means about two days of successful polling are needed before a feed can support a full 48-hour comparison again.
- Cached `news-digest.json` payloads carry the same coverage provenance version and are emitted at startup only when that marker and the digest schema validate and the generated timestamp is within the existing 90-minute coverage tolerance (no more than 60 seconds in the future). Legacy or expired computed digests are withheld until the service publishes a fresh one; the feed item cache is retained. Clock rollback clears future-dated intervals before recording a new observation.

## Verification

Focused command:

```sh
npm run test --workspace @intoponet/desktop -- src/main/feed-service.test.ts src/main/news/newsService.test.ts src/shared/news/newsDigest.test.ts src/shared/news/placeTrends.test.ts
```

Result: 4 test files passed, 47 tests passed. Regression cases cover no-store 304 purging and persistence permission, first-observation timestamps, continuity breaks after failure/no-store/long pauses/clock rollback, legacy coverage and cached-digest invalidation, stale feeds with old full-window coverage, and place-level trend exclusion.

`npm run typecheck --workspace @intoponet/desktop` completed without reported diagnostics.

## Limits

This verifies feed-fetch/cache behavior and the trend comparability rules; it does not establish source availability, feed licensing, geographic representativeness, or global public-opinion coverage. The feed health state is the service's current fetch-state signal. A healthy poll only confirms an HTTP/feed response, not the accuracy or completeness of its publisher's reporting. RSS remains an independent news signal from reading-volume data.
