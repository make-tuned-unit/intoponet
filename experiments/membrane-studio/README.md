# Membrane Studio

This is a visual-review harness for the frequency membrane. It renders the
production `EarthScene` and `OrganicMembrane`, not a copy, and controls the
camera, phase clock and fixture from the URL, so captures are repeatable. It
uses synthetic fixtures only.

```sh
node_modules/.bin/vite --config experiments/membrane-studio/vite.config.ts
# → http://localhost:5199/
```

## URL parameters

| Param | Meaning |
|---|---|
| `theta`, `phi`, `radius` | Orbit pose. The default radius 4.35 matches the app's Earth scale. |
| `t` | Fixed phase seconds, for deterministic stills. Omit it for the live clock and the entrance reveal. |
| `fixture` | `preview` (default), `lab`, `single` (with `intensity` and `radiusKm`), or `quiet`. |
| `material` | `glass` (contours), `clay` (opaque geometry check), or `silk`. |
| `glow` | Contour self-luminance, 0–1.5. `glow=0` is the no-glow proof. |
| `macro`, `meso`, `micro` | Relief scale controls, 0–2. |
| `quality` | `high` (default), `auto`, or `low`. |
| `reduce=1` | Reduced motion: phase frozen and no reveal. |
| `hud=0` | Hide the frame and GPU readout. |

The page exposes these capture hooks:

- `window.__setT(seconds)`: step the phase clock.
- `window.__setSignals(signals)`: swap the snapshot, which triggers the
  12.5 s transition and the change flare.
- `window.__fixtures`: the built-in synthetic fixtures.

## Capturing

Run `shoot.js`, `frames.js` and `story.js` through the Playwright MCP
`browser_run_code` tool by passing the file name. They wait for the live HUD
before capturing.

The MCP screenshot tool can return stale WebGL frames, so these scripts call
`page.screenshot` directly. Output goes to `captures/`, which is git-ignored.
Encode the output with ffmpeg, for example
`ffmpeg -framerate 30 -i captures/frames/%04d.png -pix_fmt yuv420p motion.mp4`.
