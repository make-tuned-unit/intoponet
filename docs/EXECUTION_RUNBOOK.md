# Execution runbook

The [machine-readable DAG](./EXECUTION_DAG.json) is the current queue. The
earlier [delivery DAG](./DELIVERY_DAG.md) explains the original phase breakdown;
this queue adds the missing release, provenance, Laya, and verification work.
The [field plan](./FIELD_PLAN.md) records the field semantics and required RSS/news/social ingestion path.
The [living topography specification](<INTOPONET_LIVING_FREQUENCY_TOPOGRAPHY_SPEC (1).md>)
v1.1 is mapped to nodes through `specRefs`; its visual and global coverage
requirements are required acceptance criteria, not implemented features.
Run `npm run dag -- status`, `npm run dag -- ready`, or
`npm run dag -- show NODE_ID`. `npm run dag -- check` rejects duplicate IDs,
missing dependencies, cycles, invalid states, and verified nodes without
evidence.

## How to run a wave

1. The planner selects ready nodes whose files and runtime do not conflict.
   A worker receives one node, the relevant PRD/spec sections, allowed files,
   acceptance check, and instruction to report exact evidence. Use low-cost
   workers for bounded code, test, docs, and benchmark-harness tasks. The
   planner handles ADRs, product policy, source licences, security judgments,
   and final gate reviews.
2. Mark assigned nodes `active`. Workers may implement and test, but do not
   mark their own node `verified`. The planner reviews the diff, runs the
   relevant tests, reproduces native/security claims when needed, and records
   the evidence path or command outcome before changing the status.
3. If acceptance is partial, keep the node active or split it into smaller
   dependencies. An external blocker stays `blocked` with the exact missing
   condition. A verified node may unlock successors only after the evidence is
   independently checked.
4. Re-run `npm run dag -- check` and the repository quality checks at each
   integration point. A passing unit suite does not close native browser,
   accessibility, performance, privacy, or public-release gates.

## Current wave and critical path

The crash recovery on 2026-10-24 found the uncommitted implementation intact.
The planner assigned three bounded tasks to cheaper workers: `FIELD_DYNAMICS`,
`FIELD_TILES`, and `PLACE_HIERARCHY`. Workers implement and test; the planner
reviews corrections and records evidence before changing gate status.

The indexed place runtime now has bounded lookup, paginated child traversal,
version reconciliation and safe pointer publication. Full-size runtime evidence
and desktop navigation remain outstanding. Texture work includes coherent LODs,
separate clocks and provenance-preserving transitions; visual acceptance remains
open. Publication dynamics now has reviewed deduplication, corroboration, caps and
coverage-aware comparison, with replay regressions. Live coverage-window
evidence and hierarchy rollup/count conservation remain outstanding. The JSON
contains the current verification details.

At this integration point the planner reran all 186 workspace tests, all
typechecks, the production build and diff checks successfully. Chrome lab
readback matched CPU texture samples at Earth and city scales, and a snapshot
transition advanced with the decorative phase frozen. This is not native-host
performance or visual acceptance. The three parent nodes remain active because
their complete acceptance criteria have not yet passed.

Latest workspace validation on 2026-10-25 passed all **194 tests across six
workspaces**, typecheck in all **seven workspaces**, and the production build.
The native synthetic topic-origin preview shows Bolivia at 50% (3 visits, 3×
baseline), Italy at 33% (2 visits, 2×), and unknown at 17% (1 visit); the real
personal field has no origin-country provider and reports no country breakdown.
Topic assignment remains manual. Visual/material acceptance and the 60 FPS target
remain open.

On 2026-10-26 the membrane renderer was revised: the relief is spec-bounded,
contours are per pixel with LOD, the atmosphere was added, and data-tied
motion layers were added. The workspace now passes **222 tests**, typecheck
and the production build. Evidence is recorded in the
[design review](./FREQUENCY_DESIGN_REVIEW.md#living-contour-revision-checkpoint--2026-10-26).
Visual acceptance and the 60 FPS target remain open.

Also on 2026-10-26, the browser shell gained two features:

- **A search bar in the full-screen dock.** It stays open while you type and
  opens with ⌘L.
- **A right-side Bookmarks pane** with accordion groups backed by
  Collections (MEM-004). Groups can be created, renamed, deleted and
  reordered by drag. A current-page save card is included, and ⇧⌘B and ⌘D
  are forwarded even from a focused page.

The page view glides aside as the pane opens: its bounds are streamed from
a CSS transition. The dock's page edge uses a 240 ms ease-out tween that
the dock animation matches. Reduced motion and reduced transparency are
honoured. Real-window evidence is in `experiments/shell-ui-qa/evidence`.
Hands-on VoiceOver review and keyboard drag alternatives remain open.

Page captures were also added on 2026-10-26.

- **What it does.** The browser toolbar's Capture button (or ⇧⌘S, even
  from a focused page) freezes the visible page under a glass crop
  overlay. From there you can save a PNG screenshot or start a silent
  recording of the selected area.
