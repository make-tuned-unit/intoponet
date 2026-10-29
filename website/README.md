# Website direction preview

Live placeholder: https://intoponet-preview.vercel.app

Static HTML/CSS/JavaScript with actual prototype screenshots and a dependency-free WebGL globe. Vercel project `intoponet-preview` uses `website` as its repository root. No build step or runtime dependencies. For local preview, serve this directory with any static server.

The macOS DMG is intentionally unavailable. When the browser is release-ready, replace the availability message with the signed/notarized installer link and publish version, system requirements and verification information. Do not substitute an unsigned development build.

The `.openai/hosting.json` file records an earlier reserved Sites project; this placeholder is deployed on Vercel, not Sites.

Validation (latest motion pass): Chrome guest browser desktop and 400px and 320px responsive visual checks; globe mode switches, motion pause/resume, feature selection and arrow-key tab navigation checked. JavaScript syntax and deployed-source checks also run. This is targeted website QA, not an accessibility certification.

The globe uses a resized NASA Black Marble night texture already used by the desktop app. Its signal contours are procedural artwork, not live data. Feature screenshots are labeled prototype captures. No external font, animation library, analytics or runtime CDN is required.

Motion is paused offscreen and when the document is hidden. The visitor can pause continuous motion, and the reduced-motion media preference disables decorative CSS motion and stops the globe loop. A static globe fallback remains when WebGL or its texture is unavailable. See `docs/WEBSITE_MOTION_DIRECTION.md` for research and implementation rationale.
