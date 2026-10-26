# Earth membrane visual QA

> **Legacy corridor-shader QA:** the probes and descriptions below cover the
> retired band/corridor renderer, not the continuous-membrane acceptance target.
> See [Frequency design review](../../docs/FREQUENCY_DESIGN_REVIEW.md). Do not
> treat these captures or probes as a visual pass for the current membrane.

Run `npm run build`, then `experiments/field-visual-qa/run-captures.sh` to capture isolated Electron renders at fixed Earth and city scales, aimed at New York. Each capture uses a temporary Electron profile and removes it afterward. The fixtures are deterministic and do not read or write the user's profile. `public-snapshot-fixture.ts` creates a public-record-shaped fixture from fixed Wikimedia and USGS examples; its label explicitly says it is not live public activity.

`probe-bands.ts` bundles with esbuild and writes `artifacts/band-probe.json`. It asserts the deterministic t=0 phase trough has field values below 0.01 while phase-independent envelope coverage remains above 0.25 for both fixtures. Before the shader fix, that trough also drove fragment visibility, so reduced motion froze the corridor at very low visibility. The capture probe also exposed a separate GPU-uniform bug: band vectors had data but active `uCount` stayed at zero until it was synchronized directly through the material uniform object.

The legacy Earth and city screenshots capture the retained corridor bug fixes with the original width and opacity settings. The old shader derives corridor color/visibility from the unmodulated band envelope (`amplitude * envelope`) while retaining the wave-modulated value for displacement and filament animation. The capture script emulates reduced motion and records live WebGL uniforms, including `uCount`. Earlier `blob-diagnostic-*` screenshots preserve the brighter intermediate result; the solid teal patch fails the Earth spec because it reads as a heatmap blob. Shape acceptance remains open pending visual-direction review.

The fixture covers a compact set of points around New York and exercises the same rendering path as parsed public records. It does not fetch network data or filter lists.