- **Recording.** Recordings come from the page's own compositor frames,
  cropped in the main process and encoded on-device as WebM. No OS
  screen-recording permission is needed, and no other window is captured.
- **Storage.** Captures are encrypted at rest with AES-256-GCM. A
  per-library key is sealed by safeStorage (Keychain). Media is served only
  to the app window, over a private `intoponet-capture://` scheme.
- **Organization.** Captures share groups with bookmarks (Collections). The
  pane shows them as thumbnail grids with an All / Pages / Captures filter
  and drag-to-move. A viewer offers copy, export, open source and delete.
- **Deletion.** "Delete library" now also deletes captures and their key.

Not covered yet:

- recording audio;
- full-page (scroll) capture;
- a keyboard alternative to drag between groups;
- a VoiceOver review.

The shell revision that followed changed several things:

- **Captures move to Finder.** Captures are now ordinary PNG/WebM files in
  `~/Pictures/Intoponet/<Group>/`, with readable names. Folders rename with
  their groups, and captures from deleted groups move to `Unsorted`. Finder
  renames and moves are followed by inode. Groups, the toast and the viewer
  each offer one-click "Show in Finder". Earlier encrypted captures migrate
  once. Trade-off: files you can open in Finder are not app-encrypted;
  they rely on FileVault.
- **Favicon tab rail in panel mode.** A rail replaces the tab row under
  the browser panel; the user chose it after a tab-UI research review. It
  expands on hover and the page glides aside, because native views cannot
  be overlaid. It can be pinned as vertical tabs and is a keyboard tablist.
  Rail, panel and bookmarks pane now share top and bottom edges.
- **Full-screen toolbar tucks away.** In full screen the toolbar collapses
  to a 10px rail, revealed on hover. The traffic lights hide with it.
- **Secondary tools fold away.** Copy, find, print, pin and absorb fold into
  a hover "more" cluster in both modes.
- **Network privacy on by default.** DNS-over-HTTPS (Quad9 and Mullvad, in
  automatic mode) and WebRTC limited to the public interface. The status
  shows in the protection panel. There is no VPN tunnel yet (user decision):
  the UI states that sites can still see the public IP.

The living-globe revision (also 2026-10-26) advances `SIGNAL_PRESENTATION`
and `FIELD_EXPERIENCE` without claiming either gate:

- **Live public layers.** Three admitted sources now feed the field and
  refresh while the app runs: English Wikipedia's daily most-read articles
  (only those with their own coordinates), USGS M4.5+ earthquakes from the
  past week, and NASA EONET open natural events. Each is its own layer and
  measurement kind, and each is ranked only against itself. See
  [Field plan](FIELD_PLAN.md) and the source registry.
- **The globe is explorable.** Glowing markers coloured by layer, with
  collision-free labels for the strongest visible signals and a hover card.
  A click flies the camera there and opens an inspector: measurement,
  observed time, rank in layer, summary, provenance, Open source, Save
  (bookmark plus map pin) and Nearby.
- **Layer card.** Public/Mine, per-layer toggles with counts, a
  Day/Week/Month window, My pins visibility, and an "About this data"
  popover with coverage and attribution. The default view is Public.
- **Fly to places.** The launcher suggests places from a bundled GeoNames
  directory (244 countries, 2,551 cities, 295 regions; CC BY 4.0). An exact
  name or "fly to …" flies; anything else still searches the web. The list
  becomes "Near <place>".
- **Accessible alternative (EXP-008).** The side list is a keyboard-operable,
  non-spatial view of the same signals.
- Evidence: `experiments/shell-ui-qa/evidence/globe-*.png`, from
  `scenario-globe.mjs`.

**Local news for every country (2026-10-26).** A fourth layer shows what
each country's own outlets are publishing:

- 451 verified RSS/Atom feeds from 209 countries and territories. Parallel
  research checked each feed live for freshness and domestic focus. Public
  broadcasters and agencies came first, then major independent outlets.
  Large countries also have a city outlet.
- The only gap is Kiribati.
- Registry and evidence: [`docs/data/news-feeds.json`](data/news-feeds.json),
  built by `scripts/build-news-feeds.mjs`.
- Only headline, link, id and publish time are kept, for 3 days. Polling is
  every 20 minutes with conditional requests and backoff. Feeds that send
  `Cache-Control: no-store` are kept in memory only, never on disk.
