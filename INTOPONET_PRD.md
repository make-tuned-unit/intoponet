# Intoponet — Product Requirements Document

**Version:** 1.0 | **Date:** 2026-10-23 | **Status:** Foundational specification; architecture subject to validation

> **Vision:** An open-source, privacy-first Chromium browser that transforms the web into a beautiful, living, explorable field of human interest, grounded in geography and connected through history. Real websites remain fully functional. Personal knowledge remains entirely on the user's device. A future community-owned network can carry the same experience without dependence on a single ISP or platform.

## 1. Executive summary

Intoponet reimagines the browser as a persistent environment rather than a sequence of disconnected destinations. Users begin in a full-screen, GPU-rendered frequency field, optionally anchored to a view of Earth. They zoom from planet to country, city, neighbourhood, subject and original source, observing activity as a continuously morphing field rather than artificial mountains or buildings. A bottom command launcher provides instant direct URL and search access. Selected websites open in real Chromium-backed side windows, bottom sheets, or full-screen views, with premium liquid-glass controls and physically coherent transitions.

**The Olds** connects contemporary subjects to sourced historical threads. **Footprints** preserve optional private visit history; **Bookmarks** save locations; **Collections** organize related discoveries; **Absorb** explicitly indexes selected sources into an on-device knowledge graph; **Beacons** intentionally publish source recommendations into the public field. **Laya**, an optional entirely local model, clusters interests, extracts concepts, and supports private semantic retrieval. No personal history, prompts, embeddings, or model inference leaves the device.

A distinct, later-stage community connectivity initiative explores open-source Wi-Fi roaming, local-first services, and peer networking using existing equipment where technically possible. It is not a dependency of the browser MVP.

### 1.1 Founding principles

1. **Real web compatibility:** Existing websites and applications work without modification.
2. **Exploration over hopping:** The field and exploration context persist when opening content.
3. **Premium craft:** Beautiful immersive rendering, responsive liquid glass, precise typography, accessible animation.
4. **Local ownership:** Personal data, knowledge graph, embeddings, Laya models and inference remain on-device.
5. **Explicit sharing:** Visits, bookmarks, and absorption never silently become public interest signals.
6. **Shared public reality:** Identical geography/time/filter selections yield the same public field, not algorithmic personal feeds.
7. **Authentic interest, not fame:** No advertising, follower metrics, celebrity weighting, or unqualified raw engagement counts.
8. **Evidence-backed history:** Historical relationships distinguish chronology, influence, causality, analogy, and dispute.
9. **Open source and free core:** No subscription or ads required for basic use; real hosting and hardware costs remain.
10. **Transport independence:** Works on today's internet and can later support alternative community networks.

### 1.2 Success scenario

A first-time user opens Intoponet, sees a live field based on disclosed real public sources, explores a local topic from the Earth view, opens and uses a real website, saves and optionally absorbs it, follows a documented historical connection, and returns to the exact exploration position without creating an account or uploading their personal activity.

## 2. Scope, personas, and non-goals

**Personas:** curious explorer; local citizen; student/researcher; private knowledge collector; everyday browser user; voluntary community contributor.

**Jobs:** discover without knowing the query; see what matters nearby and globally; follow relationships rather than search-result lists; inspect original evidence; understand historical context; preserve and privately connect discoveries; optionally recommend sources to others.

**Non-goals:** building a new HTML renderer; indexing the whole web in v0.1; inventing geographic coordinates for abstract ideas; building another engagement-driven social network; treating activity as truth or public importance; mandatory AI; cloud-based Laya; copying entire paywalled works; requiring decentralized connectivity to browse; guaranteeing cellular-like handoff with consumer Bluetooth or Wi-Fi.

## 3. Domain vocabulary

| Concept | Definition | Privacy |
|---|---|---|
| Frequency field | Visualized aggregate topic activity and relationships across space/time | Public aggregates |
| Signal | An eligible documented source or voluntarily contributed public interest indicator | Public/opt-in |
| Footprint | Optional record of a visited resource or explored region | Local |
| Bookmark | Explicitly saved resource or location in the field | Local |
| Collection | Evolving cluster of related discoveries, editable by the user | Local |
| Absorb | Explicit local extraction and indexing of selected source content | Local |
| Beacon | Deliberately published pointer recommending discovery of a resource | Public opt-in |
| The Olds | Historical graph of sourced relationships to current subjects | Public sources; optional local overlay |
| Laya | Optional local embedding, categorization, retrieval, and reasoning | Local only |
| Focus | A real Chromium-rendered webpage in a browser panel | Normal website traffic |
| Commons | Federated future infrastructure for public sources and beacons | Public |

Resources may have physical coordinates, conceptual associations, both, or neither. A resource without geographic relevance must not be arbitrarily pinned to a physical location.

## 4. Functional requirements

### 4.1 Explore and planetary navigation

