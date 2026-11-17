# Website direction preview

Live placeholder: https://intoponet-preview.vercel.app

Static HTML/CSS/JavaScript with real app screenshots. Vercel project `intoponet-preview` uses `website` as its repository root. `node build.mjs` copies the site into `dist/`, inlines the first-party analytics snippet (`permagent.js`) and writes each page's Content-Security-Policy; there are no runtime dependencies. For local preview, build and serve `dist/` with any static server (the built pages carry the policy, so inline styles are blocked there as in production).

Release downloads (upload to Blob before deploying the site): the signed, notarized DMG and update ZIP live in the public Vercel Blob store `intoponet-releases` (`releases/<version>/`). `vercel.json` redirects `/download/mac` and `/updates/arm64/<zip>` there; `updates/arm64/releases.json` is the Squirrel.Mac feed and `releases/<version>/` holds checksums, inventory and SBOM. For a new release: build with `npm run package:macos:release`, upload both files to Blob, copy the feed and checksum files here, update `api/_release.js` (the DMG `/download/mac` serves), the update-feed redirect and the version on the page. Never link an unsigned preview build.

`api/registry.js` is the Beacon registry edge proxy, served at `/registry/*` (see `services/beacon-registry/README.md`). Deploy from the repository root (`vercel deploy`); `.vercelignore` uploads only this directory.

The `.openai/hosting.json` file records an earlier reserved Sites project; this placeholder is deployed on Vercel, not Sites.

Validation (latest motion pass): Chrome guest browser desktop and 400px and 320px responsive visual checks; globe mode switches, motion pause/resume, feature selection and arrow-key tab navigation checked. JavaScript syntax and deployed-source checks also run. This is targeted website QA, not an accessibility certification.

The globe uses a resized NASA Black Marble night texture already used by the desktop app. (Earth at Night 2016: NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA GSFC. It is used under NASA's Media Usage Guidelines, and NASA does not endorse Intoponet; see `THIRD_PARTY_NOTICES.md` §5.) Its signal contours are procedural artwork, not live data. Feature screenshots are labeled with the version they were captured in. No external font, animation library or runtime CDN is used. Page views are counted through the site's own endpoint (`api/permagent-analytics`: no cookies, no stored IP address or user agent), kept in the registry's database and drained by the Permagent daemon.

Motion is paused offscreen and when the document is hidden. The visitor can pause continuous motion, and the reduced-motion media preference disables decorative CSS motion and stops the globe loop. A static globe fallback remains when WebGL or its texture is unavailable. See `docs/WEBSITE_MOTION_DIRECTION.md` for research and implementation rationale.

## Brand

Cinematic Brand Kit v3 (30 October 2026). Logos, favicon and the spectrum mark are in `brand/`; web-sized artwork (WebP plus a JPEG fallback for the hero) is in `brand/art/`; PNG icons are in `icons/`; `site.webmanifest`, `apple-touch-icon.png`, `favicon.ico` and the Open Graph image are at the root. Inter is self-hosted in `fonts/` (OFL).

- Tokens: v3 values at the top of `style.css`. Older `--into-*` names map onto them; `--into-panel` (#0d2131) is a derived lifted Midnight for panels, and `--teal-on-light` (#17726e) is a darker teal for text on cream, where Spectral Teal fails WCAG contrast.
- Header logo: the kit's outlined horizontal lockup (Inter Display wordmark), with the wordmark moved up so its lowercase letters centre on the mark (`translate(-20 -76)`) and the viewBox trimmed to the artwork (`35 11 680 132`). Mark and letterforms are unchanged. The same file is used in the desktop app. The kit's `*-on-light-outlined.svg` has a cream wordmark, so it is not used on light surfaces.
- Hero: the kit's illustrated Earth (`desktop-hero-text-free`), a static image with a slow 90s CSS drift that pauses for reduced motion and hidden tabs. Its peaks and lights are examples and are captioned as such. The previous WebGL globe (`globe.js`) was removed.
- The download panel uses the `signal-horizon` spectral field.

## Home page structure (November 2026)

Built from a UX research brief (NN/g, Baymard and others: plain headline, grouped features with real screenshots, no carousels or tabbed content, concrete features before the vision, FAQ, phone fallback). In order:

- **Hero:** a plain headline (what it is and how it differs), the download button with its facts beside it (version and date, size, macOS and Apple silicon, signed and notarized), and a "Coming from Arc?" link to Switching. Phones see "Send this page to your Mac" (Web Share, or copy the link) instead of the download button.
- **What's inside** (`#features`, `.chapter-index`): the five feature chapters, named exactly as their headings.
- **Five chapters** (`.chapter`): See the news, Understand the story, Organize your tabs, Browse faster, Keep what you find. Each has a heading and lede, real captures, and six features in a 3×2 list. Features from the last few releases carry a "New" mark; refresh those marks as releases age.
- **Switching** (`#switch`): three numbered import steps, what comes over and what doesn't, and a download button.
- **Everything you'd expect** (`#essentials`): the everyday tools in one list.
- **Privacy** (`#privacy`, cream): the concrete promises and the Beacon flow.
- **What's new** (`#new`): the latest releases, newest first. Update it with each release.
- **Why a globe** (`#why`, cream): the "One world. Two perspectives." concept illustration (`discovery.js`).
- **Where it's going** (`#vision`), **Questions** (`#faq`, native `<details>`), **Download**.

Styles for these are in `site.css` (loaded after `style.css` and `cinematic.css`). `nav.js` runs the phone menu, the header that stays on screen (opaque once the page scrolls), the header link for the section in view, and the phone share button.

Screenshots are real window captures of the app (`assets/app/0123/`, 2880×1880, WebP at 1200 and 2400 wide), taken from the 0.1.23 build on an isolated profile with the day's live news (7 November 2026). Every claim on the page must match the app; check `docs/FEATURE_DAG.json` and the app before changing copy.

The hero drift and the concept illustration follow the system reduced-motion setting. Sections are never hidden waiting for a scroll.

## Download notifications

`/download/mac` runs `api/download.js`: it redirects to the DMG in `api/_release.js` and, after responding, emails the owner through Resend (version, time and country only; no IP address or identifier; bots, link previews, prefetches and HEAD requests are not counted). Vercel env: `RESEND_API_KEY`, `DOWNLOAD_NOTIFY_TO`, optional `DOWNLOAD_NOTIFY_FROM` (a sender on a domain verified in Resend; the default `onboarding@resend.dev` only delivers to the Resend account's own address) and `DOWNLOAD_NOTIFY_TIMEZONE` (default America/Halifax). Without the key, downloads still work and no email is sent.