- Placement:
  - A story goes to a city only when its headline names a city of that
    country, or the feed is a declared city outlet.
  - Otherwise it counts at country scale.
  - Accented names must match with accents ("Pará" never matches "para").
  - The publisher's location is never used.
- Brightness ranks each country's stories per feed over 48 h within this
  layer only.
- Engineering fixes needed for real-world feeds:
  - A tolerant pre-pass (`sanitizeFeedXml`) strips bodies and media and
    repairs entities and prefixes before the strict parser. Entity
    declarations are still refused.
  - Declared charsets are honoured.
  - The private-address guard wrongly blocked all of 192.0.0.0/16, including
    WordPress VIP news hosts. Only 192.0.0.0/24 and 192.0.2.0/24 are
    reserved now, and TEST-NET-2/3 are added.
  - The membrane input is capped at the texture work budget. Previously, more
    than 488 signals crashed the globe.
- In a cold start, 402 of 451 feeds were healthy and 188–207 countries had
  news within about a minute. Evidence: `experiments/shell-ui-qa/evidence/news-*.png`
  (`scenario-news.mjs`, renderer-only captures).
- Open:
  - Per-source terms review (`SOURCE_APPROVAL`); the research found no stated
    RSS terms for any outlet.
  - State-affiliated outlets are labelled in the registry, but not yet in the UI.
  - Many "latest" feeds mix in world news.
  - Momentum between windows.
  - Syndication de-duplication across countries.

**Rising and fading, The Olds and Absorb (2026-10-26).**

- **Rising and fading (FRQ-003):**
  - Each country's distinct stories in the last 24 h are compared with the
    24 h before, counting only *comparable* feeds: those whose observed
    coverage spans both windows (tracked as intervals in
    `news-coverage.json`).
  - Formula: (recent − previous) ÷ (recent + previous + 4). The result is
    null when coverage is missing or there are fewer than 4 stories, so a gap
    never reads as fading.
  - Wikipedia most-read is compared with the previous day; an article absent
    from the previous day's list shows as "new". Quakes and natural events
    show "new" within 24 h.
  - Momentum feeds the membrane's existing warm/cool tint.
  - The panel has Top / Rising / Fading tabs, trend chips, and a trend line
    with its counts in the inspector.
  - *Rising worldwide* lists terms used by outlets in at least 3 more
    countries today than yesterday, judged on comparable feeds only.
    Proper-noun evidence comes from capitalisation in sentence-case
    headlines. Selecting a term dims every country that didn't use it.
- **The Olds (OLD-001..006):**
  - Threads come from Wikidata statements only: follows / followed by,
    replaces / replaced by (sequence only), has cause, has immediate cause,
    has effect, influenced by, significant event, participant in, conflict,
    part of, location, and history of topic.
  - For countries, it also uses the parts of their "History of …" item, plus
    a time-boxed query for well-documented dated events.
  - Deprecated statements are skipped. A "statement disputed by" qualifier
    marks the edge disputed. Citations come from statement references.
  - The UI is a timeline sheet with a list view. Each card shows its relation
    and epistemic status, with "Sequence only: this does not say one caused
    the other". The detail panel shows the statement, its references and
    "Follow this thread", with a back trail.
  - Entry points: the history button on Wikipedia and country news signals.
- **Absorb and Knowledge (ABS-001..006, LAY-001/003 without a model):**
  - Extraction runs in an isolated world on the active page. Navigation and
    back matter (references, notes, external links) are skipped, and form
    values are never read.
  - Sensitive pages are refused before or after extraction: sign-in,
    account, payment, bank, health, messages, password or card fields, and
    tokens in the URL.
  - The preview shows the stored text, extracted names, places and dates
    (each removable), the scope (article or selection) and a note.
  - Storage is AES-256-GCM under an OS-keychain key in `userData/knowledge`.
  - Search is offline BM25 returning the best paragraph per page, with a
    ¶ citation; the reader opens at the cited paragraph.
  - Absorbed places appear only on the private *Mine* globe.
  - "Delete everything" also clears knowledge.
- Evidence: `experiments/shell-ui-qa/evidence/{trends,olds,absorb,knowledge}-*.png`
  (`scenario-olds-absorb.mjs`).
- Open:
  - Wikidata coverage is uneven: many items have no relations and most
    statements have no references (the UI says so).
  - Large-country event queries can take about 10 s cold (cached for 7 days).
  - Knowledge has no embeddings or Laya model yet.
  - Absorb selection mode is tested only through the UI path.
  - Momentum needs about 48 h of observed coverage after a fresh install.

**Laya v1 (2026-10-26).** Optional, on-device, off by default (LAY-001..006).

