# Intoponet — Living Frequency Topography

**Technical implementation specification v1.1 | 2026-10-23**  
**Audience:** Codex / Cursor engineering agents  
**Related:** `INTOPONET_PRD.md`, `INTOPONET_EARTH_FREQUENCY_SPEC.md`  
**v1.1 change:** RSS/news-first global ingestion, every-country/city coverage model, event lifecycle, freshness targets, explicit geographic normalization and honest coverage reporting.

> **Core instruction:** The globe's frequency topography must be **alive because observations of public internet activity change its geometry**. It must not be random decorative animation. Earth is recognizable; the frequency field is a separate, continuous, translucent, GPU-displaced spherical membrane.

## 1. Exact visual target

Render a recognizable, dark, understated Earth suspended in near-black space. Its land, oceans, coastlines and curvature remain visible, with restrained atmospheric scattering. A thin luminous membrane wraps around the planet, just above its surface. This membrane forms smooth, overlapping, moving frequency bands. Concentrations of qualified human-interest activity make the membrane swell; geographically broad activity produces wider wave structures; overlapping activity produces fluid interference; quiet or unobserved areas remain near the sphere. Slow oscillation keeps the surface alive between data updates, but **does not change where interest is located or manufacture new interest**.

- Planet occupies approximately 60–75% of desktop viewport height.
- Colors: obsidian environment, restrained teal/cyan with occasional violet accents; delicate edge lighting and controlled bloom.
- Field is one continuous shell, not individual peaks or objects above countries.
- Topography comes from membrane displacement **not** from Earth's physical elevation.
- No political borders, latitude-longitude grid, labels, pins, heatmap colors or dashboard UI by default. *(Amended 2026-11-06 for the news layer: story summits carry a label and a gold cap; see §21.)*
- Premium fluid motion and glass UI, not a video-game HUD.