- **EXP-001:** Launch into immersive full-screen field with minimal, discoverable controls.
- **EXP-002:** Globe provides spatial reference, while the frequency field is abstract, fluid and morphing, **not** simulated mountains or a conventional heatmap alone.
- **EXP-003:** Support Earth → region → country → city → neighbourhood → topic → resource progressive exploration.
- **EXP-004:** Preserve camera, selection, filters, time window and opened-source context across transitions.
- **EXP-005:** Manual region selection works without location permission; precise location is never required.
- **EXP-006:** Labels and detail resolve progressively; avoid overwhelming clutter and maintain legibility.
- **EXP-007:** Show data coverage, confidence and source provenance. Never present synthetic/demo signals as real activity.
- **EXP-008:** Keyboard, pointer, touchpad, and accessible non-spatial alternative controls.

### 4.2 Frequency model

- **FRQ-001:** Amplitude expresses normalized, qualified intensity of independent eligible interest signals.
- **FRQ-002:** Field width/extent can reflect geographic breadth or diversity of participation, subject to validation.
- **FRQ-003:** Oscillation reflects change over time; decay represents waning recent activity.
- **FRQ-004:** Interference/overlap reflects documented relationships, not fabricated semantic similarity.
- **FRQ-005:** Permit explicit time, geography, source-category and measurement filters.
- **FRQ-006:** Distinguish attention from truth, significance, severity, and population representation.
- **FRQ-007:** Resistant to simple duplicate events, spam and artificial amplification; no claim of perfect Sybil resistance.
- **FRQ-008:** Public aggregate computations are documented, versioned, reproducible, and explainable.

### 4.3 Browser navigation and real websites

- **WEB-001:** Full support for HTTPS, modern HTML/CSS/JS, forms, sessions, cookies, WebRTC and normal web navigation subject to Chromium capabilities.
- **WEB-002:** Bottom command launcher opens URL, performs user-selected web search, or explores a topic.
- **WEB-003:** Real pages open in independently navigable Chromium-backed side panels, floating panels, bottom sheets (mobile), and full-screen Focus mode.
- **WEB-004:** Smooth opening and closing animations preserve perceived origin and spatial context.
- **WEB-005:** Multi-window state persists locally; windows can be minimized, resized, rearranged, restored, and closed.
- **WEB-006:** Clear origin/security identity and permission prompts are always available, not obscured by glass styling.
- **WEB-007:** Standard back, forward, reload, find, copy/paste, downloads, print, permissions, and keyboard shortcuts.
- **WEB-008:** Direct navigation must be fast; users must never have to travel through the field to pay a bill or access a specific URL.
- **WEB-009:** Define policy for pop-ups, external protocol handlers, password management, autofill, media DRM, extensions, downloads, and site isolation before public beta.
- **WEB-010:** Browser page chrome provides a visible, keyboard-accessible pin action in both panel and full-width Focus mode. Pinning a page creates or edits a private Bookmark; it does not publish a signal or absorb page content.

### 4.4 Footprints, bookmarks, collections

- **MEM-001:** Footprints are optional, locally stored and off in private browsing.
- **MEM-002:** Bookmark stores URL, canonical identifier, title, user note, field anchor, timestamp and permitted preview metadata.
- **MEM-003:** Saved markers are subtle and recognizable; users can hide or filter them.
- **MEM-004:** Collections group related visits/bookmarks/absorbed sources locally, with explanation of relationships.
- **MEM-005:** Users can rename, merge, split, pin, move, export and delete collections.
- **MEM-006:** Personal field overlays do not change the shared public field.
- **MEM-007:** A user can pin the current browser resource into their personal world view, assign one or more user-selected topics/tags, and optionally attach a real geographic anchor. Anchors must come from a place the user selects or an explicitly placed map point; never use visitor/device location implicitly or invent coordinates for conceptual topics or unlocated resources.
- **MEM-008:** Users can edit or unpin a saved resource, revisit its original page, and show/hide its marker on their personal map. A pin is a local bookmark overlay, not public-field activity.
- **MEM-009:** Browser pinning and map markers are private and stored locally. They remain distinct from Footprints, Absorb, and Beacons: pinning does not create visit history, index page content, or transmit a public recommendation.
- **MEM-010:** The pin workflow and personal markers are usable with keyboard and assistive technology. Native browser content, origin/security indicators, permission prompts and page controls must remain accessible and not be obscured by the pin control or map overlay.

### 4.5 Absorb and Laya

- **ABS-001:** Absorb is distinct from Bookmark and Beacon and always explicitly initiated.
- **ABS-002:** Preview source and extraction scope before indexing; show indexing status and errors.
- **ABS-003:** Extract permitted readable text, entities, concepts, dates, links and citation spans locally.
- **ABS-004:** Persist source provenance and distinguish source-stated, model-inferred, corroborated, disputed and unknown relationships.
- **ABS-005:** Banking, health, authentication, private messages, credentials and sensitive form content excluded by default; user-configurable strict exclusions.
- **ABS-006:** Users inspect, correct, remove and reindex extracted content.
- **LAY-001:** All model inference and embeddings run on-device; no remote model API, analytics, model telemetry or hidden fallback.
- **LAY-002:** Laya works offline with locally available sources and models.
- **LAY-003:** Laya can cluster topics, retrieve prior discoveries and answer questions with local source citations.
- **LAY-004:** Laya is optional; basic browser and manual collections work without it.
- **LAY-005:** Downloading a model may use the internet, but model inputs, outputs, embeddings and personal graph data never upload.
- **LAY-006:** Never execute instructions embedded in untrusted web content; content is data, not authority.