- **Model and runtime:**
  - Turning it on downloads `sentence-transformers/all-MiniLM-L6-v2` (Apache-2.0, 91 MB) at a pinned revision.
  - Each file is checked against a pinned SHA-256 before use.
  - Inference is a pure-JavaScript MiniLM forward pass and WordPiece tokenizer, so there are no new npm dependencies. Its outputs match the published sentence-transformers reference.
  - It runs in worker threads with network modules stubbed to throw (tested) and no file access.
- **Storage:** embeddings are encrypted with the knowledge key.
- **Features:**
  - Hybrid word and meaning search, fused by reciprocal rank.
  - Related pages.
  - Themes, using deterministic k-means.
  - **Ask:** extractive only. It returns quoted passages with ¶ citations and a match strength, never generated text.
- **UI:** an opt-in card in Knowledge, progress while downloading and indexing, a Search/Ask switch, theme chips, and "Related in your knowledge".
- **Measured:** indexing three long articles took about 100 s on this Mac, and queries return in about 0.1 s. Evidence: `evidence/laya-*.png` (`scenario-laya.mjs`).
- **Open:**
  - English-only model.
  - Indexing is slow for very long pages.
  - No generative answers. This is deliberate until a local LLM is evaluated.

The Mine globe now has a *Your places* panel listing pins and absorbed pages with their places. Absorbed Wikipedia pages also open The Olds from the Knowledge reader.

Open on this slice: momentum and change between windows (needs comparable
window evidence); news/RSS layers (registry approval); city-scale geometry; a
VoiceOver review; and the Olds, Absorb extraction and Laya, which are still stubs.

Next: review field visibility and the ten synthetic scenes; verify the full-size
place index and connect bounded lookup to navigation; connect trusted window
coverage to dynamics and prove count-preserving geography rollups before tiles.

The previously verified public-ingestion pilot retrieved 50 Hinckley metadata
items. No new desktop startup feed is enabled. Remaining sources require their
own evidence-based use decisions. Use `npm run dag -- ready` for the current
dependency-derived queue.

The living-field path is:

```text
INTEREST_CONTRACT → FIELD_GEOMETRY_KERNEL → FIELD_TILES → FIELD_GEOMETRY
                                             └──────────────→ FIELD_SYNTHETIC_GATE
                                                   ├→ FIELD_VISUAL_QA
                                                   └→ FIELD_PIPELINE
SOURCE_CANDIDATE_RESEARCH + INTEREST_CONTRACT → FEED_ADAPTERS
FEED_REGISTRY + FEED_ADAPTERS → FEED_FETCH ──────────→ FEED_REPLAY_QA
                    └→ FEED_HISTORY → EVENT_GEOGRAPHY → FIELD_DYNAMICS
                                                        ├→ FEED_REPLAY_QA
                                                        └→ SIGNAL_PRESENTATION
FEED_REPLAY_QA + SOURCE_APPROVAL → FIELD_PIPELINE
FIELD_PIPELINE + FIELD_VISUAL_QA + SIGNAL_PRESENTATION → SOURCE_SHADER_PROOF
SOURCE_SHADER_PROOF + PLACE_HIERARCHY → GLOBAL_FEED_EXPANSION
GLOBAL_FEED_EXPANSION + EARTH → GLOBAL_COVERAGE_QA
SOURCE_SHADER_PROOF → PUBLIC_DISCUSSION
SOURCE_SHADER_PROOF + GLOBAL_COVERAGE_QA + PUBLIC_DISCUSSION → FIELD_HARDENING
G1 + SOURCE_SHADER_PROOF + SIGNAL_PRESENTATION → FIELD_EXPERIENCE
FIELD_EXPERIENCE + FIELD_HARDENING → G2
```

This diagram summarizes the field path; the JSON contains all dependencies.
Sections 15–20 refine the earlier A–G order: preserve the visual shell, prove
synthetic data-to-geometry and tiles, deliver a bounded RSS vertical slice,
then expand globally and add richer public discussion signals. Registry
research and fixture parsers can advance independently of engine selection;
a large ingestion backend must wait for the synthetic gate. The new written
spec supplies the visual target; access to the shared chat is not a blocker.

The planner reviews all ten synthetic scenes, then witnesses a controlled RSS
item becoming a tile and visible deformation. Measure receipt-to-index ≤60s
and qualified-change-to-tile 30–60s under stated normal workloads; 2–5-minute
RSS polling applies only where allowed. These are targets, not promises of
worldwide live coverage. Material phase never invents interest; meaningful
snapshot transitions take roughly 10–30 seconds.

Global addressability is distinct from observation coverage. A versioned place
hierarchy must expose its scope and gaps, and unsupported cities remain
addressable with insufficient coverage. Source-specific rights checks precede
connector implementation/activation; approving one source need not wait for
unrelated sources. GDELT is complementary, RSS/local reporting foundational,
and Beacons still require their separate consent and abuse gates.

