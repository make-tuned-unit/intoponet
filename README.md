# intoponet

An early, privacy-first spatial browser prototype. It keeps exploration context
visible while real websites run in a sandboxed Chromium surface.

## Current scope

This repository is at the Phase 0 / early Phase 1 cut from the
[product requirements](./INTOPONET_PRD.md). The active implementation is an
Electron compositor spike behind a typed browser-host API. It is not a final
engine decision: the CEF comparator and ADR evidence are still required.

Implemented:

- Recognizable Earth with a synthetic frequency membrane (spec Phases A–B)
- keyboard-first Explore, Search and URL launcher with host auto-detect
- real Chromium `WebContentsView` with no Node integration
- origin display, find-in-page, print, stop, minimize/restore
- local bookmarks with private notes, renameable collections, and recent pages
- downloads saved to the user Downloads folder
- local exploration-context persistence
- reduced-motion, reduced-transparency and keyboard focus states
- dependency-gated delivery plan in [docs/DELIVERY_DAG.md](./docs/DELIVERY_DAG.md)

## Run

```sh
npm install
npm start
```

`npm start` and `npm run dev` both clear `ELECTRON_RUN_AS_NODE` before launching
Electron, so a leftover Node-mode flag cannot turn the app into a REPL. After
`npm run build`, `npm run preview` opens the production bundle the same way.

Build and verify:

```sh
npm run typecheck
npm test
npm run build
```

## Security posture

This is a development spike, not a general-public browser. Site permissions are
denied by default, non-HTTP(S) navigation is blocked, popups are refused, and
the renderer receives only an allowlisted browser API. Downloads go to the
user Downloads folder without a chooser. It does not yet include production
safe-browsing, certificate, password, update or crash-recovery policy.

Useful shortcuts once a page is open: `⌘L` launcher, `⌘F` find, `⌘R` reload,
`⌘[` / `⌘]` back and forward, `⌘+` / `⌘-` / `⌘0` zoom, `⌘⇧C` copy address,
`⌘P` print, `⌘W` close the page, `Esc` return to the field.