### 4.6 Beacons

- **BCN-001:** User deliberately promotes a bookmark/source into a public beacon.
- **BCN-002:** Consent screen previews exactly what leaves the device; no browsing history, local graph or embeddings included.
- **BCN-003:** Aggregate prominence uses diminishing returns and geographic context, not linear votes.
- **BCN-004:** Provide source, provenance, reporting and contestation affordances.
- **BCN-005:** Users may withdraw a beacon where supported; warn that replicated public contributions cannot always be erased everywhere.
- **BCN-006:** Privacy-preserving abuse controls and moderation are required before public launch; anonymous uniqueness remains an open research problem.

### 4.7 The Olds

- **OLD-001:** Users can traverse historical threads backward and forward in time from a current topic.
- **OLD-002:** Graph edges have explicit relationship types: `preceded_by`, `contributed_to`, `influenced`, `responded_to`, `analogous_to`, `disputed_link`, `located_at`.
- **OLD-003:** Every event/edge carries source citation, time range, attribution and confidence/contestation status.
- **OLD-004:** Chronology does not imply causation; generated suggestions must be marked unverified.
- **OLD-005:** Multiple historical interpretations can coexist with attributed supporting evidence.
- **OLD-006:** Original archives and articles open in real browser windows.


## 5. Design system and motion specification

**Brand direction:** lowercase `intoponet`, identity based on *emergence* and *resonance*, not a generic globe, Wi-Fi icon or crypto aesthetic. Candidate positioning: “Explore beyond the expected.” All marks, names, fonts and slogans require clearance before release.

**Proposed palette:** void `#07111B`, slate `#142837`, signal teal `#50D9C7`, spectral violet `#A69BE8`, warm-white text `#E9F4F3`, secondary text `#9BB7B9`. Colours are starting tokens, not final artwork. Support contrast themes, colour-blind-safe distinctions, reduced translucency, and reduced motion.

**Component inventory:** `GlassSurface`, `GlassPanel`, `GlassSheet`, `GlassPopover`, `GlassTooltip`, `BrowserSurfaceFrame`, `WindowDock`, `WindowSwitcher`, `OriginBadge`, `CommandLauncher`, `SpatialBreadcrumb`, `ScaleIndicator`, `TimeScrubber`, `FrequencyTooltip`, `SourcePreview`, `BeaconToken`, `BookmarkFlag`, `CollectionCluster`, `KnowledgeInspector`, `ProvenanceDrawer`, `PrivacyIndicator`, `PermissionPrompt`, `OfflineStatus`.

**Material design:** restrained translucency, local background blur, fine specular borders, subtle depth and shadow. True dynamic refraction is optional and must never compromise readability, input latency, battery, or accessibility. Do not copy proprietary OS glass assets.

**Motion:** spring/velocity-aware transitions, target 250–450 ms for large window transitions (tune by testing); instant feedback under 100 ms; no gratuitous constant motion. The selected field location remains the perceptual origin when opening and closing a website. Prefer GPU compositor transforms and opacity to costly repeated layout and backdrop effects. Cancel/interrupt animations safely. Target 60 fps on supported baseline hardware, 120 Hz opportunistically. Under reduced motion, use short fades and clear focus changes.

**Performance budgets (initial engineering targets, not measured promises):** 60 fps field at 1080p on baseline macOS hardware with bounded GPU use; p95 pointer response under 100 ms; p95 command launcher visible under 150 ms; web view usable as soon as Chromium renders; idle field should throttle when obscured/backgrounded. Establish real baselines during the engine spike before committing hard memory and battery budgets.

## 6. Browser engine decision: Chromium from day one

### 6.1 Options

| Option | Benefits | Risks | Position |
|---|---|---|---|
| Electron + `WebContentsView` | Mature Chromium integration, rapid iteration, TypeScript ecosystem | Native view stacking/animation synchronization, larger runtime | Benchmark |
| Chromium Embedded Framework (CEF) | Native embedding and more rendering control | C++/native complexity, process coordination, update responsibility | **Preferred evaluation candidate** |
| Direct Chromium fork | Maximum browser integration/control | Very high build/maintenance/security-patch burden | Defer until a proven blocker |
| Tauri + system webviews | Leaner app | Different platform engines, webview limitations | Not primary Chromium strategy |

**Decision gate ADR-001:** Build the same website-over-field proof of concept in CEF and Electron. Choose on measured compositing quality, browser compatibility, security isolation, developer velocity, resource use, update path, and ability to preserve UI/website layering. No direct fork until a documented, blocking requirement cannot be met through embedding.

### 6.2 CEF rendering strategies