The browser path remains measured compositor/security evidence → `G0` →
selected-host `SHELL`, `EARTH`, `PROTECTION_RULES` → `G1`. The private store and
public historical corpus can advance independently; Absorb needs the selected
host and local store. No previously verified node is promoted to compliance
with the new spec merely because earlier tests passed.

The blocker on `PROTECTION_RULES` is licence and attribution review for filter
lists and any new engine dependency. The blocker on `BEACON_ABUSE` is the
privacy and moderation decision in ADR-006. Community connectivity is a
separate research track and does not gate browser release.
`SOURCE_APPROVAL` remains blocked until a named maintainer resolves ADR-005's
rights, API terms, provenance and measurement decisions for each admitted
component.
`G0_BENCH` also remains blocked until the matched runs can be performed on a
verified 60/120 Hz display with hands-on IME, VoiceOver, media and packaging
coverage; workers can improve the harness in parallel.
`G0_SECURITY_TESTS` remains blocked until CEF has a comparable browser policy
host, packaged tests, and the decisions in ADR-007 have owners.

On-device translation was added on 2026-10-26 (PRD §12, LAY-001/005).

- **Models.** Mozilla's Firefox Translations models (MPL-2.0): 57 languages,
  each in both directions with English. Pairs that do not include English
  pivot through it. `scripts/build-translation-catalog.mjs` pins every file
  (model, shortlist, vocabularies) and the bergamot-translator 3.0 WebAssembly
  engine by size and SHA-256 into `apps/desktop/src/main/translate/catalog.json`.
  Files download only when the user adds a language (typically 48–142 MB, with
  the size shown first). Every file is re-verified each time it loads.
- **Engine.** Firefox's unmodified Emscripten glue (v0.6.0, vendored with its
  licence) runs in a worker thread with network stubs. Text never leaves the
  device.
- **Pages.** A translate button in the toolbar shows a dot when the page's
  language differs from yours. Detection uses the page's declared language,
  then its writing system, then common words. The bar translates the visible
  text first and flips between the original and the translation.
- **Page safety.** The page scripts run in an isolated world. Inline markup is
  reduced to bare markers. Engine output is parsed inertly, and only its text
  is used: the page's own elements are moved back into place, so links and
  listeners survive. Restoring is exact.
- **Headlines.** Globe headlines carry their feed's language and have an
  Original / your-language toggle.
- **Knowledge export.** "Export library" also writes absorbed pages as
  schema.org JSON-LD (`intoponet-knowledge.jsonld`) with paragraph-indexed
  text, places and notes (PRD §8.4).
- **Verified so far.** Unit tests cover the catalog, routing, detection,
  pinned download and tamper refusal, the engine protocol, batching, page
  orchestration and cancellation. The page script was run against a real
  page with a stand-in translator. It reordered tags without losing a link's
  listener, dropped an injected `<img onerror>`, and restored byte-identical
  HTML. The in-app UI evidence is `translate-bar-es.png` and
  `translate-languages.png`.
- **Engine verified.** On real models, Spanish → English gives "The
  president announced new economic measures to combat inflation in the
  country." Japanese → French pivots through English. Markers survive word
  reordering. Throughput is about 570 words/s on one thread.
- **In the app.** Adding Spanish (79 MB) and translating the whole es.wikipedia
  "Aurora polar" article took 22 s, links and formatting intact. Flipping to
  the original and back took 0.8 s, served from cache. Evidence:
  `translate-page-en.png` and `translate-page-original.png`.
- **Open.** Form placeholders and other attributes stay in the original. A
  space can be lost next to skipped inline elements such as `<code>`. Dynamic
  content added after translating is left untranslated.

Day and night and an easier way into The Olds were added on 2026-10-26.

- **Day & night.** The globe is lit by the real sun. The subsolar point comes
  from the standard low-precision solar ephemeris
  (`renderer/src/earth/sun.ts`, tested at solstices, the equinox, the
  equation of time and day/night at four cities) and refreshes every 30 s.
  The day side shows Blue Marble in its natural colour, lit by the sun, with
  daylit sea in blue and a soft sheen toward the sun. The night side is deep
  navy with NASA Black Marble 2016 city lights (public domain), and a faint
  twilight band marks the terminator. Each place's details and hover card
  say whether it is daytime there (with the sun's height), dawn, dusk or
  night. The atmosphere's glow follows
  the same sun. A Day & night toggle in the layer card restores the evenly lit
  studio globe and is remembered.
- **The Olds.** A header button opens The Olds for what you're looking at:
  the selected signal, the focused place, or the country nearest the centre
  of the view (read from the live camera). The place panel's clock icon is now
  a labelled History button.
- **Evidence.** `daynight-americas-night.png`, `daynight-twilight-mexico.png`,
  `daynight-sunlit-pacific.png`, `daynight-sun-there-japan.png` and
  `olds-from-header.png`.

The Olds gained chapters and time navigation on 2026-10-26.

- **Chapters.** Country threads now follow the place's Wikipedia "History of
  …" article. Each section becomes a chapter with its dates (from the heading,
  or marked c. from the years its text names), its first sentences and its
  "Main article" link. Those main articles (for Greenland: Norse settlements,
  Danish colonisation, Greenland in World War II, Greenlandic independence,
  the Greenland crisis) join the timeline as cited events.
