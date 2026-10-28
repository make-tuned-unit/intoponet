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

The personal-data batch was implemented on 2026-10-27 (MEM-001, MEM-003/008,
MEM-004/005, §8.4).

- **Private browsing (MEM-001).** A header "Private" button, ⇧⌘N, or the
  Privacy tab opens new tabs in an in-memory session
  (`intoponet-private`). Protections and download rules apply to it as
  well. Private tabs are marked in the tab strip. They record no recent
  pages or interest signals, are never written to restore state, and are
  rebuilt as private after a crash. Turning private browsing off closes
  them and clears that session's storage and cache. Opening a URL reuses
  only a tab of the same mode.
- **Footprints and retention (§8.4).** In My map › Privacy:
  - a "Keep recent pages and interest signals" switch (off stops both);
  - retention of 7, 30 or 90 days, or until deleted (the default, so
    nothing is removed silently), applied at start, on library restore and
    hourly;
  - "Delete footprints now", with a confirm step.

  Saved pages, pins and collections are never pruned.
- **Backups.** A switch that excludes the private library, knowledge, the
  Laya index and personal data from Time Machine (`tmutil
  addexclusion`/`isexcluded`, macOS only). It shows its live status, and
  "unavailable" elsewhere.
- **Marker hide/show (MEM-003/008).** A global "Show my pins on the globe"
  switch, and a per-pin Hide/Show in Locations (`hiddenOnMap`, kept by
  both library parsers). Hiding never deletes the page.
- **Collections (MEM-004/005).** An expanded collection explains what it is
  made of: pages per site, research topics and pinned places. It can be
  merged into another collection (no duplicates; the source is removed).
  "Split by site" turns each site with two or more pages into its own
  collection, and single pages stay.
- **Validation.**
  - 266 desktop tests pass, including new privacy, retention and
    collections tests and the shortcut test; typecheck and production
    build pass.
  - `scenario-privacy.mjs`: the private tab reported `isPrivate: true` with
    no recents written, and 0 tabs remained after turning private browsing
    off. Hide pin saved `hiddenOnMap`, and the split produced
    "Pacific reading · en.wikipedia.org".
- **Evidence.** `privacy-tab.png`, `privacy-private-tab.png`,
  `privacy-hide-pin.png` and `privacy-collection-why.png`.

Follow-ups the same day (2026-10-27):