1. **Native child browser surfaces:** preferred where compositor stacking and clipping can support smooth window transitions; animate native view bounds/visibility carefully.
2. **Off-screen rendering:** allows texture composition with custom 3D content, but entails frame-copy/synchronization/input/IME/accessibility costs; test before adopting.
3. **Hybrid:** animate a snapshot/placeholder during transition, then reveal a live native webview when settled. Clearly distinguish visual continuity from live content; avoid screenshots persisting over active secure forms.

Benchmark real pages including long-scroll articles, WebGL, video, text selection, input methods, popup windows, permission prompts and screen-reader navigation.

### 6.3 Chromium responsibilities

A Chromium-backed product is still a browser vendor. Define and test: sandboxing; site isolation; multi-process architecture; origin and TLS display; permissions; password/autofill storage; cookie controls; storage partitions; downloads and safe file handling; phishing/malware protections; WebRTC permission leaks; popups; navigation policies; external protocol schemes; certificate errors; WebAuthn/passkeys; accessibility; crash recovery; memory pressure; automatic updates; media codec/DRM availability; extension compatibility policy. Some Chrome-branded features and DRM are not automatically included in Chromium/CEF.

Security updates must track upstream releases rapidly. A designated maintainer owns CVE intake, update cadence, regression tests, signed builds and emergency releases. Do not ship a general-public browser before this process exists.

### 6.4 Trust boundaries

- **Untrusted webpage renderer:** sandboxed, no direct access to Laya, filesystem, operating-system APIs or privileged application IPC.
- **Browser host:** owns navigation, permissions, profile/session storage and safe IPC brokers.
- **Intoponet UI:** trusted but limited to documented browser host APIs.
- **Laya worker/process:** no network permission, constrained local file access, explicit source input grants.
- **Public data client:** can fetch published field data; cannot access private local database.
- **Beacon publisher:** the only component allowed to transmit a user-approved contribution, after preview and consent.

Never expose a generic privileged bridge to arbitrary pages. Use allowlisted, typed, validated IPC messages and origin checks. No remote code execution or arbitrary plugin installation in v0.1.

## 7. Proposed application architecture

```text
+---------------------------------------------------------------+
| Intoponet Desktop Application                                 |
|                                                               |
|  Trusted UI shell (React/TypeScript)                           |
|   - frequency field (Three.js / GPU shaders)                  |
|   - globe context, glass components, spatial windows          |
|   - command launcher, collections, Olds explorer              |
|            | typed privileged IPC                              |
|  Browser host (CEF or Electron, isolated process boundaries)  |
|   - Chromium website views, navigation, profile, permissions  |
|   - downloads, session storage, updates, security             |
|            | explicit extraction request                       |
|  Local knowledge subsystem                                    |
|   - SQLite / FTS5 / vector index / relationship graph         |
|   - Laya worker: embeddings, extraction, retrieval            |
|   - encryption keys held by OS keychain where possible        |
|            X NO NETWORK ACCESS FROM LAYA                       |
|                                                               |
|  Public field client ----> open public data / federation      |
|  Beacon publisher ----> approved public contribution only     |
+---------------------------------------------------------------+
```

### 7.1 Suggested monorepo

```text
intoponet/
  README.md
  LICENSE
  CONTRIBUTING.md
  SECURITY.md
  docs/
    PRD.md
    architecture/
      ADR-001-browser-engine.md
      threat-model.md
      privacy-data-flows.md
      data-contracts.md
    design/
      tokens.md
      motion.md
      accessibility.md
  apps/
    desktop/                # browser host, packaging, updates
    explorer/               # trusted React application shell
  packages/
    ui/                     # proprietary Intoponet visual components (open source)
    field-engine/           # data-to-frequency mapping, GPU shaders
    geo/                    # globe projections, geographic aggregation
    browser-api/            # stable typed host abstraction
    discovery-schema/       # public topic/resource/signal contracts
    knowledge-core/         # local graph, provenance, persistence
    laya-runtime/           # local model adapter and inference
    olds-core/              # historical relationship and timeline tools
    beacon-client/          # explicit public contribution flows
  services/                 # optional, later: federated public field nodes
    field-aggregator/
    beacon-registry/
  experiments/
    cef-compositor/
    electron-compositor/
    globe-field-transition/
    passpoint-roaming/
  tests/
    security/
    e2e/
    performance/
    accessibility/
```

This is a target layout, not a commitment to a specific package manager. Keep the browser host behind a stable API so the shell and knowledge subsystems survive an engine migration.

### 7.2 Proposed technology choices