- **Filtering.** Events are dropped when "country" is their only link to the
  place and they are trivial there: eclipses, sports entries, or events
  stated for three or more countries (such as the 2022 mpox outbreak).
- **Navigation.** The timeline can be dragged and scrolled with a wheel or
  trackpad, and responds to ←/→/Home/End. Earliest and Now buttons appear at
  its edges. The chapter band highlights the era in view, and clicking a
  chapter jumps to it and shows its summary, the article link, and a follow
  button for its main article.
- **Cache.** The Olds cache key is now versioned (v2), so older threads are
  refetched.
- **Evidence.** `olds-greenland-chapters.png` and `olds-greenland-crisis.png`.
  The parser has unit tests. Live checks covered Greenland, Kenya and Japan.

News-to-history paths, Olds source checks and place-aware pinning were added
on 2026-10-26.

- **The history behind a story.** Every headline has a History button.
  The headline is matched to a Wikipedia topic: words and names are searched,
  then events in the outlet's country are preferred, while far-away topics,
  names the headline never uses, calendar units and whole states are
  penalised. Headlines in other languages are first translated on this Mac
  when the language is installed. From the topic, the path follows Wikidata
  "has cause", "part of", "follows" and "replaces" links back through dated
  events (up to four steps). It is set in the country's current history
  chapter and shown oldest → today in a new Story view, with other plausible
  topics to switch to.
  - Live checks:
    - Sudan: the civil war ← the 2019 transition ← the 2019 coup ← the
      Sudanese revolution.
    - Ukraine: the 2022 invasion ← the Russo-Ukrainian war ← the
      Revolution of Dignity ← Euromaidan.
    - Taiwan: the Fourth Taiwan Strait Crisis ← the Pelosi visit.
    - Greenland: the Greenland crisis ← the proposed US acquisition.
  - When nothing matches, the story is placed in the country's history with
    a note explaining why.
- **Source checks.** Every Olds link records its support:
  - **referenced**: the Wikidata statement cites a source;
  - **Wikipedia only**: its only reference is "imported from Wikimedia
    project";
  - **unreferenced**;
  - **article**: it comes from a history chapter.

  It also records whether the other side is named in the root's Wikipedia
  article text. The Timeline shows a well-sourced / corroborated / unverified
  summary and a "Hide unverified" filter. Every detail panel explains the
  check. Most Wikidata history statements carry no reference, and the
  corroboration check makes that visible instead of hiding it.
- **Pin location.** The pin editor suggests places named in the page's
  title, address and absorbed text (`placesNamedIn`) and pre-fills the best
  one, marked "Suggested from this page". Saving confirms it, per MEM-007.
  The location dropdown is replaced by a typeahead over GeoNames places and
  places used before, with keyboard support. Coordinates remain a fallback.
- **Evidence.** `olds-story-kenya.png`, `olds-source-checks.png`,
  `pin-place-suggested.png` and `pin-place-search.png`. Unit tests cover
  headline matching, scoring, corroboration and place detection.
- **Open.**
  - Matching without translation is weak for scripts without capital
    letters.
  - Wikidata often has no cause or part-of links for very recent topics, so
    those paths stop at the topic.

World stories, ranking tooltips and context cards were added on 2026-10-26.

- **Tooltips.** The World, Top, Rising and Fading tabs, every list row and
  every trend chip explain what is ranked and how. Each layer is ranked only
  against itself, so Top is not a global ranking.
- **International desks.** `scripts/build-international-feeds.mjs` checks
  candidates live. Admission requires HTTP 200, at least 5 items, and the
  newest item within 3 days. 31 of 39 passed: BBC, DW, France 24 (FR/ES/AR),
  RFI, NPR, SBS, CNA, Al Jazeera, Euronews, Africanews, Sky, UN News, the
  Guardian, the NYT, Le Monde, El País, Der Spiegel, Folha, SCMP, Times of
  India, Dawn, Japan Times, Yonhap, ANSA, Middle East Eye, Premium Times,
  MercoPress, g1 and Infobae. Failures are recorded with reasons in
  `docs/data/international-feeds.json`. These desks are fetched first. They
  feed world stories only and are never counted as a country's local news.
