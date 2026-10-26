# Frequency field: appearance, meaning, and coverage

> **Legacy appearance and shader-path notes below:** the corridor geometry and
> band implementation described in the introduction are superseded by the
> continuous-membrane direction. See [Frequency design review](FREQUENCY_DESIGN_REVIEW.md)
> for current requirements and open acceptance. Keep the notes as history; they
> are not visual acceptance evidence.

## Legacy intended appearance and implementation history (superseded)

The Earth is a recognizable, dark geographic reference. A separate translucent
membrane sits just above it. Broad teal wave corridors rise gently where
eligible public records have geographic relevance; restrained violet marks
documented overlap. Measured momentum expresses change; restrained material phase preserves the
data-driven baseline, and saturating
displacement keeps crossings from turning into spikes. At closer scales the
same corridors resolve into finer waves without a hard cut or lost viewpoint.
This is a visual metaphor for a measured field, not radio frequency, terrain,
or a heatmap. No source record is placed at an invented physical coordinate.

The current Three.js shader samples bounded global and local field textures
produced from geodesic arc distance, a Gaussian corridor envelope, a slow cosine
wave, and capped outward displacement. It interpolates snapshot and scale changes
over 15 seconds. Reduced motion freezes the decorative phase while meaningful
snapshot updates continue. Texture sampling and provenance received additional
crash-recovery review on 2026-10-24; visual acceptance remains open. A 2026-10-23 probe found that the GPU received band
vectors with `uCount = 0`; it also found a phase trough that hid bands under
reduced motion. Both technical faults are corrected. Deterministic captures in
`experiments/field-visual-qa` now show a circular teal patch at Earth scale,
which fails the intended flowing-corridor identity. `FIELD_VISUAL_QA` remains
open pending shape work and the ten deterministic scenes required by the
[living topography spec](<INTOPONET_LIVING_FREQUENCY_TOPOGRAPHY_SPEC (1).md>).
That written spec now supplies the visual target; shared-chat access is not a gate.

## What the field measures today

The prototype does **not** index the Internet. It requests up to four English
Wikipedia geosearch results near each of four fixed public anchors and uses
recent Wikimedia pageviews as a bounded weight. It also reads up to six USGS
earthquakes of magnitude 4.5 or greater from the past week. The USGS weight
derives from a physical magnitude. It is not a measure of interest, importance,
severity, or public opinion. If those requests fail, a cached public snapshot
or clearly labeled synthetic fixture remains available. Article bodies and
private browsing/knowledge data do not feed the public field.

The v2 snapshot now records measurement kind, unit, source URL and window, and
keeps unlike source groups apart during aggregation. The renderer still blends
their GPU contributions into one appearance. Before the source-driven field
gate, `SIGNAL_PRESENTATION` must give these categories separate filtering and
explanations, including coverage and uncertainty. A public activity claim
cannot be inferred from earthquake magnitude.

## Required news and social coverage

News and public social RSS/Atom feeds are a core input, not a later optional
expansion. The Wikipedia/USGS spike proves plumbing only. PRD FRQ-001–008 and
§9 require a changing, attributable field built from independent eligible
signals. We are building an expanding public-source index, not attempting to
crawl the entire Internet. Coverage will remain visible and incomplete.

The delivery path is:

1. Register official news and public-social feeds across regions, languages and
   topics. Record availability, use terms, attribution, ownership, cadence and
   coverage gaps per source. Platforms without usable public feeds need a
   separately reviewed public API adapter; RSS availability is not assumed.
2. Fetch continuously with conditional requests, rate limits, backoff and
   persistent cursors. Normalize item identity, original URL, publisher tags,
   publication/update/first-seen timestamps and source provenance. Feed content
   is untrusted data. Link to originals; retain only permitted metadata.
3. Deduplicate syndicated stories and repeated posts, retain revisions and
   bounded time windows, and distinguish independent source activity from
   duplicate distribution. Posting volume is an observed activity measure,
   not a count of people, consensus, truth or the whole Internet's attention.
4. Compute reproducible activity, change and decay between comparable windows.
   A new independent report can raise amplitude; copying it must not multiply
   independent activity. Older activity decays. A failed feed shows lost
   coverage/staleness rather than a false decline in interest.
5. Associate geography using explicit source evidence and transparent rules.
   Publisher headquarters, audience location and the location discussed are
   distinct. Unknown or global stories remain accessible without fabricated
   map coordinates. Documented geographic breadth can widen corridors;
   documented relationships can connect them.