| Layer | Candidate | Decision status |
|---|---|---|
| Website engine | Chromium via CEF or Electron | Spike/ADR required |
| Shell | React + TypeScript | Proposed |
| UI primitives | Radix/shadcn patterns, custom Intoponet tokens | Proposed; review licenses |
| Animation | Motion for React UI, native compositor for webviews | Proposed |
| 3D field | Three.js + React Three Fiber + custom GLSL/WGSL as appropriate | Proposed |
| Globe | Globe.GL or MapLibre, test globe/field transition | Spike required |
| Local persistence | SQLite + FTS5 + `sqlite-vec` or equivalent | Proposed |
| Knowledge relationships | Indexed SQLite edge tables initially | Proposed |
| On-device embeddings | Transformers.js / ONNX Runtime | Prototype |
| Optional local LLM | llama.cpp or platform-native runtime | Later |
| Security keys | OS keychain / platform secure storage | Proposed |
| Public sources | RSS, open datasets, structured metadata, archives | Licensing/source review |
| Community Wi-Fi | OpenWrt, Passpoint, FreeRADIUS, supported router APIs | Separate research track |

Review dependency licenses, security, maintenance health and model-weight licenses before release. No unverified dependency should be treated as a guaranteed integration.

## 8. Data architecture and schemas

### 8.1 Public data contracts (illustrative JSON)

```json
{
  "topic_id": "topic:example:housing",
  "label": "Housing affordability",
  "aliases": ["housing costs"],
  "categories": ["housing", "economics"],
  "source_refs": ["src:abc123"],
  "geographic_scope": {"type": "region", "id": "CA-NS"},
  "observed_window": {"start": "2026-10-22T00:00:00Z", "end": "2026-10-23T00:00:00Z"},
  "signal_metrics": {
    "eligible_count": 42,
    "source_diversity": 0.65,
    "normalized_intensity": 0.58,
    "momentum": 0.12,
    "coverage_confidence": 0.43
  },
  "algorithm_version": "field-v0",
  "snapshot_id": "snapshot:example"
}
```

Numbers are examples, not live measurements. A topic has many associated sources, temporal windows and optional geographic extents. Public data does not contain user browsing identifiers.

### 8.2 Local schema (conceptual SQL)

```sql
CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  canonical_url TEXT,
  title TEXT,
  source_type TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT,
  content_hash TEXT
);
CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  visited_at TEXT NOT NULL,
  private_session INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  field_anchor_json TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  user_pinned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE collection_members (
  collection_id TEXT NOT NULL REFERENCES collections(id),
  resource_id TEXT NOT NULL REFERENCES resources(id),
  explanation TEXT,
  PRIMARY KEY (collection_id, resource_id)
);
CREATE TABLE knowledge_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL,
  provenance_json TEXT NOT NULL
);
CREATE TABLE knowledge_edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  epistemic_status TEXT NOT NULL,
  provenance_json TEXT NOT NULL
);
CREATE TABLE absorbed_sources (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id),
  extracted_at TEXT NOT NULL,
  extraction_model_version TEXT,
  consent_scope_json TEXT NOT NULL
);
```

Use local encrypted-at-rest database strategy with clear key-management and recovery design. SQLite alone is not encrypted; use an appropriate vetted encryption layer where required. Vector embeddings should be stored in an encrypted local store and keyed to source IDs. Private browsing sessions must never write to persistent visit/knowledge tables.

### 8.3 Provenance and historical edges

```json
{
  "edge_id": "edge:123",
  "from": "event:historic-policy",
  "to": "event:present-issue",
  "relationship_type": "contributed_to",
  "epistemic_status": "contested",
  "citations": [
    {"url": "https://example.org/archive", "title": "Archival source", "published_at": "1980-01-01", "passage_ref": "p12"}
  ],
  "attribution": "Interpretation attributed to a named source",
  "reviewed_at": null
}
```

Never transform an `analogous_to` or `preceded_by` edge into a causal claim without additional evidence.

### 8.4 Data retention and portability

- All private history and Laya data have user-configurable retention and one-click deletion.
- Export resources, notes, bookmarks, collection membership, graph nodes/edges and citations in documented portable JSON/JSON-LD or compatible formats.
- Bookmark export includes the selected topic/tag associations and optional anchor coordinates plus anchor provenance/type (user-selected place or user-placed point). Version the added fields and preserve import of existing records whose `field_anchor_json` is null or uses the earlier format; migrations must not assign inferred coordinates.
- No mandatory account or cloud synchronization.
- If device-to-device sync is ever added, it must be explicitly opted in, end-to-end encrypted with user-held keys, and reviewed against the strict “personal data never off device” requirement. Under the current requirement, **do not implement sync that transfers personal data to another device** without revisiting that product decision.
- Device backups are controlled by OS settings; provide warnings and options for excluding local knowledge stores from cloud backups where feasible.


## 9. Public discovery and frequency computation

### 9.1 Data pipeline

Start with a limited, documented set of legally usable public sources: RSS/Atom, official open data, research repositories, archive metadata, structured webpage metadata and opt-in submissions. Track license, attribution, refresh cadence, geographic scope, time window and coverage gaps. Link to original material rather than republishing protected text.

```text
Public source -> fetch -> normalize -> deduplicate -> associate topic/time/place
              -> validate provenance -> aggregate -> versioned field snapshot
              -> browser field renderer
```

The public service must **never** ingest private browser history or Laya data. Classification can initially use publisher tags and transparent deterministic rules; automated inference is a future research feature, not an assumed source of truth.

### 9.2 Experimental field algorithm

