# Linking today's news to the threads of history

Research for The Olds, 2026-10-28. The question: given one headline (often
short, sometimes not in English, from any country), how do we find the story
it belongs to and explain how it came about — using only open sources at
runtime (Wikipedia, Wikidata) and an optional small on-device model?

APIs below were tried live on 2026-10-28.

## What works, and what we adopted

### 1. Wikipedia's Current events portal (adopted: stage 1)

Editors file each day's news under the ongoing story it belongs to:

```
'''Armed conflicts and attacks'''
*[[Sudanese civil war (2023–present)|Sudanese civil war]]
**The casualty toll from yesterday's drone strike at a market in [[Nyala, Sudan|Nyala]] …
```

- Day pages: `Portal:Current events/2026 October 27` (no zero padding);
  between `<!-- All news items below this line -->` and `… above this line -->`.
- A bold line is a category; bullet depth is the thread hierarchy
  (`*thread` → `**sub-thread or item` → `***item`); a line of only links is a
  thread.
- Fetch 45 days in one call: `action=query&prop=revisions&rvprop=content&rvslots=main&titles=…|…`.
- The portal is an established news → event map: WCEP (Ghalandari et al.,
  ACL 2020, https://aclanthology.org/2020.acl-main.120/) built ~10,000 event
  clusters from it; WikiTimes (Tran & Alrifai, WWW 2014) mined its hierarchy
  into threads.

In The Olds (`main/olds/currentEvents.ts`): a headline is matched to items by
weighted word overlap (names count double; in title-case headlines names come
from the item's own sentence-case text; untranslated headlines need two
matching names). A match gives the thread(s) as strongly preferred topics, a
"Part of …" line in the story, and every dated item under that thread becomes
a step in "How we got here", reaching today.

### 2. TREC News Track background linking (adapted)

Washington Post background linking, 2018–2021. The most effective method was
the simplest: the whole article as a BM25 query (bigIR review,
https://trec.nist.gov/pubs/trec30/papers/QU-N.pdf; SU-NLP found BERT re-ranking
did not beat full text, https://trec.nist.gov/pubs/trec29/papers/SUNLP.N.pdf).
Entity-aware queries helped (UDel, DBpedia Spotlight entities as tokens,
https://trec.nist.gov/pubs/trec29/papers/udel_fang.N.pdf).

In The Olds: every query runs at once, plus the whole headline with
CirrusSearch's `prefer-recent:0.5,30`, and the rankings are fused with
reciprocal rank fusion (Σ 1/(60 + rank)).

### 3. Wikidata event structure (partly adopted)

P361 part of, P527 has part, P155/P156 follows/followed by, P580/P582/P585
dates are dependable on current events; cause properties (P828, P1478, P1542)
are sparse. The Olds follows "followed by" for upcoming events and uses P361 /
P155 / P828 for the path back. To do: choose the path by weakest-link
coherence (Shahaf & Guestrin, "Connecting the dots", KDD 2010,
https://dl.acm.org/doi/10.1145/1835804.1835884) — maximise the minimum
similarity between adjacent steps.

### 4. Entity linking without a large model (adapted)

Commonness + relatedness (Milne & Witten 2008; TAGME for short text): the
MediaWiki API has no anchor statistics, but CirrusSearch ranking (with incoming
links), redirects and Wikidata sitelinks approximate them. Non-English
headlines: translate on device when the language is installed; otherwise match
the headline's own-language Wikipedia titles and show the thread in English via
Wikidata.

### 5. Timelines (adopted in part)

Timeline summarisation (Ghalandari & Ifrim, ACL 2020; Martschat & Markert,
CoNLL 2018): choose dates first, then one or two sentences per date. Best
sources in order: "Timeline of …" articles; dated section headings; Current
events items under the thread; "<year> in <country>" pages; then dated
sentences.

## Skipped

- EventKG (multi-GB dumps, years old) — idea borrowed, data not used.
- GDELT DOC API — rate-limited (one request per 5 s), no thread structure.
- Hosted entity linkers (REL, DBpedia Spotlight, OpenTapioca) — English-only
  or unavailable when tested; not reliable dependencies.

## Still to do (ranked)

1. Three-level result: specific event → ongoing thread → background
   (Current events nesting plus Wikidata P361/P155 walks).
2. Timelines from "Timeline of …" articles and dated section headings first.
3. Weakest-link selection for the path back.
4. Pageview spikes (7-day vs 60-day) as a recency signal.
5. A multilingual embedding model (multilingual MiniLM / e5-small) for
   cross-language similarity.
