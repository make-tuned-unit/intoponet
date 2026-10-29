# Accessibility verification — 29 October 2026

The built desktop app was audited with axe-core 4.10.2 over eight screens: home, Bookmarks, My map, Privacy, Settings, Knowledge, The Olds, and a focused Japan view. The run used `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa`; it reported **zero violations on each screen**. The scenario now requires each screen's expected selector and state before running axe, so a missing click cannot silently audit the previous screen. Per-screen output and keyboard results are in [the audit JSON](feature-verification/a11y-2026-10-29.json).

Keyboard checks opened Settings with Enter, closed it with Escape, and verified focus returned to the Settings button. The Olds panel received focus on open; Escape closed it and returned focus to its header button. These checks exposed a panel-switch race: a delayed focus-return callback could refocus the previous panel's header after another panel had opened. The callback now checks current panel state before restoring focus.

The run also confirmed the public globe's header copy was ambiguous. Its freshness label described the field snapshot, while the signal total came from the separate live news digest; the count of “sources” was actually the number of active layers. The label now says “No public snapshot yet,” and the summary names active layers. At the time of the run it displayed 47 public signals across four active layers while the snapshot was unavailable. The total is assembled from news-digest signals and eligible public snapshot signals; it does not use the synthetic design-preview fixture.

The focused `globeSignals.test.ts` passed 9 tests. The desktop build used for this run completed successfully. Reproduce the UI check with:

```sh
A11Y_OUT=docs/feature-verification/a11y-2026-10-29.json \
  node experiments/shell-ui-qa/drive.mjs \
  experiments/shell-ui-qa/scenario-a11y.mjs \
  experiments/shell-ui-qa/evidence/a11y-2026-10-29
```

This is a renderer audit plus a small keyboard interaction check. It does not establish full WCAG 2.2 AA conformance, and it does not cover VoiceOver, RTL or localization, or system-level magnification and contrast settings.
