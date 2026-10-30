# Website direction preview

Live placeholder: https://intoponet-preview.vercel.app

Static HTML/CSS/JavaScript with actual prototype screenshots and a dependency-free WebGL globe. Vercel project `intoponet-preview` uses `website` as its repository root. No build step or runtime dependencies. For local preview, serve this directory with any static server.

Release downloads (upload to Blob before deploying the site): the signed, notarized DMG and update ZIP live in the public Vercel Blob store `intoponet-releases` (`releases/<version>/`). `vercel.json` redirects `/download/mac` and `/updates/arm64/<zip>` there; `updates/arm64/releases.json` is the Squirrel.Mac feed and `releases/<version>/` holds checksums, inventory and SBOM. For a new release: build with `npm run package:macos:release`, upload both files to Blob, copy the feed and checksum files here, update the two redirects and the version on the page. Never link an unsigned preview build.

`api/registry.js` is the Beacon registry edge proxy, served at `/registry/*` (see `services/beacon-registry/README.md`). Deploy from the repository root (`vercel deploy`); `.vercelignore` uploads only this directory.

The `.openai/hosting.json` file records an earlier reserved Sites project; this placeholder is deployed on Vercel, not Sites.

Validation (latest motion pass): Chrome guest browser desktop and 400px and 320px responsive visual checks; globe mode switches, motion pause/resume, feature selection and arrow-key tab navigation checked. JavaScript syntax and deployed-source checks also run. This is targeted website QA, not an accessibility certification.

The globe uses a resized NASA Black Marble night texture already used by the desktop app. Its signal contours are procedural artwork, not live data. Feature screenshots are labeled prototype captures. No external font, animation library, analytics or runtime CDN is required.

Motion is paused offscreen and when the document is hidden. The visitor can pause continuous motion, and the reduced-motion media preference disables decorative CSS motion and stops the globe loop. A static globe fallback remains when WebGL or its texture is unavailable. See `docs/WEBSITE_MOTION_DIRECTION.md` for research and implementation rationale.

## Brand

Cinematic Brand Kit v3 (30 October 2026). Logos, favicon and the spectrum mark are in `brand/`; web-sized artwork (WebP plus a JPEG fallback for the hero) is in `brand/art/`; PNG icons are in `icons/`; `site.webmanifest`, `apple-touch-icon.png`, `favicon.ico` and the Open Graph image are at the root. Inter is self-hosted in `fonts/` (OFL).

- Tokens: v3 values at the top of `style.css`. Older `--into-*` names map onto them; `--into-panel` (#0d2131) is a derived lifted Midnight for panels, and `--teal-on-light` (#17726e) is a darker teal for text on cream, where Spectral Teal fails WCAG contrast.
- Header logo: the kit's outlined horizontal lockup (Inter Display wordmark), with the wordmark moved up so its lowercase letters centre on the mark (`translate(-20 -76)`) and the viewBox trimmed to the artwork (`35 11 680 132`). Mark and letterforms are unchanged. The same file is used in the desktop app. The kit's `*-on-light-outlined.svg` has a cream wordmark, so it is not used on light surfaces.
- Hero: the kit's illustrated Earth (`desktop-hero-text-free`), a static image with a slow 90s CSS drift that pauses for reduced motion, hidden tabs and the pause control. Its peaks and lights are examples and are captioned as such. The previous WebGL globe (`globe.js`) was removed.
- The download panel uses the `signal-horizon` spectral field. The "Explore" product image is a capture of the rebranded app.

## Animated sections

- "One world. Two perspectives." (`discovery.js`): a canvas contour field in the brand spectrum. Four peaks sit under the story cards, and a pulse travels the route between them. Switching to "The list" flattens the field and stacks the cards. Peaks and routes are derived from the cards' CSS positions, so it stays aligned at every breakpoint. It runs only while visible and the tab is shown, and draws a still frame with reduced motion. Concept illustration, not data.
- "A real browser. Built with care." (`.everyday` in `cinematic.css`): CSS-only illustrations of bookmarks and collections, screenshots and recordings, privacy, on-device translation and the basics. Every feature shown exists in the app; the visuals are labelled as illustrations. Animations pause off-screen or in hidden tabs, and stop with reduced motion.
- The hero drift and illustration loops follow the system reduced-motion setting; there is no on-page motion toggle.
