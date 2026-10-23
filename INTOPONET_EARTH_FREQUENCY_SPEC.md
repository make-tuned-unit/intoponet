# Intoponet — Earth and Frequency Field

**Engineering specification v0.1 · For Cursor**  
**Scope:** The first production-quality planet-to-topic visual experience, including real website panels.  
**Status:** Proposed implementation details; validate rendering and performance experimentally.

## 1. Visual north star

The initial screen shows **a recognizable Earth wrapped by an independent, translucent, luminous frequency membrane**. The Earth anchors geography; the membrane is the primary visual subject. The membrane deforms into fluid, continuous topography as aggregate human-interest signals change. No literal mountains, terrain extrusion, heatmap blobs, or chart overlays.

- Deep near-black space, generous negative space, subtle atmosphere.
- Earth occupies approximately 60–75% of viewport height at desktop launch.
- Subdued land and ocean textures, recognizable coastlines, realistic curvature, no labels/borders/grids by default.
- Semi-transparent cyan/teal frequency bands with restrained violet accents, suspended just above Earth's surface.
- Calm, sophisticated, alive. Not a science-fiction HUD or an audio visualizer.
- A tiny, unobtrusive bottom launcher; real webpages open in animated liquid-glass side panels or bottom sheets.

## 2. Scene layers

1. **Earth sphere:** Radius `R = 1` in render-space. Use appropriately licensed equirectangular or tiled imagery, physically plausible lighting and subtle atmosphere. Do not use terrain elevation to encode interest.
2. **Frequency membrane:** Separate spherical shell at radius `R + h0`, displaced outward along surface normals by `D(lat, lon, time, zoom)`. `D >= 0`, smooth and bounded.
3. **Frequency filament shading:** Fine luminous lines and subtle specular highlights following the displaced membrane. Colour is secondary; geometry carries intensity.
4. **Native browser surfaces:** Chromium-rendered pages composited over the 3D scene within glass-framed windows. Never replace actual webpages with screenshots or iframes as the primary browser implementation.

## 3. Frequency band definition

A band is a **geographically anchored, finite-width wave corridor following the sphere**. Its geometry is not a mountain ridge: it is a continuous field of waves that can overlap and interfere with other bands.

```ts
type FrequencyBand = {
  id: string;
  centerline: { lat: number; lon: number }[]; // WGS84 degrees
  widthKm: number;
  wavelengthKm: number;
  amplitude: number; // normalized 0..1
  phase: number; // radians
  phaseVelocity: number; // radians per second, visual animation
  confidence: number; // 0..1; separate from interest
  topicIds: string[];
  category?: string;
  updatedAt: string; // ISO-8601
  sourceType: 'synthetic' | 'public-aggregate';
};
```

### Meaning

| Appearance | Meaning |
|---|---|
| Broad high-amplitude swell | Concentrated, independently expressed human interest |
| Wider, gently elevated field | Broad participation or overlapping related activity |
| Emerging fine ripple | Local or newly developing interest |
| Crossing bands | Geographic or topical overlap |
| Receding oscillation | Declining observed activity |
| Quiet/flat field | Low *observed* activity **or insufficient coverage** |

Amplitude does **not** mean truth, public importance, or unanimous opinion. Real signals require a separate privacy-preserving, manipulation-resistant aggregation pipeline. The first prototype should label its fixtures as synthetic.

## 4. Geometry and shader mathematics

Use WGS84 lat/lon for geographic anchors and a consistent Y-up sphere convention. Example conversion:

```ts
function latLonToUnit(latDeg: number, lonDeg: number) {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  return {
    x: Math.cos(lat) * Math.cos(lon),
    y: Math.sin(lat),
    z: Math.cos(lat) * Math.sin(lon),
  };
}
```

For each unit sphere position `n`, find the nearest geodesic distance `d_i(n)` to band `i`'s centerline and approximate distance `s_i(n)` along that centerline. Handle antimeridian and polar paths explicitly before real global deployment.

Suggested initial field:

```text
E_i(n) = exp(-0.5 * (d_i(n) / sigma_i)^2) * endpointFade_i(n)
W_i(n,t) = 0.5 + 0.5*cos(2*pi*s_i(n)/lambda_i + phase_i + omega_i*t)
B_i(n,t) = amplitude_i * E_i(n) * smoothstep(0,1,W_i(n,t))
S(n,t) = sum_i B_i(n,t)
D(n,t,z) = Dmax(z) * (1 - exp(-k*S(n,t)))
P(n,t,z) = n * (R + h0 + D(n,t,z))
```

