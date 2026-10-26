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

Capturing needs Screen Recording permission for the terminal. The profile is
deleted after each run. `evidence/` holds the reviewed captures from
2026-10-26.