For topic `t`, region `r` and window `w`:

```text
raw(t,r,w) = sum(eligible_source_weight * recency * geographic_relevance * dedup_factor)
intensity = clamp(log1p(raw) / log1p(reference_scale), 0, 1)
```

This is a **hypothesis**, not a validated measure of human interest. Source independence, weighting, coverage bias, manipulation resistance and uncertainty require research. Do not derive private attention from browsing data. Public beacons are a separate, capped input.

A GPU field may use bounded kernels: `F(p,t) = Σ amplitude_i(t) * K(distance(p,center_i),radius_i) + relationship_interference(p,t)`. This is a visualization metaphor, not literal radio frequency. Aggregate semantically when zooming; don't simply enlarge a heatmap. Preserve a non-spatial accessible view.

### 9.3 Integrity safeguards

Deduplicate syndicated sources; disclose input coverage; version algorithms and snapshots; apply rate limits and diminishing returns; identify likely coordinated amplification; allow source challenges; avoid letting global popularity erase locally important subjects. No system can guarantee detection of all fake participation without tradeoffs in privacy and access.

## 10. Laya on-device pipeline

```text
User selects Absorb -> trusted browser host checks origin and sensitive-site policy
  -> preview allowed text -> local IPC to isolated Laya worker
  -> chunk + embed + classify + suggest graph links -> encrypted local store
  -> user inspects/edits -> local semantic search with citations
```

The Laya worker has **no outbound network permission**. Model files may be downloaded separately with consent and verified hashes; no personal prompts, browsing data, embeddings or inference are transmitted. Start with a small embedding model via Transformers.js/ONNX Runtime or comparable local stack; evaluate optional llama.cpp or platform-native language model after performance testing. Provide manual collections and full browser operation with Laya disabled.

Retrieval combines SQLite FTS5, local vector similarity and explicit graph traversal. Every answer should reference saved sources. A model-suggested relation is not a verified historical fact. Treat webpage text as untrusted; never execute instructions found inside a page.

## 11. Security threat model

| Threat | Mitigation |
|---|---|
| Hostile website exploits renderer | Chromium sandbox, site isolation, fast upstream security patches |
| Website reaches privileged Laya or local graph | No direct page-to-privileged bridge; typed validated origin-checked IPC |
| Prompt injection in absorbed pages | Untrusted-data boundary, no privileged autonomous actions, citations |
| Phishing via translucent UI | Clear URL/origin and TLS status; permission and download warnings |
| Compromised dependency/model | Lockfiles, SBOM, verified model hashes, dependency and license review |
| Manipulated public source or beacon brigading | Provenance, dedup, bounded weights, abuse reporting, auditability |
| Device theft | Encrypted local database and OS-protected keys where available |
| Leaky diagnostics | No default telemetry; opt-in redacted crash diagnostics only |
| Malicious public Wi-Fi | Strong TLS, router isolation, authenticated Wi-Fi where possible |

Release blockers: unsandboxed arbitrary websites, privileged Node/native bridges in webpages, hidden cloud inference, private data in logs, unresolved critical Chromium vulnerabilities, and unreviewed external data flows. Independent security assessment required before public beta.

## 12. Accessibility, internationalization and offline

Target WCAG 2.2 AA for the shell. Provide keyboard navigation, VoiceOver support, focus management, reduced motion, reduced transparency, high contrast, scalable type and a list/tree alternative to spatial exploration. Support localization, Unicode, right-to-left scripts, localized dates and place names. Offline access includes locally retained bookmarks, absorbed permitted content, graph and Laya; public field snapshots must show stale timestamps, and external websites cannot be assumed accessible offline.

## 13. Community connectivity: separate long-term workstream

**Goal:** free-to-use, open-source, community-operated connectivity that may reduce cellular data dependence. Do not make it a prerequisite for Intoponet browser release.

**Physical constraints:** existing devices can form some local links, but cannot guarantee a citywide broadband blanket; a radio link is not global internet access; a website cannot universally configure consumer ISP modems; Passpoint/OpenRoaming assists authentication but does not guarantee uninterrupted IP sessions; Bluetooth/LoRa support limited-bandwidth use cases; ISP agreements and Canadian spectrum rules must be reviewed.

**Proposed path:** inventory supported routers and ISP terms → OpenWrt/compatible router adapter → isolated guest SSID/VLAN with bandwidth limits and rollback → Passpoint/FreeRADIUS authentication → permitted small corridor pilot → federated community operators. Potential tools include OpenWrt, hostapd, FreeRADIUS, WireGuard where justified, and documented vendor APIs. Never ask a user to enter router administrator credentials into a hosted website. Use local trusted authorization and verify firewall isolation before enabling sharing.

**Network pilot success:** 10–20 permitted sites, repeatable phone enrolment, measured walking-route coverage and reconnection time, independently validated guest isolation, transparent operational costs. Free to use is not zero cost to operate.

## 14. Open-source governance

