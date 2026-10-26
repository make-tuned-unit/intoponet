# Frequency design review

Status: requirements review only. This document records the current user direction and open acceptance; it does not claim that the renderer passes visual review.

## Authority and supersession

The latest continuous-membrane brief and user-provided image reference are authoritative for the frequency renderer. They supersede the earlier corridor construction and its visual assumptions. Earlier documents remain useful for product meaning, privacy, geography, provenance, accessibility and navigation constraints, but old corridor-shader descriptions are historical implementation records. Do not use them as the target geometry or proof of acceptance.

The product requirements remain in force where compatible: fluid, morphing activity; progressive geographic exploration; source coverage and uncertainty; distinct measurement meaning; preserved camera/filter/time context; and an accessible non-spatial alternative.

## Failure analysis

The retired field path measured Gaussian distance to a `FrequencyBand` centerline and modulated it with a periodic cosine along the line. That construction inherently produces tubes and repeating scallops. The legacy snapshot adapter could expand single points into short segments and join separated points. Averaging carrier phases could also cancel fine relief near intersections. Raising displacement or changing glow does not correct those shape causes.

The new field must keep geographic observations separate from surface presentation. A supported radial field determines where the data-driven macro displacement may exist. Meso domain warping and micro wave interference may shape supported relief, but must not widen support, join unrelated anchors, or manufacture global activity. Presentation motion must not be described as observed temporal change.

## User image reference

The reference shows dense, thin topographic contour lines following a
physically displaced, continuous dark surface that surrounds the Earth. Its
color language is cyan/teal/violet. This linework is the primary visual
language; a broad glassy or pearlescent body is not. Keep the underlying
silhouette and fine relief as actual geometry, with contour strokes describing
its form. The reference informs contour density and organic shape only: do not
import its dotted nodes or angular circuit traces. This direction does not
replace the opaque, directionally lit neutral-geometry check.

## Required acceptance

- **Neutral geometry first:** inspect an opaque neutral geometry view under directional light before Earth/material integration. Macro swells must visibly alter the silhouette; finer meso and micro relief must be real displacement, not brightness, ribbons, dots or a glow effect.
- **No-glow proof:** with emission, bloom and glow disabled, show the connected surface through geometry, normals and lighting. The current material direction is a thin alpha `MeshPhysicalMaterial` extension; retaining the standard material preserves its PBR specular response while custom displacement and normals define the membrane. It uses no emission. Opacity can respond to local support and slope; opacity and refraction settings are implementation choices, not design acceptance requirements. Material sheen must stay subordinate to the reference's contour-line language.
- **Bounded geography:** radial center, source radius, intensity, confidence, momentum, time, topic and source type remain explicit. Public source radius and anchor are preserved; unknown geography stays unmapped. Synthetic radius controls are clearly labeled and affect only their selected synthetic input.
- **Field invariants:** intensity changes remain within support and monotonic with input intensity; unrelated pixels/anchors do not change. Antimeridian, pole and sphere seam behavior is continuous. Sub-texel support is not silently broadened.
- **Independent scales and clocks:** macro data geometry, bounded meso structure, micro interference and material phase can be inspected separately. Motion does not relocate support or imply new observations; meaningful source updates remain distinct from decorative phase.
- **Earth and navigation:** integrate only after neutral geometry review. Keep Earth recognizable beneath the membrane, preserve geographic identity across Earth/region/city LOD, restore the exact prior viewpoint on return, and retain keyboard, reduced-motion and non-spatial access.
- **Performance and disclosure:** report measured frame and GPU time on named hardware, including lower-LOD behavior. 60 FPS remains a target, not an accepted result. Keep source provenance, measurement scope, confidence and synthetic labels visible. A passing build or unit suite is not visual acceptance.

## Content eligibility boundary

Frequency-map eligibility is separate from browser navigation and page
blocking. The renderer checks only supplied URL, title, topic and optional
source rating metadata; it does not fetch user URLs or inspect arbitrary page
content. Explicit adult domains/path/title/topic markers and R, NC-17, TV-MA or
18+ rating markers are excluded. An exact entertainment category without a
recognized nonrestricted rating is excluded until supported rating metadata is
available. Current accepted nonrestricted labels are G, PG, PG-13, TV-G, TV-PG,
TV-14, TV-Y, TV-Y7, TV-Y7-FV, U, 12 and 12A; restricted markers take
precedence when rating strings combine values. Ordinary research topics are not
blanket-blocked. An eligible result means only that no known marker was found,
not that content is certified safe.
Whether to exclude broader mature material beyond pornography and explicit
rating markers remains a product decision.