- **History relevance.** A Wikipedia result now has to plausibly be what the
  headline is about before it can become the story's topic:
  - it must share at least a third of its title words with the headline;
  - a single shared word must be a name in the headline, with no other names
    in the title;
  - when Laya is on, its on-device model (all-MiniLM-L6-v2) checks meaning:
    0.45 or higher passes on meaning alone, and below 0.2 is rejected even if
    words match.

  Calibration: related topics scored 0.45–0.65; the reported mismatch (a
  Honduran hospital story → "2012 Delhi gang rape and murder") scored 0.17.
  When nothing passes, the story falls back to the country's current chapter
  and says so. In the Honduras check, four untranslated headlines that had
  matched junk ("Tras De Mí", "Defender (video game)", "Education in
  Honduras") now fall back honestly. The Olds cache is at v7.
- **Layout.** The Bigger Picture card no longer collapses inside the scrolling
  country panel. In short windows, the Olds timeline keeps its fixed rows and
  a 300 px track, and scrolls vertically instead of clipping cards under the
  chapter band (`hn-timeline.png`: 8 cards, 0 clipped). Untranslated Spanish,
  French, Portuguese, German, Italian and Dutch articles ("El") are no longer
  offered as names behind the headlines.
- **Browser toolbar.** The address is a compact display (max 340 px). The
  toolbar names its features: Protected, Translate, Capture, Pin, Absorb and
  Bookmarks. Pin and Absorb moved out of "…", which keeps copy, find and
  print. Names hide below 1040 px of toolbar width.
- **Tab rail as an app bar.** The rail expands only after 1 s of hover, a
  click cancels the pending expansion, and only keyboard focus expands it at
  once. Verified: closed at 0.5 s, open at 1.4 s, still closed 1.5 s after a
  click.
- **Absorb Selection.** Right-clicking selected text (3+ words, not in a form
  field) offers "Absorb Selection", which opens the usual Absorb preview for
  just that passage. Verified on Wikipedia's Climate change article: a
  137-word selected paragraph previewed with scope `selection`.
- **Validation.** 274 desktop tests, typecheck and build pass. New scenarios:
  `scenario-honduras.mjs`, `scenario-toolbar.mjs` and
  `scenario-absorb-selection.mjs`.
- **Protection bar.** Site protection is a single 40 px bar under the
  toolbar, like the translate bar, replacing the tall right-hand panel. It
  shows the status and blocked counts, the ads and trackers switches, network
  privacy (encrypted DNS, local IP hidden, no VPN), "Pause on this site" and
  close (`protection-bar.png`).
- **Capture folders.** The capture "Save to" menu ends with "New folder…".
  Naming it creates the collection (and its Finder folder) and selects it
  (`capture-new-folder.png`).
- **Pin editor.** Fields are 13 px and buttons 12.5 px, and the close button
  is a centred 34 px square (icon offset 0, 0). Pin suggestions resolve city
  homonyms with regions the page names, in its text or its site name. A Texas
  Tribune story about the Santa Ana refuge no longer suggests Santa Ana,
  California, and Texas is offered instead (`pin-editor-compact.png`).
  Scenario: `scenario-bars.mjs`.
- **Settings and automatic translation.** A Settings button (gear) in the
  header opens a drawer (one panel at a time, and it hides the page view
  while open). It holds:
  - your reading language (download size shown for languages not yet on
    this Mac);
  - "Translate pages automatically";
  - "Download a language the first time a page needs it";
  - "Show news headlines in your language" (applies to every headline list
    at once);
  - downloaded languages, with remove;
  - a link to Privacy.

  With auto-translate on, a page in another language is translated as it
  loads. Each page and language is tried once, so "Original" sticks. Without
  auto-download, the translate bar opens and offers the download instead.
  Language detection now also runs while a page is still loading, with
  retries up to about 50 s. fontanka.ru (endless loading) previously showed
  "Choose language"; Russian is now detected in about 10 s.

  Live check (`scenario-auto-translate.mjs`, fresh profile): fontanka.ru was
  detected as Russian, the model downloaded, and 418 blocks were translated
  by 30 s (`auto-translate-fontanka.png`, `settings-panel.png`). Model sizes
  from the catalog: 57 languages, 43–137 MB each, median 72 MB.

PRD gap work, 2026-10-27 (after the audit of 60 IDs: about 30 done, 23
partial, 7 missing):

- **No plain-text library (P3-01, §11).** Bookmarks, collections and recents
  are no longer copied to renderer `localStorage`. They live only in the
  encrypted `private-library.v1.seal`. An old plain-text copy is merged into
  the encrypted library on first launch, and deleted only after an encrypted
  write succeeds. A live test caught and fixed a loss case: an empty
  encrypted file used to win over the old copy. Now the two are merged.
- **Site permissions (WEB-001, WEB-006).**
  - Camera, microphone, location, notifications and clipboard reading are
    asked in a bar under the toolbar, with Allow, Block and Not now.
  - Answers are kept per site in `site-permissions.json` (mode 600). Private
    tabs keep them in memory, cleared when private browsing ends.
  - The Protection bar lists a site's remembered answers; clicking one
    forgets it, so the site asks again.
  - Fullscreen and clipboard writing are granted; everything else (MIDI,
    USB, serial, …) is refused.
  - macOS camera and microphone access is requested on the first Allow.
  - Electron limitation: before you answer, `navigator.permissions.query`
    reports "denied" rather than "prompt".
- **Popups (WEB-001, WEB-009).**
  - Sized popups (`window.open` with features, as sign-in flows use) open
    as a small sandboxed window in the same session, keeping
    `window.opener`.
  - `target=_blank` and new-tab links open as tabs with the opener's
    privacy.
  - Non-http(s) popups are refused, and more than 3 popups in 10 s from one
    page are blocked.
  - Popup windows close with their page.
  - Live: a geolocation request was granted through the bar (the page then
    reported "granted"); a sign-in-style popup opened with `opener` kept; a
    `_blank` link opened a tab.
- **Import and tags (§8.4, MEM-005, MEM-007).**
  - My map › Import merges an exported library: pages match by address, and
    yours keep their title, note, pin and visibility while gaining imported
    tags (and a pin or note they lacked); collections match by id or name
    and combine pages; recents and excerpts combine.
  - Pins take several tags ("Water, Pacific, climate"): the first is the
    main topic. Tags show in Locations and in collection explanations.
- **Sites to leave out (ABS-005).** A user list in Privacy. Absorb refuses
  those sites before running any script (enforced in the main process), and
  they leave no recent pages or interest signals. Adding a site also drops
  its existing recent pages.
- **Validation.** 291 desktop tests, typecheck in all workspaces, and the
  build pass. Scenarios: `scenario-permissions.mjs`, `scenario-import.mjs`
  and `scenario-excluded.mjs`.
- **Still open, needing decisions.**
  - Beacons (BCN-001 to 006): publishing governance and anti-Sybil
    approach (ADR-006).
  - Project licence (LICENSE/NOTICE).
  - A real neighbourhood level (needs polygon data).
  - Analogous and responded-to links in The Olds (Wikidata has no direct
    properties).
  - Claim labels (ABS-004).
  - The VoiceOver pass.

Licence, Beacons and remaining PRD items, 2026-10-27:

- **Licence (§14, owner decision).** Proprietary, all rights reserved
  (`LICENSE`), and every package is `"license": "UNLICENSED"`. The owner asked
  for maximum protection, and the repo is private. This departs from the
  PRD's open-source candidates (Apache-2.0 / MPL-2.0): an open licence can be
  adopted later, but not withdrawn once published.
  `THIRD_PARTY_NOTICES.md` lists every third-party licence. Obligations
  before a public release:
  - the vendored MPL-2.0 Bergamot glue stays MPL;
  - ship Electron/Chromium licences and the npm licence texts;
  - attribute Wikipedia (CC BY-SA 4.0) and GeoNames (CC BY 4.0), now in
    Settings › Credits;
  - clear news-feed terms for commercial use;
  - confirm the source of `earth-day.jpg`.
- **Beacons (BCN-001 to 006), Neon.**
  - `packages/beacon-core` holds the payload rules: canonical URL with
    tracking removed, no sign-in, account, payment or local addresses,
    unknown fields refused, place rounded to 0.1°. It also holds Ed25519
    signing and prominence: the sum over 2° cells of min(4, log2(1 + keys)),
    with bucketed public counts.
  - `services/beacon-registry` is a Node API over Postgres (Neon via
    `DATABASE_URL`). It supports publish, signed withdraw, report and
    contest (contests shown publicly), auto-hide after 3 independent reports
    pending moderator review, daily limits per key and per salted-hash
    network, replay protection, aggregate-only reads (keys never returned),
    and `/v1/export` for mirrors.
  - Desktop: "Publish beacon…" on a pin opens a consent screen showing the
    exact JSON and what is never included. Publish stays disabled until the
    publicness box is ticked. The main-process `BeaconPublisher` is the only
    transmitter, and its key is sealed by safeStorage. "Beacons near here"
    appears in country panels, with report and dispute. Settings › Beacons
    holds the registry address and withdraw buttons.
  - Decision record: ADR-006 (anti-Sybil remains open before public launch).
  - Tests: core 5, registry 5 against a real Postgres 17, publisher 4.
    End-to-end against a local registry: publish → appears near Fiji →
    withdraw removes it (`beacon-consent.png`).
- **Claims (ABS-004).**
  - The Knowledge reader lists the figures, quotations and contested
    statements in each page, with attribution ("Stated · the
    Intergovernmental Panel on Climate Change"). Each is labelled stated,
    corroborated (same figure or quote on another site you absorbed) or
    disputed (flagged in the text, or a clearly different value for the same
    measured unit and subject). Each jumps to its paragraph and evidence.
  - Detected names, places and terms are labelled "inferred".
  - The first live run was too eager: citation markers and loose overlaps
    produced 14 false disputes on Climate change. After the fix: NASA
    Evidence has 3 corroborated (for example "ocean absorbed 20–30% of
    emissions" matches Wikipedia) and 0 disputed.
- **Competing interpretations (OLD-005).** The Olds has a "Debate" view: attributed
  views from the article's historiography, debate, causes and legacy
  sections, shown side by side and unranked, each linking to its section. It
  appears only when 2 or more named holders exist. Industrial Revolution
  shows Henrich, Stark, Mokyr, Williams, Voltaire and Allen
  (`olds-debate.png`). English only. Olds cache v8.
- **Accessibility (EXP-008, MEM-010, §12).**
  - axe-core (WCAG 2.1 AA) reports 0 violations across home, Bookmarks, My
    map, Privacy, Settings, Knowledge, The Olds and a country panel. One
    issue (an aria-label on a role-less span) was fixed.
  - Keyboard: all five header panels open with Enter and close with Escape,
    and focus returns to their button. Settings gained an Escape handler.
    Focus rings are visible.
  - Dragging between bookmark folders now has a "Move to…" menu on each
    bookmark and capture.
  - A full VoiceOver walkthrough is still a manual check.
- **Validation.** Typecheck in all workspaces; desktop 302, beacon-core 5,
  local-knowledge 7 and registry 5 tests pass; build passes.
- **Beacons live on Neon (2026-10-27).**
  - Project `intoponet-beacons` (`curly-river-72204483`) in the Atlas Atlantic
    org, aws-us-east-1. Schema applied; registry tests passed on a temporary
    Neon branch, which was then deleted.
  - Function `beacons` is deployed from `services/beacon-registry/neon.ts`
    with `neon deploy --env .env.local`. Its secrets live only in the ignored
    `.env.local`.
  - The app defaults to it (`main/beacons/defaults.ts`). Settings or
    `INTOPONET_BEACON_REGISTRY` override.
  - Per Neon's guidance, `X-Forwarded-For` is untrusted on Functions, so the
    Function has no per-network limit. Add one at an edge proxy before public
    launch (ADR-006).
  - Live end-to-end from the built app: publish → read near Fiji → withdraw.
    Test rows removed afterwards; production starts empty.
- **Topics behind a story (2026-10-27).**
  - The Olds Story view lists the subject areas a headline is about, in its
    province or state first, then its country (for example "Incarceration in
    Canada", "Crime in Canada", "Correctional Service Canada", "Provincial
    correctional services in Canada"). Each topic has up to two recent
    figures quoted from its Wikipedia article, plus "Its history" (opens a
    full thread) and "Read on Wikipedia".
  - Sources: subject families (justice, health, housing, politics, economy,
    immigration, Indigenous, climate, energy, military and more) triggered
    by headline words, plus subject-word searches filtered to the country
    and to shared subject words.
  - Titles are checked to exist, with no disambiguation pages, and ranked by
    Laya meaning when it is on.
  - Live: the NB correctional-centre headline gets the four topics above;
    the hospital and rent headlines lost their off-topic results after the
    subject filter. Olds cache v9.
- **Pin → beacon.** Besides "Publish beacon…" in My map › Locations, the Pin
  editor has "Save and publish as beacon…" (saves the pin, then opens the
  consent screen). The page view is hidden while the consent screen is open.
- **Fly-to, crash and globe spin (2026-10-27).**
  - **Crash:** closing a tab threw in main (`view.webContents.id` read inside
    its own 'destroyed' handler, from the popup work). The id is now captured
    up front; popup cleanup holds the opener's webContents the same way.
  - **Place data:** cities of 50,000+ people plus every national and
    first-level capital (GeoNames PPLC/PPLA), up from 250,000+: 13,101
    cities, about 790 KB, so Charlottetown, Fredericton, Juneau and others
    are found. Searches accept a province, state or country after the place
    ("Charlottetown PEI", "Halifax, NS", "Springfield IL", "Perth WA"). Two-letter
    codes only work as a qualifier; PEI, NSW and QLD also work on their own.
  - **Enter flies:** Enter flies to the place when the text is its name, its
    name plus a region, or a 4+ letter start of its name. Places are offered
    even while a page is open; flying closes the page and spins the globe
    there with nearby signals listed. Live: "Charlottetown PEI" and
    "Fredericto" flew there from an open CBC page; "Paris attacks timeline"
    still searched the web.
  - **Spin-back:** OrbitRig re-applied a stale theta whenever any prop changed
    (for example zoom), and angles grew unbounded so the reset spun the long
    way round. Now only changed props apply, by the shortest path, and a drag
    keeps its momentum on release (eased; none if you pause before letting
    go; none with reduced motion). Live: throw then zoom kept the view.
- **Place locator (2026-10-27).** Flying to a place shows a locator on the
  exact spot: a glowing dot, two pulsing rings, a landing ring as you arrive,
  and the place name. It is an HTML overlay positioned on a projected,
  undrawn marker (`locator:<id>`). It fades when the spot turns away and is
  static with reduced motion. Live: Dar es Salaam (`locator-2-settled.png`).
- **The Olds: history from article structure, not AI (2026-10-27).**
  - **Chronology:** "How we got here" lists dated sentences quoted from the
    topic's own Wikipedia article, in time order. A sentence is kept only if
    it states a date ("On 19 December 2018…", "In January 2017…", "In 2016,…").
    References and see-also sections are skipped, and fragments and link
    debris dropped. Each entry has its section link and the first article it
    mentions ("…: its history"). At most 3 per year, keeping early background
    and recent events. Topics without a Wikidata date take the first dated
    event (never for broad places).
  - **Broad places:** a broad topic (country, region) only keeps events that
    mention the headline's subject words and names. If the related topics
    include a current event that fits the headline, the story switches to it
    and says so ("Latin America" → "2026 Brazilian general election").
  - **Topics behind the story:** country from the outlet, else the topic's
    Wikidata country, else the country the headline names (possessives and
    "Latin America" handled). Creative works (films, albums, books) are never
    offered. Free-text search results need a country and must not be dated
    past events ("1904 … election").
  - **Matching:** generic event words (Trial, Election, Case, Crisis…) and a
    first name beside a matched surname no longer count as unexplained
    names, so "Trial of Benjamin Netanyahu" matches without Laya. The news
    card shows the headline as published.
  - **Live:** the Netanyahu verdict story has 18 dated events (Dec 2016
    investigation → Mar 2026 pardon review) and topics Judiciary of Israel,
    Israeli law, Politics of Israel and Elections in Israel. Olds cache v11.
- **World list scroll.** The World and Rising lists scroll inside the
  highlights panel (they were clipped). Live: 20 stories, scrolls 600 px.
- **Recent history and rough translation (2026-10-27).**
  - **Recent history:** Bigger Picture shows the newest dated events quoted
    from the country's own Wikipedia article (last 25 years). It prefers
    sentences about something that happened (signed, elected, opened,
    protests…) over statistics, with at most one cultural item. Each opens
    the history of what it mentions. Without such events, the old list is
    labelled "Earlier history" (not "Recent") when nothing is within 30
    years. Live: Faroe Islands (Sandoyartunnilin 2023, radar agreement 2022,
    dolphin hunt 2021), Paraguay (Peña elected and sworn in 2023), Tanzania
    (2025 election protests).
  - **Rough translation:** languages with no Mozilla model use their closest
    relative's: Faroese → Icelandic, Nynorsk → Bokmål, Luxembourgish and
    Swiss German → German, Frisian and Limburgish → Dutch, Macedonian →
    Bulgarian, Montenegrin → Serbian, Asturian and Aragonese → Spanish,
    Occitan → Catalan. Always labelled "from Faroese (rough, via
    Icelandic)". Bigger Picture's names use the same path. Live: KVF
    headlines translated after the 77 MB Icelandic download.
- **Feature verification DAG (2026-10-27).**
  - **The graph:** `docs/FEATURE_DAG.json` lists 26 user-facing features, each
    with its promise, dependencies and tier. Core runs offline, network needs
    the internet, and full also downloads language models.
  - **Checks and runner:** `experiments/e2e/checks.mjs` has one end-to-end
    check per feature, run against the built app with a fresh profile through
    `experiments/e2e/lib.mjs`. `npm run verify:features` validates the graph
    (acyclic, every node has a check and every check a node), runs in
    dependency order, marks dependants of a failure as blocked, and writes
    `docs/FEATURE_VERIFICATION.md` plus `docs/feature-verification/latest.json`.
    Options: `--tier full`, `--only`, `--skip-build`, `--list`.
  - **Execution DAG:** node FEATURE_E2E links it to the execution DAG.
  - **Result:** `--tier full` passed 26 of 26.
  - **Fixes found by the DAG:**
    - a test file that never ran (missing imports);
    - Escape didn't close The Olds after a fly-to (focus stayed in the
      search box): the sheet now takes focus, and Escape in an empty search
      box closes panels;
    - excluding a site didn't forget earlier recents unless done from the
      Privacy tab: now pruned on any change;
    - place search was about 15 ms per keystroke with 13k cities: prefix
      buckets bring it to about 0.17 ms.
  - **Harness:** checks wait for the interface; page checks fall back
    across several well-known sites, because example.org and gnu.org were
    unreachable from this network at times.
  - **Known thin spots:**
    - the paywall check proves detection runs, not detection on a paywalled
      article;
    - the protection check passed on blocked ads (CNN showed 0 trackers
      that run);
    - beacon publishing is checked for consent only; the live registry is
      read-only in the DAG to keep it clean.

### 2026-10-27 — The Olds on live trending stories

- Sampled 23 live trending and rising headlines from the news digest and ran
  each through The Olds in a fresh profile
  (`node experiments/e2e/olds-sample.mjs out.json`). The first pass gave good
  context for 3 of 10.
- Fixes in `main/olds`:
  - the country the headline names beats the outlet's country, including
    adjectives ("Ukrainian"), "US" and "DR Congo";
  - this year's events are preferred, with ongoing events counted as current;
  - topics named for another country are dropped;
  - films, series, foods, coins, phrases, lists, name pages and occupations
    are not topics;
  - a match on the country's name alone needs a current event whose kind the
    headline points to ("win" → election); otherwise a subject topic is used
    ("Xenophobia in South Africa", "Banking in Ethiopia");
  - two-country stories add "A–B relations", including countries brought in
    by a leader's name;
  - fallback histories keep only events about the story;
  - timeline sentences that can't stand alone are dropped;
  - column labels ("Reader Q&A:") are stripped;
  - one retry on a dropped connection.
- Result: 16 of 23 good, 3 passable, 3 honest country fallbacks, and 1 test
  artifact (a Spanish headline sent without its language).
- `OLDS_HEADLINE` now guards the Ebola, South Africa and Guernsey cases.
- `INTOPONET_OLDS_DEBUG=<file>` records candidate scores for quality checks.
- Second round (33 stories):
  - dates without a year ("On 7 January") take the year from a one-year
    article or the year its dates agree on;
  - a one-year article keeps 3 events per month, not per year;
  - articles too new for Wikidata ("Cyclone Arnab", "Super Bowl LXI halftime
    show") supply "How we got here" when they fit better, and the panel says
    so;
  - upcoming-event headlines follow Wikidata "followed by";
  - a year in a title no longer turns one shared word into a match ("2026
    Presidents Cup");
  - month names don't count as shared words;
  - "América Latina" is a region, not the United States;
  - untranslated headlines need two shared words.
- Third round (25 new stories, two thirds ordinary local news from random
  countries, most not in English):
  - untranslated headlines are matched on their own-language Wikipedia
    titles, with function words of common languages ignored; the thread is
    still shown in English;
  - a topic that shares only the outlet's country, or "US" written short, is
    a weak match;
  - section labels ("International News:") are stripped;
  - "North and South Korea" names both countries;
  - a film or game is a fair topic when the story is about one;
  - items with no English name and division types ("U.S. state") are not
    topics.
  - Result: 9 of 25 good (up from 5); most of the rest are untranslated
    local stories that fall back to the country — install the language to
    translate first.
- Limits:
  - a headline whose subject is its first word ("Nanotyrannus skeleton
    sells…") isn't read as a name;
  - an outlet's own country is overridden when the headline names another
    (a Jamaican minister's campaign in Canada);
  - the leader list is dated late 2026.

### 2026-10-27 — Every country named and clickable on the globe

- Country shapes from Natural Earth 1:50m (public domain), simplified to ~2 km
  (590 KB, `build-country-shapes.mjs`); all 252 countries the app knows are
  accounted for (246 shapes; overseas parts such as French Guiana and
  Svalbard split out; 6 specks as points). A unit test proves each country
  is found at its own label point.
- Clicking bare globe finds the country under the cursor (enclaves, coasts
  and specks like Vatican City handled) and opens it: its news when it has
  coverage, otherwise "Near <country>".
- Names fade in by zoom and Natural Earth's label priority without
  overlapping panels or marker labels; the country in the middle of the view
  and the one under the cursor are always named. Flying to a country frames
  its middle, not its capital.
- `COUNTRY_NAMES` in the feature DAG: names at the start, a click, and seven
  flights (Canada to Tuvalu) each naming the right country.

### 2026-10-28 — The Olds: Current events, timelines and a 90-story review

- Research (docs/research/olds-linking.md): TREC background linking, Wikipedia's
  Current events portal, Wikidata event properties, timeline summarisation.
- Stage 1 is now Wikipedia's Current events (45 days, one request): a
  headline matched to an item gives the thread it is filed under ("Part of …"
  in the story) and every dated item under that thread becomes a recent step in
  "How we got here". Then "Timeline of …" articles (dated headings) and the
  topic's own article for the deeper past; local stories that fall back to
  their country get that country's "<year> in …" events.
- Search: all queries at once plus the whole headline with `prefer-recent`,
  fused by reciprocal rank; a country-scoped query for local news; event-name
  queries ("2026 Dakar Youth Olympic Games").
- Generic matching fixes from three fresh 30-story samples (two thirds local
  news, 11 languages installed): accents, title case, acronyms, years,
  institution words, kinds of event, people by citizenship (and fame for
  surname-only matches), foreign institutions and namesakes, general concepts.
- Misses on fresh samples: 18 → 9 → 6 of 30; most remaining stories are local
  items with no Wikipedia article, which now fall back to the country with its
  recent events rather than a wrong topic.

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