- `sigma_i` derives from physical band width; `lambda_i` from wavelength.
- `Dmax(z)` limits apparent height by zoom scale, avoiding absurd spikes at planet scale.
- Saturating combination prevents crossings from creating isolated towers.
- Smooth at multiple spatial scales; fine waves must be subordinate to the aggregate field.
- Calculate normals from displaced geometry or finite differences for convincing lighting.
- Prefer Three.js + React Three Fiber + custom GLSL shaders for the initial testbed; keep renderer abstractions independent of the browser host.
- Adaptive mesh patches or GPU refinement are needed for city/topic zoom. Avoid low-poly faceting and floating-point jitter; use camera-relative coordinates at deep zoom.

**This is an artistic information encoding, not an electromagnetic field simulation.**

## 5. Motion

- Slow, low-amplitude phase movement: organic, nearly meditative; no synchronized pulsing.
- Data updates: interpolate geometry and colour over roughly 1–3 seconds; no popping.
- Camera: eased, interruptible orbital-to-local movement, preserving orientation.
- Page open: dim field modestly and reduce motion without freezing it.
- Page close: restore prior field brightness, speed and exact camera focus.
- Reduced-motion preference: disable idle oscillation and use brief opacity transitions.
- Target 60 fps on defined baseline hardware; 120 fps where feasible. Profile GPU and battery cost.

## 6. Continuous zoom contract

### Earth → Region

The camera approaches the chosen geographic anchor along a curved path. Earth remains spherical. Global broad bands resolve into regional structures using continuous LOD blends; do not jump to a flat map.

### Region → City

Curvature becomes less prominent as the camera approaches the surface. Earth textures become a subdued reference layer; more fine-scale frequency structure emerges smoothly. Do not add Google Earth terrain, street-map clutter, or conventional map pins.

### City → Topic

A selected frequency expands into an immersive, navigable field. Geographic context recedes, but the field retains its origin. Related bands become visible by subject relationship. Use an explicit mapping from geographic coordinates to semantic/topic layout rather than pretending every idea has a natural Earth coordinate.

### Return and continuity

No hard cuts. Every transition can be interrupted and reversed. Maintain an explicit exploration state:

```ts
type ExplorationState = {
  scale: 'earth' | 'region' | 'city' | 'topic';
  geographicAnchor: { lat: number; lon: number } | null;
  selectedTopicId: string | null;
  camera: { position: [number,number,number]; target: [number,number,number]; fov: number };
  zoom: number;
  timeCursor: string;
  activeWebPanelIds: string[];
};
```

Browser back/forward should restore prior exploration states. Opening/closing a webpage must never reset the Earth camera.

## 7. Opening real webpages

On selecting a resource, animate a glass frame from its field position into a resizable right-side window (desktop) or bottom sheet (mobile later). Display the real Chromium webpage when its native surface is positioned and ready; avoid white flashes, input glitches, and z-order errors. Closing reverses the animation toward its source and returns focus to the same frequency.

**Browser host:** Run the same proof of concept with CEF and Electron `WebContentsView` before selecting one. Native web surfaces do not automatically participate in DOM/CSS transforms, so synchronize native bounds and glass-frame animation explicitly. Maintain a browser-engine adapter that is independent of the renderer.

Security: Chromium sandbox enabled; no Node/native APIs exposed to websites; restrictive IPC; permission prompts; isolated untrusted page processes; secure download handling; rapid Chromium security updates. Laya can index page content only after an explicit user action.

## 8. Suggested project modules

```text
apps/desktop/
  shell/                 # Chromium host, permissions, app lifecycle
  browser-surfaces/      # real webpages and compositor bridge
  ui/                    # glass panels, bottom launcher, controls
packages/
  earth-renderer/        # globe, atmosphere, camera
  frequency-field/       # band evaluation, shaders, LOD
  exploration/           # navigation state and transitions
  discovery-contracts/   # public signal schema and validation
  design-tokens/         # colour, glass, motion, typography
  test-fixtures/         # synthetic Earth/region/city datasets
```

Renderer modules must not import CEF/Electron. The host adapter owns webpage surfaces; the UI owns intended animation states.

## 9. Initial design tokens

| Token | Initial target |
|---|---|
| Background | `#07111B` |
| Earth shadow | `#102330` |
| Primary band | `#50D9C7` |
| Secondary band | `#A69BE8` |
| Text | `#E9F4F3` |
| Glass | translucent charcoal, thin highlight edges, restrained blur |
| Panel transition | spring motion, approximately 250–450 ms |
| Animation target | 60 fps baseline, 120 fps where supported |

Tune against actual screenshots and user testing; do not let decorative bloom obscure continents or band geometry.

## 10. Strict visual prohibitions

**Never show:**