6. Drive the membrane from those temporal measurements. Amplitude represents
   qualified activity and width represents supported breadth. Momentum is
   measured from observation windows; slow material oscillation is decorative
   and cannot relocate activity or erase its baseline. Snapshot interpolation
   over roughly 10–30 seconds smooths data updates; historical time is an
   explicit separate control. Idle shader motion alone does not prove changing
   Internet activity. Reduced
   motion preserves the same information in static form and a list view.

The DAG gives this path separate registry, adapter, fetch, history, dynamics
and replay-verification nodes. Fixture-based ingestion work proceeds alongside
Earth/browser work; live sources are admitted individually. Registry review and bounded adapter fixtures can proceed alongside visual
work. Per spec §§12/20, a large ingestion backend waits for proof of synthetic
data-reactive geometry and multiscale tiles. The first live RSS slice then
proves source-to-shader causality before global expansion. The final G2
experience requires the browser, live field and worldwide addressability.

The acceptance demonstration is a replay followed by an admitted live-feed
run: new story → independent corroboration → syndicated copies → update →
age/decay → feed outage. Each visible change must be explainable from original
records and coverage. Private browsing and Laya never enter this pipeline.

On-device Absorb/Laya, sourced historical links and opt-in Beacons retain their
later gates. Ordinary Chromium browsing and direct search work independently
of field coverage. See the [living topography spec](<INTOPONET_LIVING_FREQUENCY_TOPOGRAPHY_SPEC (1).md>)
and [execution DAG](EXECUTION_DAG.json) for contracts and acceptance checks.
Every country and city must be addressable through a documented place hierarchy;
missing evidence is insufficient coverage, never zero interest. Local signals
remain recoverable on zoom through cohort-aware normalization. Planet-to-city
LOD preserves identity and reveals only geographically supported detail.

### Visual direction clarified — 2026-10-24 (superseded implementation below)

The user selected **large smooth swells with smaller electric ripples flowing
over them**. The earlier glowing strokes on a nearly spherical shell do not
satisfy the design. Macro displacement must visibly change the membrane's outer
silhouette at whole-Earth scale; closely spaced smaller ridges must also be
physical displacement. Dynamic normals, reflected diffuse/specular light,
translucency and camera parallax must reveal one connected surface with Earth
recognizable beneath it. Large swells move slowly and smaller ripples travel
faster, without relocating measured activity or inventing geographic support.

The decisive visual test is **all glow, bloom and emission disabled**: the
frequency topography must remain evident through surface shading and silhouette.
The spec's original displacement height is an art-direction starting point, not
a constraint that excuses an unreadable surface. Synthetic controls remain
explicitly identified as synthetic; visual QA does not establish live-data
coverage or complete the source-to-geometry acceptance gate.

### Organic membrane overhaul — latest user directive

The subsequent review explicitly rejected the thick ribbons, regular scallops,
and dotted highlights. Increasing the corridor displacement did not fix its
underlying morphology. The old path uses `FrequencyBand.centerline`, a Gaussian
of distance to that line, and a periodic cosine of distance along it. This
constructs a tube-shaped envelope with repeating crests by definition. The
legacy snapshot adapter also expands single points into short lines and joins
separated points. Circular averaging of carrier phases suppresses fine relief
at some intersections. These operations must not define the new membrane.

Retain Three.js 0.172 and React Three Fiber 9 already installed; do not add a
second renderer. Introduce a separate radial interest-field adapter accepting
explicit center, influence radius, intensity, momentum, confidence, timestamp,
topic and source type. Aggregate bounded geographic envelopes into float data
textures when data changes. Unknown geography stays unmapped. No synthetic
radius or connecting corridor is inferred for public records.

The replacement has three independent geometric scales: data-defined macro
swells; bounded, domain-warped meso undulations within their support; and much
smaller aperiodic micro structures. Procedural detail modulates supported relief
only; it never creates the macro activity field. Seamless 3D sphere coordinates
avoid longitude seams. Stable phase and smooth snapshot interpolation separate
material motion from observed change. Smooth camera-distance exaggeration
changes the visual mapping, not observations. Mesh and pixel quality adapt to
performance, with no per-frame CPU mesh rebuild.

