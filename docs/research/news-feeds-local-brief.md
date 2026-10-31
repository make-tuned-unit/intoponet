# Brief: local news feeds for every state, province, region and major city

Intoponet is a macOS globe browser. When a user flies to a place (a country, a state/province, or a city),
the app shows that place's news, its "peaks" (biggest stories), and what is rising and fading in its
coverage. That only works if the bundled news registry has outlets that cover the place. Today most
countries have just 3 national outlets, so a city or province view is empty. We need local coverage
everywhere people might look.

## What to produce

A candidates file at `docs/research/news-feeds-<slug>-candidates.json`:

```json
{
  "region": "Western Europe (regions and cities)",
  "note": "One line on what this covers.",
  "candidates": [
    {"sourceId":"de-br24","countryCode":"DE","publisherName":"BR24","publisherType":"public-broadcaster",
     "url":"https://www.br.de/nachrichten/feed.xml","geographicScope":"regional","regionName":"Bavaria",
     "cityName":null,"languageTags":["de-DE"],"group":"br"},
    {"sourceId":"de-tagesspiegel-berlin","countryCode":"DE","publisherName":"Tagesspiegel","publisherType":"newspaper",
     "url":"https://www.tagesspiegel.de/contentexport/feed/berlin","geographicScope":"local","regionName":"Berlin",
     "cityName":"Berlin","languageTags":["de-DE"],"group":"tagesspiegel"}
  ]
}
```

Fields:
- `sourceId`: `<cc>-<slug>`, lowercase, unique. Don't reuse ids already in `apps/desktop/src/main/news/newsFeeds.json`.
- `countryCode`: ISO 3166-1 alpha-2.
- `publisherType`: one of `newspaper`, `public-broadcaster`, `broadcaster`, `digital-native`, `news-agency`, `magazine`.
- `geographicScope`: `regional`, for an outlet covering a state, province or region (set `regionName` and leave `cityName` null), or `local`, for an outlet covering a city or metro (set `cityName`, and `regionName` too).
- `regionName` / `cityName`: these must match the app's gazetteer **exactly** (accents and case don't matter). Get the valid names with `node scripts/news-place-names.mjs <CC> [<CC> ...] --cities 60`. If a region isn't listed for a country (the UK, for example, has no regions in the gazetteer), place the outlet on its main city as `local`.
- `languageTags`: BCP 47, for example `["es-MX"]`. Local-language outlets are good, and preferred where they are the real local press.
- `group`: the owning publisher or network, so syndicated copies count as one outlet. For example, all Gannett/USA Today Network papers share `gannett`, and all Reach plc papers share `reach`.

## How to verify

Run `node scripts/add-news-feeds.mjs docs/research/news-feeds-<slug>-candidates.json --dry-run`. It fetches every candidate live and reports rejections. A feed is admitted only if:
- it returns HTTP 200 with RSS or Atom,
- it has at least 3 items,
- its newest item is no more than 7 days old,
- its place name resolves in the gazetteer.

Iterate: replace rejected feeds with working alternatives. Many sites expose `/feed/`, `/rss`, `/feed.xml` or `/rss.xml`, or a `<link rel="alternate" type="application/rss+xml">` tag in their homepage HTML. Fetch the homepage with curl to find it.

**ALWAYS pass `--dry-run`.** Never run the script without it: other agents are working at the same time, and the lead merges every file afterwards. Don't edit any file other than your own candidates file.

## Targets (in priority order)

1. Every first-level subdivision (state, province, region) of each country in your area gets at least one regional outlet, starting with the most populous.
2. The largest cities: aim for at least one local outlet for every city in the gazetteer's top ~20 for big countries, and the capital plus the second city for small ones. Use two outlets for megacities.
3. Prefer feeds that carry general local news, not sports, opinion or business-only sections. A paper's "local"/"city"/"region" section feed is better than its front page when the front page is national.

Skip paywalled-only, Google News proxy, aggregator, government press-release and state propaganda-only feeds. Mainstream state broadcasters (BBC regions, NHK, ABC Australia, etc.) are fine.

## What to report back

At most 10 lines:
- how many candidates pass the dry run and how many fail,
- the file path,
- the countries and regions you couldn't cover, and why.

Aim for roughly 150–350 passing feeds for your area. Quality and correct placement matter more than count.