- **World stories** (`shared/news/globalStories.ts`).
  - **Method.** A story is a pair of names or keywords shared by headlines
    from at least 3 countries or desks and at least 3 independent outlets in
    24 hours. Overlapping pairs, and clusters led by the same name, merge.
  - **Counting.** Countries are counted from local outlets, and desks are
    counted separately.
  - **Ranking.** By countries, then desks, then outlets.
  - **Title.** An English headline that names the story, from a desk where
    possible.
  - **Live run.** From 227 healthy feeds: Brazil's election (26 countries,
    22 desks), the Ballon d'Or, James Comey's charges, Machado's return to
    Venezuela, Netanyahu and Iran, Ebola, Macron and the protests, Jordan's
    strikes on Syria, and Vučić ousted in Serbia.
  - **In the app.** Stories expand to one headline per outlet across
    countries, highlight those countries on the globe, and open "The history
    behind it" in The Olds.
- **Wikipedia In the news.** Editor-curated major stories from the REST
  featured feed, refreshed every 2 hours. Each links its main article, and
  History opens The Olds on that article.
- **Context card.** A country's news panel opens with "The bigger picture":
  the chapter of its history it is in now, from the Wikipedia history
  article, and recent connected events worth exploring, each opening The
  Olds. Headlines in languages without a model now say so (e.g. Papiamento).
- **Evidence.** `world-stories.png`, `world-in-the-news.png` and
  `context-*.png`. Unit tests cover clustering, thresholds, tokenising and
  In the news parsing.
- **Open.** Names are recognised by capitalisation, so Arabic, Chinese and
  other scripts without capitals rarely join world clusters unless the same
  story is also covered in cased scripts.

Peaks were made legible on 2026-10-26.

- **Rename.** "Top" is now "Peaks": the tallest peaks on the globe, one type
  of data at a time.
- **Peak score.** Each item's peak is its rank inside its own layer, scaled
  from the layer's lowest item (0) to its highest (100).
- **In the app.** Every row in the list has a five-bar peak meter. The
  details panel shows "Peak N of 100" and a "Why it peaks" line with the
  measure and the item's place in its layer, for example "#1 of 145
  countries" or "#7 of 37 mapped most-read articles". It also says what the
  measure is not (newsroom activity ≠ world attention; magnitude ≠ coverage).
- **Legend.** The layer card has a peaks legend: low, mid and high marker
  samples (brightness and rings) on a scale, plus each colour and what it
  measures.
- **Natural hazards.** Earthquakes (USGS) and NASA EONET events are one
  "Natural hazards" group with one toggle. Both colours appear in the legend,
  and About explains why quakes are included and how they peak.
- **Evidence.** `peaks-legend.png` and `peaks-why.png`.

Layer card and hazard links were simplified on 2026-10-26.

- **Compact layer card.** The card rests as three stacked icons (Local news,
  Reading now, Natural hazards); clicking an icon toggles that layer. Hover
  or keyboard focus expands it to the full card: Public/Mine, the peaks
  legend, the time window and About.
- **Pins and day/night.** "My pins" left the card: pins always show and are
  managed from My map. Day & night is now a standard, always-on feature.
- **Hazard links.** NASA EONET sometimes cites raw agency files, such as a
  hurricane centre's `.tcw` advisory, which downloads instead of opening.
  Natural hazards now open "Read about it" (Wikipedia) and "Satellite view"
  (NASA Worldview at that place and date). The agency file stays available
  as a labelled secondary link ("Agency data file (downloads)"). Any other
  source that is a data file falls back to Wikipedia.
- **Evidence.** `layers-compact.png`, `layers-expanded.png` and
  `hazard-links.png`.

Chapters, context, Ask, favicons and glass were reworked on 2026-10-27,
validated across countries rather than single examples.

- **Chapter key events.** Clicking a chapter in The Olds loads that chapter's
  own key events: the dated events its section of the Wikipedia history
  article (and its subsections) links to. Links inside references and
  templates are ignored. Only things that happened (a point in time or a
  start time) are kept, so publishers, universities, cities and
  organisations are not. A chapter too new to have linked events says so and
  offers the chapter before. "Show all" returns to the full history.
- **Current chapter.** Chapters whose own heading says they ended long ago
  ("President de Gaulle, 1958–1969", "Chattha State (1750–1797)") are never
  treated as current. Long articles (Russia has 60+ sections) keep top-level
  eras and dated subsections, so they reach the present.