Choose a license after reviewing patent/copyright implications (candidates: Apache-2.0 or MPL-2.0). Publish LICENSE, NOTICE, CONTRIBUTING, SECURITY, a code of conduct, third-party attribution, model licenses, SBOM and reproducible build instructions. Signed releases, responsible disclosure, public architecture decision records and documented federation protocols are required. Open source alone does not guarantee decentralized governance: communities must be able to run independent public-field nodes without a permanent central gatekeeper.

## 15. Delivery roadmap and acceptance gates

### Phase 0 — Engine and compositor spike (estimated 2–4 weeks)

Build equivalent CEF and Electron prototypes: a real HTTPS page animated above a GPU frequency field; resize, scroll, text input, IME, permission dialogs, video, accessibility and crash recovery. Measure frame time, input latency, memory, maintenance complexity and sandboxing. Publish ADR-001 selecting the host. **Gate:** usable real webpage and coherent animation without unsafe privilege exposure.

### Phase 1 — Premium browser shell (4–8 additional weeks, estimate)

Full-screen synthetic field explicitly marked demo, liquid-glass controls, command launcher, URL navigation, Chromium panels, local state persistence, bookmark flag, keyboard shortcuts and accessible alternative. **Gate:** browse an arbitrary HTTPS website, use forms, close/restore panel and return to original field state.

**Personal world pin status: PARTIAL — pending verification.** The browser pin/bookmark workflow is not considered complete until the browser action works in panel and full-width modes, private records round-trip through persistence and backward-compatible export/import, and the selected marker is visibly shown/hidden and revisited on the personal map. The first implementation supports one topic tag, a note, and an optional known or manually entered geographic anchor. Native checks verified the browser pin editor, save and page restoration, My map listing, Show on globe camera focus and a violet marker, editing a geographic pin into a conceptual pin, and deleting the temporary test record. Persistence tests verify legacy compatibility, coordinate validation and anchor round-trips. Multiple tags, marker filtering/hiding, and full-width/focus restoration acceptance remain pending; this checkpoint is not full PRD acceptance.

### Phase 2 — Real-world field (6–10 additional weeks, estimate)

Limited licensed/open sources, versioned public snapshots, Earth-to-local exploration, explainable activity metrics, coverage confidence and original-source panels. **Gate:** real attributable source updates drive a region's field; simulated data is never misrepresented.

### Phase 3 — Local knowledge and Laya (6–10 additional weeks, estimate)

Local encrypted storage, footprints, collections, Absorb, citations, embeddings, semantic retrieval, export/delete and sensitive-site exclusions. **Gate:** source can be absorbed and retrieved with outbound Laya network blocked; full browser remains functional without model.

### Phase 4 — The Olds (6–10 additional weeks, estimate)

Curated source-backed historical graph, typed links, temporal scrubber, conflicting interpretations and original archives. **Gate:** multi-step historical exploration is independently auditable; analogy/chronology are not displayed as causation.

### Phase 5 — Beacons and federation (timeline TBD)

Explicit consent and publishing, privacy-respecting abuse controls, bounded prominence, revocation policy, independent operator documentation. **Gate:** no private graph or history leaks, anti-brigading testing, moderation process and privacy review.

### Phase 6 — Platforms and networks (parallel research)

Windows, later mobile feasibility, more browser compatibility, community Wi-Fi pilots and optional decentralized transport support. Estimates exclude legal approvals, audits, staffing constraints and complex upstream security work.

## 16. Test strategy

**Unit:** field math bounds, deduplication, source provenance, graph relation types, bookmark lifecycle, IPC validation, permissions.

**Integration:** native Chromium view lifecycle, animations, local DB migrations, local model inference, source ingestion, downloads, offline behavior.

**E2E journeys:** globe → local topic → real site → back to field; direct URL → login/form → download; bookmark → collection → export/delete; Absorb → citation retrieval offline; Olds → historic source; beacon preview → publish/withdraw; Laya network blocked → still functions.

**Security:** sandbox isolation, IPC fuzzing, phishing/origin display, malicious downloads, certificate errors, prompt injection, dependency scans, local data encryption, outbound packet capture and update rollback.

**Performance:** 1080p/4K, baseline Mac hardware, multiple browser views, continuous resize/scroll, GPU contention, battery and thermal impact, reduced motion and assistive technology.

**Usability:** compare discovery, comprehension, direct-navigation speed, return-to-context and trust against conventional browser/search workflows. Optimize usefulness, not session duration.

## 17. Success metrics and guardrails

**North-star:** meaningful discovery and comprehension with preserved user agency and verifiable sources.

Measure opt-in study outcomes: time to useful original source, direct URL task completion, exploration context retention, cited historical understanding, bookmark/collection retrieval, crash rate and frame times. Do **not** instrument silent behavioural analytics. Field-quality metrics: source diversity, provenance coverage, deduplication, contestation resolution and explicit uncertainty. Privacy release gate: zero unauthorized off-device personal data transfer.

## 18. Risks and unresolved decisions