1. A schoolroom globe: bright blue oceans, cartoon continents, political borders, thick coordinate grids, permanent labels.
2. Chrome-style/geological terrain: literal mountains, cliffs, valleys, contour maps, satellite terrain extrusion.
3. Conventional data visualization: heatmap blobs, choropleths, charts, numerical labels, dashboard legends, dense map pins.
4. Audio equalizer bars, rhythmic beat pulses, uniform waveform strips.
5. Neon highways, orbiting HUD rings, excessive particles, lens-flare overload, generic sci-fi clutter.
6. Hard scene cuts, snapping to a flat map, losing camera position after reading a page.
7. Synthetic activity presented as real human interest.

## 11. Reference image description

> Cinematic, ultra-premium oblique orbital view of a recognizable dark Earth suspended in deep black space. Continental silhouettes and oceans are subtly discernible beneath a distinct translucent frequency membrane wrapping the planet. Smooth cyan, teal, and restrained violet wave bands flow across the sphere, overlapping and interfering to create continuous organic three-dimensional displacement. Concentrated regions rise as broad fluid swells while quieter regions settle nearly flush with the globe. The displaced field remains visibly separate from Earth's geography. Delicate atmospheric scattering, refined refractive highlights, exceptional depth and restraint. No mountains, map pins, labels, borders, grids, heatmaps, dashboards, or sci-fi ornamentation. Living, scientific, calm, exploratory, exceptionally beautiful.

This is an **art-direction reference**, not an image texture to paste over Earth.

## 12. Build phases and acceptance criteria

### Phase A — Planet shell

Implement Earth sphere, subtle atmosphere, orbital controls, independent constant-height membrane, and screenshot fixtures.

**Pass:** Recognizable Earth; membrane visibly separate; no classroom-globe aesthetic.

### Phase B — Dynamic bands

Implement validated synthetic `FrequencyBand` fixtures, smooth geodesic band envelopes, bounded interference, GPU displacement and normal shading.

**Pass:** Bands cross without spikes; geometry is smooth and wave-like; changing amplitude smoothly changes relief; no heatmap-like colour blobs.

### Phase C — Geographic zoom

Implement Earth → region → city LOD, camera anchoring, continuity and interruption handling.

**Pass:** No camera jump, obvious geometry popping, visible seams, or loss of geographic orientation.

### Phase D — Topic transition

Implement a reversible topic-scale semantic field using a test topic graph; preserve geographic anchor.

**Pass:** User can enter and exit a topic and return to precisely the same region and viewpoint.

### Phase E — Real browser panel

Prototype CEF and Electron with identical glass-frame opening/closing animations and live interactive webpage surfaces.

**Pass:** Real website loads, scrolls, plays media where supported, receives focus, resizes, closes, and restores the prior exploration state without white flashes or z-order glitches.

### Phase F — Quality and security

Profile baseline hardware, test reduced motion, keyboard access, untrusted site isolation, crashes, device loss, and synthetic-data disclosure.

**Pass:** Stable frame time, graceful low-power mode, no privileged page bridge, clear indication of simulated data.

## 13. Engineering test matrix

- **Geometry:** Latitude/longitude conversion; band width and amplitude clamping; continuity across 180° longitude; polar handling; bounded displacement; normal stability.
- **Rendering:** Transparency/depth ordering; atmosphere; silhouette integrity; LOD seams; antialiasing; no shader flicker.
- **Interaction:** Orbit, zoom, interruption, reverse, return-to-anchor, back/forward, mouse and trackpad.
- **Browser:** Webview z-order, keyboard focus, scrolling, resizing, multiple panels, crashes, navigation, permissions, downloads.
- **Performance:** FPS and 95th-percentile frame time at Earth/region/city/topic; memory and battery; low-end fallback.
- **Privacy:** Synthetic/public data only in the collective field; no access to local history, bookmarks, Laya embeddings or personal knowledge graph without explicit user action.
- **Accessibility:** Reduced motion, keyboard controls, screen-reader equivalents for topic selection, adequate contrast, non-colour encoding.

## 14. Cursor implementation instruction

Start with **Phase A and Phase B only**. Do not invent a news feed, topic-ranking backend, personal-data telemetry, or production Beacon system. Use synthetic fixture data with visible demo labeling. Implement the Earth and independent displaced membrane as reusable modules, add screenshot and geometry tests, then report measured performance and any technical blockers before moving to camera transitions or browser panels.

**Definition of done for first real visual version:** A premium, recognizable Earth with independently animated, geographically anchored, translucent wave bands whose intersections produce smooth, bounded, fluid topography; a working orbit/zoom camera; a clear distinction between synthetic and real data; and none of the forbidden visual motifs.
