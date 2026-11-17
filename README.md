# intoponet

A free, privacy-first web browser for Mac that opens on a live globe of the
world's news, in public preview at [intoponet.com](https://intoponet.com). It
keeps exploration context visible while real websites run in a sandboxed
Chromium surface.

## Current scope

The implementation now includes a Chromium browser shell, public geographic
exploration, worldwide RSS coverage and trends, private local knowledge,
Laya retrieval, sourced Olds timelines, workspaces, pages side by side, and
explicit private-beta Beacons. It is built on Electron and released as a
signed, notarized disk image for Apple silicon Macs (macOS 13 or later) that
updates itself.

Implemented capabilities include:

- real Chromium pages, multiple tabs, direct URL navigation and keyboard controls
- origin-bound permission prompts and controlled sign-in popups
- worldwide RSS, Wikipedia readership and natural-event source layers
- Rising/Fading coverage comparisons with source and coverage disclosures
- private bookmarks, tags, collections, geographic pins and encrypted local storage
- explicit Absorb and optional local Laya retrieval with source citations
- Olds story, timeline and list views with attributed historical context
- explicit public Beacon preview, consent and withdrawal for private beta
- reduced-motion and keyboard support, checked with axe (WCAG 2.2 AA) in the
  feature checks; this is not an accessibility certification

See [verification evidence](docs/FEATURE_VERIFICATION.md), the
[PRD gap audit](docs/PRD_GAP_AUDIT_2026-10-28.md), and the
[current execution plan](docs/PRD_EXECUTION_PLAN.md). Every user-facing feature
and the end-to-end check that proves it are listed in
[`docs/FEATURE_DAG.json`](docs/FEATURE_DAG.json). Code presence is not
completion of every PRD acceptance gate.

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
npm run verify:features   # drives the built app through every feature check
```

## Security posture

This is a public preview, not a finished browser. Releases are signed with a
Developer ID, notarized by Apple and updated through the app's own update
feed. Website renderers are sandboxed and receive no native/Node bridge.
Permissions use origin-bound prompts; popups follow a controlled tab/sign-in
flow. Independent security validation and an accessibility certification have
not been done. See
[ADR-007](docs/architecture/ADR-007-browser-policy.md) for policy and limitations.

Useful shortcuts once a page is open: `⌘L` launcher, `⌘F` find, `⌘R` reload,
`⌘[` / `⌘]` back and forward, `⌘+` / `⌘-` / `⌘0` zoom, `⌘⇧C` copy address,
`⌘P` print, `⌘W` close the page, `⌘K` every command.