| Issue | Decision / mitigation |
|---|---|
| CEF native webview animation is poor | Benchmark Electron; consider hybrid snapshot-to-live transition |
| Chromium update workload | Dedicated maintainer, automated release pipeline, emergency patches |
| Public interest data sparse or biased | Narrow pilot geography, coverage labels, transparent sources |
| Immersive field slows basic browsing | Direct URL always available, keyboard-first launcher |
| Laya model too heavy | Small embeddings first, CPU fallback, optional LLM |
| Historical connections hallucinated | Typed edges, citations, reviewed corpus, contested status |
| Beacons gamed | Bounded prominence, privacy-respecting rate limits, review |
| Copyright / source restrictions | Link-first, permitted excerpts, per-source license registry |
| ISP restrictions on sharing | Contract review and written permissions before pilot |
| Community hosting costs | Transparent donations/volunteer operations, no false zero-cost claims |

**Open ADRs:** ADR-001 CEF vs Electron; ADR-002 native vs off-screen rendering; ADR-003 globe renderer; ADR-004 local encryption and backup exclusion; ADR-005 public source governance; ADR-006 beacon anti-Sybil approach; ADR-007 browser update/extension/DRM policy; ADR-008 federation protocols.

## 19. First implementation backlog

| ID | Priority | Deliverable | Acceptance |
|---|---|---|---|
| P0-01 | P0 | CEF compositor spike | Interactive page over GPU field with measured performance |
| P0-02 | P0 | Electron comparator | Equivalent workflow and measurements |
| P0-03 | P0 | Browser host abstraction | Typed API independent of selected engine |
| P0-04 | P0 | Security architecture | Sandboxed webpage, no privileged bridge |
| P1-01 | P0 | Full-screen frequency shader | Stable 60-fps target on baseline hardware |
| P1-02 | P0 | Glass design tokens | Accessible component states and contrast |
| P1-03 | P0 | Command launcher | Direct URL and explore-topic modes |
| P1-04 | P0 | Animated website panel | Open, resize, focus, close, restore |
| P1-05 | P1 | Local bookmark store | Saved field token and deletion |
| P1-06 | P1 | Browser page to personal-world pin | Pin action in panel and full-width chrome; select topic/tag and optional explicitly sourced geographic anchor; save/edit/unpin/revisit; show/hide the local marker on the map; backward-compatible export/import; keyboard and native-content occlusion checks. **Status: partial, pending verification.** |
| P2-01 | P0 | Source registry and provenance | Every field source attributable |
| P2-02 | P0 | Public snapshot schema | Versioned reproducible field input |
| P2-03 | P1 | Globe/local camera transitions | Context-preserving semantic zoom |
| P3-01 | P0 | Encrypted local data layer | No private data in public service |
| P3-02 | P0 | Absorb workflow | Explicit local index with citations |
| P3-03 | P0 | Laya network isolation | Offline inference with egress test |
| P3-04 | P1 | Collection grouping | Explainable, editable private clusters |
| P4-01 | P1 | Historical graph and time scrubber | Source-backed typed edges |
| P5-01 | P2 | Beacon consent and publication | Reviewed minimal public payload |

## 20. Definition of done

A feature is done only when: functionality and error states are implemented; original websites remain functional; permission and privacy boundaries are tested; keyboard/accessibility and reduced-motion behaviour work; unit/integration/E2E tests cover critical paths; performance impact is measured; dependencies and licenses are documented; no unapproved network egress exists; documentation and migration notes are updated; and security review requirements are satisfied.

## 21. Reference projects for evaluation

These are candidates, not pre-approved dependencies; check current maintenance, API stability, license and security before adoption.

- Chromium: https://www.chromium.org/
- Chromium Embedded Framework: https://bitbucket.org/chromiumembedded/cef
- Electron: https://www.electronjs.org/
- Three.js: https://threejs.org/
- React Three Fiber: https://github.com/pmndrs/react-three-fiber
- Globe.GL: https://globe.gl/
- MapLibre: https://maplibre.org/
- shadcn/ui: https://ui.shadcn.com/
- Motion: https://motion.dev/
- React Force Graph: https://github.com/vasturiano/react-force-graph
- SQLite: https://www.sqlite.org/
- sqlite-vec: https://github.com/asg017/sqlite-vec
- Transformers.js: https://github.com/huggingface/transformers.js
- llama.cpp: https://github.com/ggml-org/llama.cpp
- OpenWrt: https://openwrt.org/
- hostapd: https://w1.fi/hostapd/
- FreeRADIUS: https://freeradius.org/
- Wireless Broadband Alliance / OpenRoaming: https://wballiance.com/openroaming/
- NYC Mesh: https://www.nycmesh.net/
- Freifunk: https://freifunk.net/

## 22. Immediate next action

**Do not start by building the full decentralized network or planetary data service.** Create the repository, copy this file to `docs/PRD.md`, and execute Phase 0: CEF vs Electron Chromium surface compositing over a beautiful GPU-rendered field. Publish the decision and security model. Then build a genuine browser shell, followed by source-driven discovery and local Laya.

**Enduring product promise:** *Intoponet helps people explore the world of information, understand its history, and grow their own knowledge—without surrendering control of their attention or personal data.*