**Never produce** *(except the news layer's story mountains, §21)***:** geological mountains, cliffs, cones, Google Earth terrain, choropleth maps, glowing heatmap spots, audio equalizer bars, global latitude stripes, particle-only visualization, generic Perlin-noise ocean, or randomly animated waves disconnected from data.

## 2. Meaning of the field

| Geometry / behaviour | Data meaning |
|---|---|
| Larger smooth displacement | Higher *observed* public interest intensity |
| Wider deformation | Broader geographically attributed footprint |
| New localized ripple | Emerging observed subject/event |
| Intersecting waves | Co-occurring/related topics in a geographic area; **not** proof of causation |
| Gradually subsiding waves | Declining observed activity |
| Nearly flat region | Low qualified observation **or** missing coverage; distinguish these |
| Reduced visual certainty | Weak source coverage or geographic confidence |

Interest is not truth, significance, popularity, or agreement. A quiet local issue may still be important. A heavily covered story may reflect media attention rather than residents' concern. Provide a source/coverage inspector on demand.

## 3. System architecture — keep these independent

```text
PUBLIC DATA / EXPLICITLY PUBLISHED SIGNALS
  ↓
Interest Engine
  adapters → normalization → URL canonicalization/deduplication
  → entity/topic mapping → geographic attribution → time buckets
  → independent-source weighting → confidence/coverage estimates
  ↓
Versioned geospatial interest tiles + topic index + provenance manifest
  ↓
Field Engine
  geographically anchored envelopes + finite-width wave corridors
  → bounded multiscale displacement textures → time interpolation
  ↓
Renderer
  Earth mesh + displaced membrane + filaments + lighting + camera
  ↓
Native Chromium webpage panels above scene
```

**Privacy:** Public field ingestion must never read private browsing history, Laya's local knowledge graph, personal embeddings, absorbed content, footprints, or private bookmarks. Beacons enter only through a separate, explicit public-publishing action. Laya and all personal model data stay entirely on-device.

## 4. Real-world data: what we can honestly measure

There is **no universal API for human interest**. The initial live field is a transparent *observed-public-activity index*.

| Source | Can contribute | Important limitation |
|---|---|---|
| [GDELT](https://www.gdeltproject.org/) | Geographically attributed events and volume of news coverage | Media coverage ≠ public opinion; syndicated duplication and uneven coverage |
| [Wikimedia Analytics](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/) | Aggregate pageview trends for topics | Pageview counts do **not** establish readers' geographic location |
| [Wikidata](https://www.wikidata.org/) | Entity relationships and documented locations | Knowledge metadata, not real-time interest |
| Public RSS/publisher feeds | Published stories, times, tagged subjects/places | Publisher coverage and rights vary |
| Civic/research/open records | Publicly documented issues and events | Incomplete, slow and geographically uneven |
| Opt-in Intoponet Beacons (future) | Voluntary public recommendations | Abuse/Sybil protection required; no implicit sharing |

**Critical distinction:** `about_location` is where a story's subject/event occurs; `audience_location` is where a reader is. **Do not infer audience location from an article or pageview.** First live version should use qualified **about-location** signals, explicitly labeled. Global/abstract topics without defensible geographic anchors belong in a non-geographic topic layer, not at invented coordinates.

Before implementing each connector, verify API availability, terms, rate limits, licensing and allowed retention. Do not claim worldwide real-time completeness.

### Qualification rules

- Canonicalize URLs and detect duplicates/syndication; measure independent sources, not raw article count.
- Cap per-publisher influence; use source diversity, recent historical baseline and confidence measures.
- Separate intensity, momentum, geographic confidence and coverage confidence.
- Expose provenance, last-update time and methodology. Flag suspicious spikes.
- Missing coverage must not be displayed as lack of human interest.
- Never accept advertising spend, followers, passive private browsing, or paid promotion as field intensity.

## 5. Data contracts

```ts
type Anchor = { lat:number; lon:number; weight:number; radiusKm:number };
type InterestSignal = {
  schemaVersion:'1.0'; id:string; topicId:string;
  sourceType:'synthetic'|'gdelt'|'wikimedia'|'rss'|'civic'|'beacon';
  geographyKind:'about_location'|'audience_location'|'global'|'unknown';
  anchors:Anchor[]; // empty for global/unknown
  observationStart:string; observationEnd:string; // UTC ISO
  intensity:number;          // normalized [0,1]
  momentum:number;           // [-1,1]
  geoConfidence:number;      // [0,1]
  coverageConfidence:number; // [0,1]
  independentSourceCount:number;
  provenanceIds:string[]; updatedAt:string;
};
type FrequencyBand = {
  id:string; topicIds:string[];
  centerline:{lat:number;lon:number}[]; // WGS84
  widthKm:number; wavelengthKm:number;
  amplitude:number; phase:number; phaseVelocity:number;
  confidence:number; updatedAt:string;
};
```

Synthetic fixture example, **not a real Halifax observation**:

```json
{
 "schemaVersion":"1.0","id":"demo-001","topicId":"housing-affordability",
 "sourceType":"synthetic","geographyKind":"about_location",
 "anchors":[{"lat":44.65,"lon":-63.57,"weight":1,"radiusKm":45}],
 "observationStart":"2026-10-23T18:00:00Z","observationEnd":"2026-10-23T19:00:00Z",
 "intensity":0.78,"momentum":0.35,"geoConfidence":0.85,
 "coverageConfidence":0.68,"independentSourceCount":12,
 "provenanceIds":["demo-a","demo-b"],"updatedAt":"2026-10-23T19:00:00Z"
}
```

Reject malformed inputs, NaNs, impossible coordinates, unbounded radii and oversized payloads. Public tiles must reference a provenance manifest. Never execute code or shader strings from data feeds.

## 6. Geometry: data becomes topography

Use WGS84 for source locations and a consistent Y-up unit sphere for rendering. Convert kilometres to spherical distance. For unit vectors `u`, `v`:

```text
dKm(u,v) = 6371 * acos(clamp(dot(u,v), -1, 1))
```

A localized signal creates a **broad envelope**:

```text
E_i(p) = a_i * exp(-0.5 * (dKm(p,c_i)/sigma_i)^2)
```

**Do not stop here:** Gaussians alone look like mountains. A frequency band is a finite-width, geographically anchored **wave corridor**. Let `q_i` be cross-track distance to its centerline and `s_i` be distance along it:

```text
B_i(p,t) = a_i * exp(-0.5 * (q_i(p)/width_i)^2)
         * [1 + beta * sin(2*pi*s_i(p)/wavelength_i - omega_i*t + phase_i)]
```

Start with `beta=0.08–0.20`; phase velocity is slow and purely visual. Corridors may curve and intersect based on qualified geographic/topic relationships. **Never generate arbitrary global stripes.** Broad envelopes carry most of the actual activity signal; wave modulation gives them fluid character.

Combine all qualified contributions using a bounded saturating function rather than a raw unbounded sum:

```text
S(p,t) = max(0, sum_i weightedContribution_i(p,t))
D(p,t) = Dmax * (1 - exp(-k*S(p,t)))
P(p,t) = [R + h0 + D(p,t)] * normal(p)
```

`R=1`, initial `h0≈0.012R` and `Dmax≈0.045R` are **art-direction starting values**, not literal elevation. Tune until shapes read as flowing frequency, not mountains. Compute smooth normals and avoid tile seams.

### GPU implementation

Do not loop through thousands of signals per vertex. Aggregate data into multi-resolution geographic tiles (cubemap preferred or properly wrapped equirectangular textures), with channels for intensity, momentum, confidence and coverage. Generate displacement textures on CPU/GPU; sample them in vertex shaders. Maintain a consistent base field across LODs. At city scale reveal finer **observed** structure only when finer evidence exists. No fabricated city-scale detail from national-level data.

## 7. Four separate clocks

1. **Observation time:** actual timestamp and bucket of public source activity.
2. **Snapshot transition:** interpolate validated field updates smoothly over ~10–30 seconds.
3. **Material phase:** restrained background oscillation; cannot invent new intensity or locations.
4. **Historical time:** explicit user-controlled time exploration, later tied to The Olds.

A fixed snapshot must maintain stable centers, widths and baseline amplitudes. If an intensity grows, the corresponding membrane area lifts; if reach expands, the area widens; if activity falls, it settles. If data is stale, disclose staleness instead of simulating activity. Suggested source polling: 5–30 minutes where permitted; aggregate in 15–60-minute UTC buckets, with historical baselines. Actual cadences depend on provider limits.

## 8. Planet → region → city → topic

| View | Earth | Field | Data |
|---|---|---|---|
| Planet | Whole recognizable sphere | Broad wrapped waves | Coarse global/regional tiles |
| Region | Curvature remains visible | Bands separate into regional structures | Regional tiles |
| City | Subdued geographic substrate | Finer wave structure, related subjects | City tiles **where available** |
| Topic | Geography recedes, origin retained | Selected frequency becomes immersive | Source-backed topic graph |

Camera zoom must be smooth, reversible, interruptible and geographically stable. Crossfade LODs without popping. No hard switch to a flat map, terrain mesh or dashboard.

**Opening a real webpage:** Animate a translucent liquid-glass side window (desktop) or bottom sheet (mobile) from the selected frequency. The webpage is **actual Chromium-rendered content**, not a screenshot or simulated iframe browser. Keep the Earth/field alive but reduce motion and contrast behind the panel. Closing restores the exact camera, selected frequency and context.

## 9. Rendering and performance

- Earth mesh: licensed subdued textures, atmospheric limb, realistic curvature; no DEM-driven frequency elevation.
- Membrane: independent tessellated sphere, GPU radial displacement, translucent physically inspired material and delicate luminous filaments.
- Shaders: stable deterministic phases, no flickering, bounded displacement, proper depth/transparency sorting.
- Prototype stack: Three.js + React Three Fiber acceptable; keep Field Engine renderer-agnostic for future Chromium/CEF compositor.
- Aim for 60 fps on representative desktop hardware, 120 fps where feasible; profile GPU/CPU/memory/battery. Adapt tile resolution, shader detail and bloom.
- Accessibility: reduced-motion freezes decorative phase, preserves meaningful data transitions; keyboard navigation, high-contrast and list/search fallback.

## 10. Deterministic synthetic test scenes

Implement fixtures with fixed seeds before integrating public APIs:

1. **Quiet Earth:** near-flat membrane, minimal breathing.
2. **Single local signal:** only one geographic region rises.
3. **Intensity change:** fixed radius, increasing intensity → taller smooth displacement.
4. **Reach change:** fixed intensity, increasing radius → wider field, not a taller spike.
5. **Two overlapping signals:** smooth interference, not isolated mountains.
6. **Multi-region topic:** separate documented locations; no invented global ring.
7. **Decay:** signal weakens and surface settles continuously.
8. **Missing data:** uncertain region is distinguishable from measured low activity.
9. **Pole/antimeridian:** no seam or abrupt coordinate jump.
10. **Stale feed:** no artificial activity surge; last-update information visible on demand.

## 11. Acceptance criteria

- [ ] Recognizable Earth, separate continuous translucent membrane.
- [ ] Field reads as fluid frequency topography, **not mountains or heatmap**.
- [ ] Geometry demonstrably responds to data intensity, geographic reach and overlapping activity.
- [ ] Motion is organic but not disconnected from source observations.
- [ ] About-location never masquerades as audience-location.
- [ ] Real data has source provenance, timestamp, confidence and coverage.
- [ ] Synthetic data never appears as live public interest.
- [ ] No private Laya/history/bookmark data is transmitted or counted automatically.
- [ ] Smooth globe-to-topic LOD, no pops or seams.
- [ ] Functional Chromium website panel opens and closes without losing field context.
- [ ] Reduced-motion mode and measurable performance targets.

## 12. Implementation order for Codex

**A. Visual shell:** Earth + independent membrane + lighting; flat test field.  
**B. Data-reactive geometry:** implement envelopes, finite-width bands and bounded combination; add interactive synthetic controls.  
**C. Field texture pipeline:** multiscale geographic tiles, deterministic fixtures, temporal interpolation, confidence/coverage channels.  
**D. Camera and LOD:** continuous planet→region→city→topic with stable anchors.  
**E. Website compositing:** actual Chromium page in glass side panel / bottom sheet.  
**F. First real source:** add one legally usable public adapter, provenance inspector, clear “observed public activity” labeling; expand only after validation.  
**G. Hardening:** visual regression, data quality, privacy boundary, accessibility, performance, security and source-license audit.

**Do not build a large data-ingestion backend until A–C visually prove the core concept. Do not substitute synthetic visual noise for the real data contract.**

## 13. Reference image description

> Cinematic orbital view of a recognizable, dark Earth suspended in almost black space. Coastlines and oceans are faintly visible beneath a single continuous, translucent membrane wrapping the entire globe. Delicate teal and cyan frequency bands flow along the sphere and interfere with restrained violet accents. Regions of observed public interest gently lift the membrane into broad, fluid, wave-like deformations; quieter regions lie almost flush against Earth. The geometry is elegant and smooth, neither mountains nor map heatmaps. Soft atmospheric glow, subtle refraction and finely controlled luminous highlights. Premium, minimal, scientific, alive. No labels, grids, pins, charts, glowing point clouds, country extrusion, audio bars or sci-fi HUD.

## 14. Final instruction to implementation agent

**The first demonstration must make the causal chain obvious:** change a synthetic human-interest signal → its correct location on Earth deforms → neighboring wave bands interact → the topography smoothly morphs → zoom preserves the same signal and reveals finer legitimate structure → clicking its source opens a real website without leaving the living world. If the shader looks beautiful but changing the data does not meaningfully alter the field, the implementation is incorrect.


---

## 15. v1.1 product requirement — global, city-level, continuously updating coverage

**Required end state:** A user can view the Earth and see evolving frequency topography attributable to observable public information activity about places **across every country**, then zoom into regions and cities to inspect the stories and discussions behind each deformation. The field must update as RSS feeds, news reporting and qualified public conversations change. **Global addressability is a product requirement, not a claim of complete real-time observation:** coverage will vary, and unknown regions must remain explicitly distinguishable from verified low activity.

At every zoom level, keep one coherent geographically anchored signal model; do not replace the global field with a disconnected city dashboard. The renderer receives only normalized geospatial tiles, topic relationships, confidence and provenance. Source-specific logic belongs upstream.

### Scale-specific semantics

| Scale | What is aggregated | Required behaviour |
|---|---|---|
| Planet | Geographic distribution of qualified public activity across all indexed regions | Broad, coherent bands; small local stories cannot dominate globally but remain recoverable by zoom |
| Country | National and regional issues, localized stories, cross-border relationships | Country-relative baselines and coverage indicators; no arbitrary political-border extrusion |
| Province/state | Regional publications, public records and local discussion | Increased spatial resolution; preserve signal identity across LOD |
| City | City/local RSS, municipal publications, local reporting, voluntary public signals | Small local stories can generate visible local frequency activity |
| Neighbourhood | Hyperlocal sources where defensible location evidence exists | Do not invent block-level precision from city-level reporting |
| Topic | Story cluster, source documents, publication timeline, public discussion and The Olds | Explain the field with original links, timestamps and evidence |

### Fundamental rules

1. A story **about** a city may shape that city's *about-location* field, regardless of where the publisher is based. It does not prove city residents are discussing it.
2. A globally discussed event may have multiple qualified geographic anchors; do not place it only at a publisher's headquarters.
3. Count independent editorial/publication activity and corroborated events, **not** syndicated copies, repeated reposts or page refreshes.
4. Normalize within comparable geographic and language coverage cohorts. Do not let publication volume in a large country erase small-city signals.
5. Distinguish **observed activity**, **estimated interest**, **coverage confidence**, and **importance**. The renderer must never present them as interchangeable.
6. A lack of source observations is an **unknown/under-observed** state, not a claim that people there are uninterested.

## 16. Global source registry and ingestion architecture

Build an extensible, legally compliant **source registry** with RSS/Atom as first-class adapters and GDELT as a complementary discovery/coverage source. Do not rely on one aggregator for all locations.

```text
Open source registry (source URL, language, geographic scope, terms, health)
   ├─ RSS / Atom feeds: local, regional, national, specialist, public bodies
   ├─ GDELT: news/event discovery and geographic enrichment
   ├─ Public discussion APIs: only explicitly permitted public content
   ├─ Wikidata: entities and geographic knowledge (not activity)
   ├─ Wikimedia: aggregate topic context (not inferred reader geography)
   └─ Future public Intoponet Beacons: explicitly published only
          ↓
Per-source scheduler → fetch / conditional GET → parser → canonical URL
          ↓
Language detection → duplicate/syndication clustering → topic/event clustering
          ↓
Entity extraction → geographic attribution with evidence + confidence
          ↓
Time buckets → independent-source counts → baseline normalization
          ↓
Coverage + provenance manifests → versioned geographic tile publication
          ↓
Frequency Engine → GPU membrane renderer
```

### Source registry schema (proposed)

```ts
type SourceRecord = {
  sourceId: string;
  kind: 'rss'|'atom'|'gdelt'|'public_api'|'civic'|'beacon';
  url: string;
  publisherName: string;
  languageTags: string[]; // BCP 47
  declaredCoverage: {countryCodes:string[]; regionIds?:string[]; cityIds?:string[]};
  geographicScope: 'local'|'regional'|'national'|'international'|'unknown';
  licenseStatus: 'approved'|'review_required'|'blocked';
  termsUrl?: string;
  pollingMinSeconds: number;
  etag?: string; lastModified?: string;
  lastSuccessfulFetchAt?: string;
  lastObservedItemAt?: string;
  health: 'healthy'|'stale'|'error'|'disabled';
  independentPublisherGroupId: string;
};

type PublicItem = {
  id:string; sourceId:string; canonicalUrl:string; title:string;
  publishedAt?:string; discoveredAt:string; language:string;
  sourceContentHash:string; syndicationClusterId?:string;
  topicIds:string[]; eventClusterId?:string;
  aboutLocations:{placeId:string; lat:number; lon:number; radiusKm:number;
    confidence:number; evidence:'explicit'|'entity_linked'|'inferred'}[];
  provenanceId:string;
};

type TileObservation = {
  tileId:string; resolution:number; bucketStart:string; bucketEnd:string;
  topicId:string; observedActivity:number; normalizedIntensity:number;
  momentum:number; independentSourceCount:number; itemCount:number;
  geographicConfidence:number; coverageConfidence:number;
  coverageState:'observed'|'low_observed'|'insufficient'|'stale';
  provenanceManifestId:string;
};
```

Do not ingest full copyrighted articles indiscriminately. Prefer permitted feed excerpts, metadata, canonical URLs and source references; retain content only under applicable terms. Apply robots, API terms, rate limits, deletion requirements and licensing checks. Never scrape paywalled/private content to populate the public field.

### Scheduling and fault tolerance

- Use per-source adaptive scheduling and `ETag`/`If-Modified-Since` where supported; honour `429`, `Retry-After`, publisher rules and failures.
- Initial targets: RSS refresh **2–5 minutes where allowed**, ingestion-to-index **≤60 seconds** after receipt for normal workloads, public tile publication **30–60 seconds** after qualified change. These are **engineering targets, not guarantees of live coverage**.
- Use idempotent jobs, deduplication keys, durable queues, exponential backoff and dead-letter handling. A feed outage must not erase history or create an artificial drop/spike.
- Record source timestamps separately: `publishedAt`, `discoveredAt`, `processedAt`, `tilePublishedAt`. Display observed freshness, not an unqualified “LIVE” label.
- Maintain a community-contributable registry of local publishers by country, city and language, with review and provenance rather than unverified automatic inclusion.

## 17. Event and topic clustering: from chatter to geographically grounded signals

Pipeline for every incoming item:

1. Parse publisher metadata, headline, timestamp, canonical URL and permitted excerpt.
2. Detect language; normalize multilingual entities without collapsing unrelated events.
3. Cluster identical/syndicated copies separately from independently reported items.
4. Resolve event/topic identifiers using transparent, testable rules; store evidence for merges and splits.
5. Extract *about-location* references; distinguish incident location, organization location and publisher location.
6. Assign geographic confidence. Ambiguous stories remain regional, global or unlocated rather than receiving fabricated coordinates.
7. Bucket by event time and observation time; maintain rolling historical baselines.
8. Produce versioned per-topic, per-geography intensity and momentum with coverage metadata.

**Avoid circular amplification:** 100 syndicated copies must not count as 100 independent confirmations. A social post linking a news article should not automatically count as an independent report. Explicitly track source independence and platform bias.

### Proposed normalized scoring (research baseline, not objective truth)

For geography `g`, topic `q`, time bucket `t`, compute a capped, weighted independent-source activity `A(g,q,t)`; compare it against a rolling, location- and source-coverage-aware baseline `B(g,q,t)`; map the relative change through a bounded monotonic transform. Keep the following independent channels:

- `observedActivity`: qualified independent publication/conversation observations.
- `normalizedIntensity`: local-context normalized activity, clamped to `[0,1]`.
- `momentum`: smoothed recent change relative to baseline, clamped to `[-1,1]`.
- `coverageConfidence`: fraction/quality/freshness of relevant observable sources, not a proxy for population engagement.
- `geographicConfidence`: evidence quality for locating the *subject* of observations.

Use conservative smoothing, publisher influence caps and spike anomaly flags. **Do not multiply uncertainty into a fake zero-activity value**; transmit uncertainty as a separate channel to the renderer. Geographic scales must use consistent underlying counts but different normalization windows so local issues remain legible without misrepresenting global intensity.

## 18. How fresh RSS and news activity drives living topography

Example **hypothetical** event lifecycle in Dartmouth:

| Event stage | Pipeline observation | Required field response |
|---|---|---|
| First report | A local RSS source publishes a new, geolocated story | Small, low-confidence disturbance at qualified location |
| Independent corroboration | Separate publisher reports same event | Higher confidence and possibly amplitude, not duplicate spikes |
| Public discussion | Permitted public sources show new independent activity | Additional bounded intensity/momentum, with source-type provenance |
| Regional attention | Independent sources in wider geography cover the event | Broader spatial footprint or linked regional bands, if evidence supports it |
| Activity fades | No new qualified activity over subsequent windows | Smooth settling; source and historical thread persist |
| Source outage | Feeds become unavailable | Mark stale/unknown; **do not** simulate falling public interest |

**Renderer invariants:** Same normalized tile data yields same large-scale field independent of frame rate. Subtle oscillation may move phase, but may not relocate an event, invent a new peak or generate activity in unobserved regions. No feed item may directly provide shader code or unrestricted rendering parameters.

## 19. Geographic tiles, level of detail and global coverage

- Maintain a worldwide place hierarchy (country → region → municipality/city → optional neighbourhood), using openly licensed geographic gazetteers and stable IDs. Coverage availability is independent of the place list.
- Use hierarchical geospatial indexing (e.g., H3 or S2 after evaluation) for aggregation; convert to spherical field textures/LOD tiles for GPU sampling.
- Preserve topic/event identity across tile levels; derive coarser tiles from compatible lower-level aggregates rather than recomputing unrelated visuals.
- Use multi-resolution, spatially smooth kernels in physical units (km). At planet scale, aggregate broad footprints; at city scale, reveal supported fine-grained activity. Do not render finer geography than source confidence supports.
- Publish versioned tile manifests with observation interval, freshness, coverage state, normalization version, provenance manifest and schema version.
- Provide a coverage inspector showing the number/diversity/freshness of qualifying sources and why a region is quiet or under-observed.
- Avoid fabricating “every city in real time.” **Every city must be addressable; cities without evidence display an honest insufficient-coverage state.**

### Example tile endpoint (illustrative)

```http
GET /v1/frequency/tiles/{resolution}/{tileId}?from=2026-10-23T20:00:00Z&to=2026-10-23T21:00:00Z
```

Response should contain `TileObservation[]`, a source/coverage manifest reference, `generatedAt`, and `dataFreshnessSeconds`. Use HTTPS, cache validators, compressed responses, input bounds and abuse controls. The browser never uploads local history, Laya embeddings, private collections or implicit pageview signals to request these public tiles.

## 20. Updated Codex implementation milestones and proof of reality

**Phase A — Preserve existing renderer:** Keep Earth, membrane, shaders and deterministic synthetic controls as documented in sections 1–14. Do not replace the field with heatmaps, news pins or dashboard widgets.

**Phase B — Build a real RSS ingestion vertical slice:** Add a source registry, scheduler, parser, canonicalization, independent-publisher grouping, geographic attribution and a versioned tile output. Begin with a legally permitted, diverse sample of local feeds from several countries, including at least one small city; do not claim complete coverage.

**Phase C — Connect source-to-shader:** Publish a test item from a controlled fixture RSS feed; prove it becomes an indexed event, geographic tile update and visible deformation over the correct place within the engineering freshness target. Preserve provenance and show original website in Chromium when selected.

**Phase D — Expand globally:** Add country/city registry, multilingual feed directory, GDELT adapter, coverage scoring and geographic LOD. Make every country navigable, with coverage gaps honestly indicated.

**Phase E — Add richer signals:** Integrate permitted public discussion sources and future explicitly published Beacons; evaluate privacy, platform bias, Sybil abuse and source licensing before each adapter is enabled.

### New acceptance tests

- [ ] A new permitted RSS item about a city produces a correctly geolocated, time-stamped and source-linked tile observation.
- [ ] Its appearance changes the membrane in the correct place; removing/aging observations causes smooth, explainable changes.
- [ ] Syndicated duplicates do not multiply intensity as independent sources.
- [ ] Publisher location is not confused with story location or reader location.
- [ ] A city with five independent local reports remains discoverable when zooming from a globe containing much larger global stories.
- [ ] A city without sources is marked insufficient coverage, **not** zero human interest.
- [ ] Feed failures and stale sources do not create fake momentum or fake declines.
- [ ] Multilingual stories about the same event can link without merging unrelated events.
- [ ] Public tile data exposes timestamps, coverage and provenance; selecting a source opens its real webpage.
- [ ] All source adapters obey documented rights, API rules, retention limits and rate limits.
- [ ] No personal browsing history, Laya processing data or private bookmarks leave the user's device.
- [ ] Synthetic fixtures and real observations are clearly separated in UI and data contracts.

**Final instruction to Codex:** Build a planet-wide, continuously refreshed, *evidence-backed* frequency field. The field is alive because the world's published information changes, not because the shader invents waves. RSS and local reporting are foundational sensors, and local issues must remain visible at the appropriate scale. Never represent a coverage gap as silence, or media volume as a complete measurement of humanity's interests.


## 21. Amendment (2026-11-06): story mountains on the news layer

The product owner amended this spec for the local-news layer. With news on, the terrain shows **story mountains**: each story outlets are covering now is one mountain over the country it is about, with one labelled summit. The user spins the globe to find the highest peak and hovers it to see strands to the other countries that covered the same story. Other layers keep the frequency-field rules above.

Rules that replace §6's shape rules for this layer (code: `shared/news/storyMountains.ts`, `renderer/src/globe/storyTerrain.ts`):

1. **One measure, one fixed scale.** Height is recent independent-outlet coverage: each publisher group counts once per story, weighted by its latest matching headline with a 12-hour half-life. `storyHeight(C) = ln(1+C/4) / (ln(1+C/4) + ln 11)` is strictly increasing and never re-ranked per snapshot, so a quiet day stays low. The shader maps it linearly (no second saturating curve).
2. **The tallest summit is the most-covered story.** Stories combine by their upper envelope (the taller wins at each point, never a sum or union). Summit neighbourhoods carry no decorative relief or warp.
3. **Where a mountain stands.** The country a story is about: its own outlets count once, other countries' headlines naming it count double. The footprint is the places in that country its headlines name or its outlets are based in; national stories stand at the country's anchor (an illustrative position). Countries without working feeds are not quiet: no mountain is drawn where nothing was observed.
4. **Crest.** The top ~15% of each story's own summit is gold (#FFD166) on mountains of about three or more outlets; the #1 summit also carries "▲" in its label. Rising/easing is shown in words and arrows, never by recolouring height.
5. **Strands.** Hovering a summit (or its flank) draws strands to up to 8 other countries that covered the story (16 when pinned by a click), drawn once in the order coverage first appeared there. They show that both covered the same story, not that one copied the other, so they carry no flowing particles. Reduced motion draws them complete.
6. **Wording.** "Height is how many independent outlets in the monitored feeds carried the story, newer coverage counting more. It is not a measure of importance."
