# Shell UI QA

`drive.mjs` launches the **built** desktop app (`npm run build`) with a
throwaway profile and a CDP debugging port. It runs a scenario script and
captures the real window with macOS `screencapture`, so the native Chromium
page view is included. CDP renderer screenshots would omit it.

```sh
npm run build
node experiments/shell-ui-qa/drive.mjs experiments/shell-ui-qa/scenario-bookmarks.mjs experiments/shell-ui-qa/captures
```

- `scenario-bookmarks.mjs` seeds sample bookmarks and groups through the
  sealed private-library API, then walks four views:
  - the pane over the field;
  - the pane beside a browser panel;
  - full screen with the pane;
  - the dock and its search (⌘L).
- `scenario-motion.mjs` captures mid-transition frames, to check that the
  page edge, pane and dock move together.
- `scenario-captures.mjs` and `scenario-captures-full.mjs` cover screenshots
  and recordings, in panel mode and full screen. Each walks the crop
  overlay, saving, the recording pill, the pane thumbnails and the viewer.
  Set `QA_APP_LOG=1` to stream the main process's stdout.
- `scenario-chrome-folders.mjs` covers the full-screen toolbar auto-hide, the
  "more" tools and the Finder group folders, including a group rename.
- `scenario-rail.mjs` covers the favicon tab rail: collapsed, expanded,
  pinned with the pane, and full screen.

- `scenario-globe.mjs` covers the living globe. It waits for live public
  data on a fresh profile, then walks hover, select (inspector), place
  suggestions, flying to Tokyo, layer and window filters, About, and the Mine
  view. Input goes through CDP `Input.*`, so hover and click hit real canvas
  picking.

- `scenario-news.mjs` waits for the local-news digest to cover over 180
  countries, then captures the world view and the Kenya, Brazil and Japan
  inspectors. It uses `shotApp`, a renderer-only CDP capture, so other windows
  on screen never appear in evidence. Prefer `shotApp` whenever no native web
  page is on screen.

- `scenario-olds-absorb.mjs` walks the Rising tab and a rising term, a
  country trend, The Olds for Germany (detail, follow, list), Absorb on
  Wikipedia's Aurora article, a refused sign-in page, a cited Knowledge
  search, and absorbed places on the Mine globe.

- `scenario-laya.mjs` absorbs three Wikipedia articles, turns Laya on (a
  91 MB download into the throwaway profile), waits for indexing, then
  covers Ask with citations, meaning search and related pages.

- `scenario-translate.mjs` opens Spanish, Japanese and French pages and
  records the detected language and the translate bar, then lists the
  Languages panel. It downloads nothing unless `QA_TRANSLATE_INSTALL=1`, which
  adds Spanish (79 MB) and translates the Spanish page.

- `scenario-translate-headlines.mjs` opens Russia's local headlines and
  presses "Translate to English". That one click downloads Russian (89 MB)
  and translates the headlines. It then flips Русский ↔ English.

The driver sets `INTOPONET_CAPTURE_ROOT` to the throwaway profile, so test
runs never write to your real `~/Pictures/Intoponet`.

Capturing needs Screen Recording permission for the terminal. The profile is
deleted after each run. `evidence/` holds the reviewed captures from
2026-10-26.