Use `MeshPhysicalMaterial` extended through `onBeforeCompile` for displacement
and reconstructed normals. This retains the installed engine's lighting, Fresnel
reflection and roughness. A standalone `ShaderMaterial` offers control but
required reimplementing those features in the failed prototype. The selected
material uses `transmission: 0` and restrained alpha compositing with opacity in
the 0.35–0.55 range. Do not add a separate refraction pass. This avoids the
unreliable alpha/transmission interaction observed in review while preserving
the Earth beneath the membrane. [Three.js material hooks](https://threejs.org/docs/pages/Material.html)
and [physical material reference](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
support the base material choice.

[Custom Shader Material](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial)
was evaluated: its position and normal hooks can extend the same physical
material. For this bounded set of hooks, direct integration avoids an additional
dependency while keeping the standard material pipeline. Reconsider CSM if
shader customizations expand substantially.

[pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) supports bloom
and SSAO and combines compatible effects efficiently, but neither fixes missing
geometry. Do not add it to the initial geometry/material experiments. Bloom and
emission remain absent, and the debug material is fully opaque.

Technique references: [Ashima simplex noise](https://github.com/ashima/webgl-noise)
provides MIT-licensed, textureless GLSL noise; preserve source attribution and
license when vendoring it. [The Book of Shaders](https://thebookofshaders.com/13/)
describes limited-octave fBm and domain warping. Limit octaves to avoid terrain-like
roughness. [Bridson et al.](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf)
derive divergence-free curl flow; a full curl-flow solver is not required for
this bounded material, and ordinary domain advection must not be described as
a fluid simulation. Numerical normals must use the same displacement function
as geometry. [R3F performance guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
informs adaptive resolution and resource reuse.

Required validation order: A opaque neutral geometry; B opaque animated geometry;
C side-by-side physical material comparison; D Earth integration; E changing one
synthetic signal's intensity and radius without moving unrelated support; F
continuous Earth/region/city navigation. Preserve existing browser controls.
Deliver planetary/regional captures, an actual-motion recording, independent
macro/meso/micro controls, repeatable synthetic reset, and measured frame/GPU
timing (explicitly report unavailable timer-query support). Target 60 FPS; report
measured limitations instead of claiming the target from mesh complexity alone.

Current render evidence and limitations are recorded in
[`organic-verification.json`](../experiments/field-visual-qa/artifacts/organic-verification.json).

### Renderer validation status — 2026-10-25

Workspace validation passed: `npm test` completed with 194 tests across six
workspaces, and `npm run typecheck` passed in all seven workspaces. The desktop
production build also passed with `npm run build` (Electron main, preload, and
renderer bundles). These checks establish software integration only. Native
visual acceptance, continuous navigation review, and measured frame/GPU
performance remain pending; no 60 FPS result is claimed.

### Spatial and frame-rate limits — 2026-10-25

The live renderer currently samples one global 512 × 256 planetary field at all
camera scales. The Field Lab's nearest camera preset is labeled **Close view**:
it is a camera zoom over the planetary raster, not city-resolved geometry. At
that raster size each equirectangular cell is 0.703° in both axes; near
Halifax this is about 56 km east-west by 78 km north-south. The current 10 km
Wikipedia and 50 km USGS source radii are below this sampling and cannot support
city-scale relief. City-resolved output remains open work requiring a
geographically supported local high-resolution patch/projection and suitable
place anchors; changing camera distance alone is insufficient.

Native observation measured 30 FPS while the GPU timer reported about 7 ms.
No app-level 30 FPS cap was found; the on-screen Canvas uses continuous
rendering, and Electron's `webContents.setFrameRate()` is limited to offscreen
rendering ([Electron WebContents API](https://www.electronjs.org/docs/latest/api/web-contents)).
The GPU query covers GPU work rather than the complete CPU/compositor/vsync
frame, so it does not establish a 60 FPS result. Diagnose the OS/compositor and
full frame interval before changing this target; the observed 30 FPS remains
the honest reported performance for this capture.

### Native evidence checkpoint

Final planetary/regional PNGs, three-material comparison, opaque check, and a 7.97-second actual-canvas MP4 are in `experiments/field-visual-qa/artifacts/`; see `organic-verification.json`. The final micro term uses two differently oriented domain-warped phases, not a regular latitude carrier. Browser tab opening and return-to-field were verified. The main app also showed 19 FPS / 35.6 ms GPU samples, so the 30 FPS lab observation is not a stable application-wide guarantee. Full aesthetic acceptance, city-resolved data/geometry, and 60 FPS remain open.