For completed browser visits, the host now reads only bounded local rating
hints from `meta[name=rating]`, `contentRating` itemprops/JSON-LD and
`og:restrictions:age`, then passes the optional string to the renderer. These
page-authored values are untrusted hints, not a verified rating; no request is
made to the URL. The public snapshot schema still has no rating field, so an
unmarked R-rated public item outside an exact entertainment category can still
evade this screen. The renderer adapter removes known-ineligible snapshot
sources before producing map signals and drops a whole aggregate band when any
source is excluded or missing, since legacy band amplitude cannot be safely
recomputed. A source-specific, provenance-bearing rating field is needed before
claiming complete rating exclusion.

Open acceptance remains: native final-beauty review, city-resolution behavior, repeatable macro/meso/micro controls and captures, and measured performance at the target refresh rate. Existing compositor evidence is limited to roughly 30 FPS on a 30 Hz display and does not establish 60 FPS.

The 14-anchor synthetic stress fixture rasterized at 512×256 supports 67.76% of
globe area; intensity exceeds 0.10 over 56.73%. The four-anchor
world-knowledge subset supports 27.25% of globe area, with intensity over 0.10
on 20.62%. This broad stress fixture helps expose overlap and support
interactions; it is not evidence that a dense, globe-wide relief is visually
beautiful or appropriate for public data.

## Current renderer checkpoint

The current shader uses two broad, domain-warped meso phase fields at spatial
frequencies 17 and 23, plus finer interference fields at 32 and 43 with a
0.006 relief amplitude. Signed momentum adds a bounded phase offset; it does
not multiply the clock or increase spatial frequency over long runs. Procedural
HDR environment reflections and directional lights feed the `MeshPhysicalMaterial`
path, preserving the standard PBR specular response without emission. Physical
surface alpha follows support, relief slope and Fresnel contribution so flatter
areas remain more transparent. These are implementation details, not design
thresholds.

Verification checkpoint: workspace tests pass at **194 tests across 6
workspaces**, typecheck passes in all **7 workspaces**, and the production build
passes. Native measurements are about **30 FPS**, with GPU samples around **7–11
ms** for Earth integration and **5–8 ms** for neutral geometry. These samples
do not establish 60 FPS. The opaque geometry capture demonstrates displacement;
material visual acceptance remains pending. City resolution and the 60 FPS
target remain unresolved, and final aesthetic review is not claimed.

Revision-two progress evidence:

- [Planetary capture](../experiments/field-visual-qa/artifacts/intoponet-revision2-planetary.png)
- [Regional capture](../experiments/field-visual-qa/artifacts/intoponet-revision2-regional.png)
- [Opaque geometry capture](../experiments/field-visual-qa/artifacts/intoponet-revision2-opaque.png)
- [Motion video (H.264, 1440×940)](../experiments/field-visual-qa/artifacts/intoponet-revision2-motion.mp4)
- [Original VP9/alpha motion source](../experiments/field-visual-qa/artifacts/intoponet-revision2-motion.webm)
- [Three-frame motion contact sheet](../experiments/field-visual-qa/artifacts/intoponet-revision2-motion-contact-sheet.png)

These captures document progress only. They do not complete material beauty
review, city-resolution acceptance, or the 60 FPS target.

### Contour revision checkpoint — 2026-10-25

The new shader draws **44 topographic contour levels** from the actual
displaced relief and anti-aliases line coverage using screen-space derivatives.
The membrane remains on the physical/PBR material path with no emission. These
captures are progress evidence, not material or final-beauty acceptance:

- [Contour planetary capture](../experiments/field-visual-qa/artifacts/intoponet-contours-planetary.png)
- [Contour motion MP4 (1440×940, 238 frames, 7.93 s)](../experiments/field-visual-qa/artifacts/intoponet-contours-motion.mp4)
- [Contour motion VP9/alpha source](../experiments/field-visual-qa/artifacts/intoponet-contours-motion.webm)
- [Contour motion contact sheet](../experiments/field-visual-qa/artifacts/intoponet-contours-motion-contact-sheet.png)

Desktop tests pass **63/63**. Current native performance is about **30 FPS**
with roughly **8–10 ms GPU time**; the 60 FPS target and material visual review
remain unresolved.

### Living-contour revision checkpoint — 2026-10-26

An audit of the 2026-10-25 contour build found four shape causes behind its
"lumpy" read. They were causes in the construction, not material tuning:

1. **Macro relief was `0.16 × intensity`.** That is about 3.5× the spec's
   Dmax ≈ 0.045R, so swells produced a potato silhouette.
2. **Contours were faceted.** They came from a per-vertex interpolated
   relief varying, so isolines were piecewise-linear per triangle. Bilinear
   texture filtering added kinks on a texel grid.