- **Summaries.** Abbreviations ("r. 927–969", "c. 800 BCE", "i.e.", "St.")
  no longer end sentences. Galleries, map code and bare image lines are
  removed. Non-narrative sections (timelines, image galleries, "history by
  region") are skipped.
- **Resilience.** Wikidata and Wikipedia requests retry rate limits up to
  four times, respecting retry-after. A country thread whose history article
  could not be fetched is shown but marked partial and not cached, so the
  next open retries. Previously a transient 429 cached a chapterless thread
  for a week. The Olds cache is at v5.
- **Context card.** It now leads with key facts from Wikidata (population,
  capital, leaders, GDP in USD, language). Then come names behind today's
  headlines: recurring names in the country's headlines, translated first
  when the language is installed. Each opens The Olds in that country's
  context; for example, Ukraine for Russia opens Russia–Ukraine relations.
  Last comes recent history, from Wikidata's recent events or, failing
  that, the dated events of the latest chapters. The card no longer
  overflows the panel.
- **Ask.** Answers now fuse meaning with the question's own words
  (paragraph-level BM25, reciprocal rank fusion). Weak, single-word matches
  are ignored. With one or two pages absorbed, several passages per page are
  shown, so a paragraph that states the answer verbatim is not missed.
- **Favicons.** `main/faviconCache.ts` stores site icons as data URLs, taken
  from pages you visit or from the site's own `/favicon.ico` (no cookies,
  never a third-party icon service). Bookmarks and My map lists show them,
  with monograms only as a fallback.
- **Glass.** Every reading panel (the details panel, The Olds, Knowledge,
  Absorb, Bookmarks, My map, About) uses the same strong glass. My map's tabs
  fit one row and its Export / Delete buttons are styled.
- **Audit.** A live audit of all 244 countries drove these fixes. Failures
  were grouped by cause, not patched per country.
- **Re-audit (87 countries).** It covered every previously failing country
  plus a spread of others: 0 errors, 0 partial results and 0 stale current
  chapters (bad summaries fell from 15 to 4). The remaining causes were then
  fixed generally:
  - articles titled "History of the …";
  - empty headings that own the sibling sections after them (Jamaica's
    "2020s");
  - inline language and convert templates keep their visible text;
  - newspapers, magazines and companies are never topics or events;
  - history titles that redirect to a country's main article are skipped.

  Chapters with no linked events yet are brand-new periods ("2025 coup",
  "2026–present"); the UI falls back to the chapter before. The Olds cache is
  at v6.

Paywalls and panel behaviour were addressed on 2026-10-27.

- **Paywalls: alternative sources, never circumvention.** After a page
  loads, a read-only isolated-world script checks the publisher's own
  restriction markers: schema.org `isAccessibleForFree: false`,
  `article:content_tier`, and common paywall overlays. If the article is
  restricted, or the outlet is a known paywalled one, a bar under the
  toolbar lists the same story from other outlets. These are matched from
  the headlines Intoponet already follows (shared distinctive words, a
  different site, free outlets first). "Find other outlets" searches the
  web for the story's title. Detected paywalls are remembered locally. News
  lists mark paywalled outlets with a lock, and world stories put free
  outlets first. Nothing hides, removes or works around a paywall. Live
  check: an NYT article on Brazil's election was detected from the NYT's
  own markup, and The Guardian, Guyana Chronicle and Demerara Waves were
  offered as free coverage.
- **One panel at a time.** Bookmarks, The Olds, Knowledge and My map are
  mutually exclusive, whichever way they are opened: the last one opened
  closes the others.
- **My map position.** The drawer stays at the right edge again; the shared
  glass class had reset its positioning.
- **Evidence.** `paywall-free-coverage.png` and `bookmarks-favicons.png`.

## Gate ownership and evidence

| Gate | Planner verification before promotion |
|---|---|
| `G0` | Same scenario matrix and stated hardware for both engines; 60/120 Hz, media, IME, VoiceOver, permissions, crashes, sandbox and update path; published ADR-001/002. |
| `G1` | Witnessed arbitrary HTTPS form, direct URL, exact field return, keyboard/reduced-motion alternative, origin display, safe website isolation and native protection. |
| `G2` | Verify controlled RSS-to-shader timing, admitted live RSS/public discussion, global addressability and small-city visibility, provenance/coverage, deduplication, stale behavior, performance/accessibility and zero private input. |
| `G3` | Absorb permitted source; retrieve with citations while Laya has no outbound network; verify sensitive exclusions, deletion/export and disabled-model behavior. |
| `G4` | Trace a multi-step event/edge path to original citations and confirm analogy/sequence are not rendered as causation. |
| `G5` | Inspect exact published payload, consent, withdrawal limits, anti-brigading and moderation evidence across independent operators. |
| `RELEASE` | Independent security/accessibility reviews, current Chromium patch process, signed update and dependency/licence artifacts. |

The code is a development spike until these gates pass. In particular, 30 Hz
compositor measurements do not prove the PRD's 60 fps target, and fixture ad
rules do not establish production protection.
