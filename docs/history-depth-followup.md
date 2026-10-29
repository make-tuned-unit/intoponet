# Historical depth follow-up — 29 October 2026

The 28 October saved-thread audit found **47 of 80** histories still limited. It also showed that exact earlier-election pages can add useful dated context (for example, the Israeli election timelines include 1949, 1984, 1992, 2014 and 2020). The audit is a screening pass over saved topics; it does not establish complete history coverage. See [the audit](feature-verification/timeline-context-2026-10-28.json) and [feature verification](FEATURE_VERIFICATION.md).

## Bounded improvement

Historical expansion already recognizes earlier editions when a linked background article names them. It did not inspect the current event article itself for those same explicit edition links. That left a systematic gap for dated event-series pages that link to past editions directly but have no separate background article pointer.

The Olds expansion now scans the root article's wikitext for exact same-series earlier-edition titles before following any background-article links. It keeps the existing rules: the year-prefixed series name must match exactly, the edition must be at least six years old, only up to three edition pages are fetched, and the normal six-entry historical-context cap and source attribution still apply. The added regression case includes a same-year unrelated election title to ensure a shared year and subject word do not qualify it.

This uses dated passages from the linked Wikipedia edition pages and labels each with its source title. It does not infer relationships or add general country history. Cache version v16 makes saved threads recompute under the new lookup. The change may help only when the current page explicitly links exact prior editions; it does not resolve the remaining 47 audit flags by itself. The saved-thread audit was not rerun for this follow-up, so no new coverage count is claimed.