3. **Lines had no hierarchy.** Every level had equal weight, with no
   pixel-density LOD, so the lines read as noise rather than terrain.
4. **The reference contour phase was added to the contour coordinate.** The
   strokes therefore did not fully describe the displaced form.

The revised `earth/organicShader.ts` addresses each cause:

- **Bounded, monotonic relief.** `Dmax(1 − e^{−kS}) / (1 − e^{−k})` with
  Dmax = 0.045R and k = 1.6. Meso/micro amplitudes stay below the minimum
  macro slope, so total relief is monotonic in intensity; a unit test pins
  this bound. Meso relief uses domain-warped islands and is scaled by
  observed intensity, so it cannot exist outside support.
- **Per-pixel contours from the same relief function as the displacement.**
  The fragment shader evaluates the identical `organicRelief` on a cubic
  B-spline (C2) sample of the interest texture. Micro ripples are excluded
  from the contour height: they shade the surface through normals but would
  otherwise trace hundreds of tiny loops.
- **Cartographic linework.**
  - Constant-pixel-width anti-aliased isolines with a power-of-two interval
    LOD crossfade.
  - The LOD subdivides one step when zoomed in. This is the same relief with
    a finer interval, not finer data.
  - Index contours every fifth interval, with a soft luminous halo.
  - The level derivative is passed analytically, so interval changes do not
    stipple.
  - Strokes fade at grazing angles and skip the near-flat zero skirt.
- **Static geographic meander.** A geographic warp of at most about 140 km
  at planet scale, reduced at city scale, applies to intensity only. It is
  time-invariant, so it never relocates an event, and it is blended back to
  the unwarped value at the support edge, so relief cannot leave measured
  support. Without it, very broad synthetic swells gave evenly spaced
  parallel rings.
- **Colour.** Teal low ground, cyan swells and a pale crest on index lines.
  Violet appears at the limb, in slow geographic hue passages, and where
  observed momentum is falling. Strokes are lit by the key light, with an
  optional self-luminance (`lineGlow`). `lineGlow = 0` is the no-glow proof,
  which is now a Field Lab toggle.
- **Atmosphere.** `earth/Atmosphere.tsx` adds a world-space Fresnel limb, so
  it does not fade with zoom. The Earth fades up when its texture is ready.

Motion layers are kept semantically separate:

| Layer | Clock | Meaning |
|---|---|---|
| Meso breathing | Material phase, ≈20–40 s periods | Decorative. Frozen with reduced motion. Cannot move support. |
| Level pulses | Material phase, 9 s | Brighten existing strokes only. Travel outward where observed momentum rises and inward where it falls. Frozen with reduced motion. |
| Snapshot flare | Snapshot transition (12.5 s) | Strokes flare only where `|to − from|` intensity changed, peaking mid-transition. Distinct from decorative phase. |
| Entrance | First rendered frame, 5.5 s ease-out cubic, no overshoot | Relief grows from the flat sphere, so rings spawn at data peaks and propagate outward. Skipped under reduced motion and fixed-clock captures. |

Verification:

- Workspace tests pass at **222**. Desktop tests went from 89 to 97: the
  string-pinning shader test was replaced by invariant tests.
- Typecheck passes in all workspaces, and the production build passes.
- Studio GPU samples on the development Mac (Chromium, `EXT_disjoint_timer_query`):
  - Planet: about 6.4 ms.
  - Region: about 8.5 ms.
  - City: about 8.1 ms.
  - Quiet baseline: about 3.5 ms.
- These samples come from a 30 Hz headless capture and **do not establish
  60 FPS**.

These captures are progress evidence only. Material/final-beauty review,
city-resolution acceptance and the 60 FPS target remain open.

- [Before (2026-10-25 build, same camera)](../experiments/field-visual-qa/artifacts/intoponet-living-contours-baseline-before.png)
- [Planetary](../experiments/field-visual-qa/artifacts/intoponet-living-contours-planetary.png) · [Pacific/Australia](../experiments/field-visual-qa/artifacts/intoponet-living-contours-planetary-pacific.png) · [Regional](../experiments/field-visual-qa/artifacts/intoponet-living-contours-regional.png) · [City](../experiments/field-visual-qa/artifacts/intoponet-living-contours-city.png)
- [Opaque clay geometry](../experiments/field-visual-qa/artifacts/intoponet-living-contours-opaque-geometry.png) · [No-glow proof](../experiments/field-visual-qa/artifacts/intoponet-living-contours-no-glow.png)
- [Phase motion, 10 s real time (MP4)](../experiments/field-visual-qa/artifacts/intoponet-living-contours-phase-motion.mp4) · [contact sheet](../experiments/field-visual-qa/artifacts/intoponet-living-contours-phase-contact-sheet.png)
- [Entrance reveal + synthetic snapshot update (MP4)](../experiments/field-visual-qa/artifacts/intoponet-living-contours-reveal-and-update.mp4) · [contact sheet](../experiments/field-visual-qa/artifacts/intoponet-living-contours-reveal-and-update-sheet.png)

The captures come from `experiments/membrane-studio`. It is a Vite page that
renders the production `EarthScene` with URL-controlled camera, phase clock
and synthetic fixture. Use it for repeatable visual review.

### Native personal-field QA checkpoint — 2026-10-25

In the Electron app, a successful Wikipedia Solar System visit changed the
session count from 0 to 1; a Wikipedia Moon visit changed it from 1 to 2; and
reopening/reloading Moon left it at 2. A failed `example.org` load left the
count at 0. The inspected frame showed quiet whole-globe contours and a
localized swell at the explicitly selected Brooklyn context (intensity 2); the
full-width place picker layout was fixed. QA-session visits were cleared, the
three agent-created tabs were closed, and the original Wikipedia tab was kept.
This is a local demonstration only: it does not imply a global visitor backend
or comprehensive content classification. Visual/material acceptance remains
open.

The native synthetic Colosseum preview displayed a compact origin table with
Bolivia at 50% (3 visits, 3× its previous-window rate), Italy at 33% (2 visits,
2×), and unknown at 17% (1 visit). Teal/violet contours remained visible with
glow disabled; the synthetic preview was labeled. This validates the local
example presentation only. Real visits have unknown origin, so the actual
personal field does not claim country shares or origin spikes.

### Topic destination traffic and origin reporting

The map destination represents the selected topic place; origin country is a
separate visitor attribute. The local `topicTraffic.ts` helper aggregates
completed visits for an exact destination/topic pair into a current window and
the immediately preceding baseline window. Origin shares use all current-window
visits as the denominator; visits without valid country codes remain visible in
an `Unknown` bucket. It computes both destination-wide and per-country hourly
rates against the same country’s preceding-window baseline. A zero country
baseline returns a null ratio and `no-baseline`, never infinity. Origin codes
must be in the ISO 3166-1 alpha-2 set; unrecognized or reserved values are
counted as unknown. The example “Bolivia to the Roman Colosseum” is explicitly
synthetic, with Bolivia at three times its baseline, and only suitable for the
Design preview.

Actual local visit data currently has no visitor-country origin, so the real
personal field must show totals without country percentages or origin spikes.
There is no global visitor backend or shared visitor-origin dataset. Any future
real aggregate requires an explicit privacy/product decision and a source with
documented coverage and provenance; this implementation keeps the visit
records in local memory and does not transmit them. Topic assignment is currently
an explicit user choice; automatic page-to-topic resolution is not implemented.
The selected map destination supplies geographic context but does not infer a
visitor's country of origin.

## Documents reviewed

- `README.md`
- `INTOPONET_PRD.md`
- `INTOPONET_EARTH_FREQUENCY_SPEC.md`
- `docs/INTOPONET_LIVING_FREQUENCY_TOPOGRAPHY_SPEC (1).md`
- `docs/FIELD_PLAN.md`
- `docs/architecture/ADR-001-browser-engine.md`
- `docs/architecture/ADR-005-public-source-governance.md`
- `docs/architecture/ADR-007-browser-policy.md`
- `docs/architecture/ADR-009-geography.md`
- `docs/architecture/NEWS_SOCIAL_FEEDS.md`
- `docs/architecture/threat-model.md`
- `docs/INTOPONET_NATIVE_AD_BLOCKING_SPEC.md`
- `docs/EXECUTION_RUNBOOK.md`
- `docs/DELIVERY_DAG.md`
- `experiments/cef-compositor/BASELINE.md`
- `experiments/cef-compositor/README.md`
- `experiments/electron-compositor/BASELINE.md`
- `experiments/electron-compositor/README.md`
- `experiments/field-visual-qa/README.md`
- `experiments/place-catalog/runtime-index.md`
- `experiments/public-feed-pilot/README.md`

## Document drift to resolve

`docs/DELIVERY_DAG.md` and `experiments/field-visual-qa/README.md` contain legacy corridor-shader descriptions. `docs/architecture/ADR-009-geography.md` also has earlier no-import/no-runtime-index wording that conflicts with its later planner evidence and the runtime-index report. The runbook retains the earlier 186-test checkpoint as historical; this review records the current 194-test workspace result. These documentation annotations do not promote any open visual, coverage, navigation or performance gate.
