# Browser runtime verification

## Packaged macOS preview smoke

The crash-recovery smoke launches a packaged `Intoponet.app` with a freshly
created temporary Chromium profile, an ephemeral DevTools port, and a local
HTTP test page. It never reads or writes the normal user profile. The temporary
profile is removed on exit; set `QA_TMP` to choose a scratch directory.

Run it from the repository root:

```sh
node experiments/browser-runtime-verification/verify-crash-recovery.mjs \
  dist/macos/preview/0.1.0-arm64/mac-arm64/Intoponet.app
```

The script checks that the trusted shell UI and preload bridge render, then
opens the local test page and uses Chromium's CDP `Page.crash` command to stop
its renderer twice. It checks that the first failure produces exactly one URL
reload, the second failure pauses automatic recovery, and the shell's Reload
command starts the page again. A successful run prints a JSON report with the
target IDs and HTTP request count.

## Recorded run

On 2026-10-29, the packaged unsigned macOS preview at
`dist/macos/preview/0.1.0-arm64/mac-arm64/Intoponet.app` passed on this machine.
The shell rendered 2,856 characters of UI text and exposed the browser-host
bridge. The local page received two requests after the first renderer crash
(initial request plus one automatic reload); it received no extra request
after the second crash; an explicit Reload produced the third request and
restored the page URL. The script removed its isolated temporary profile.

This verifies one real packaged renderer-crash path and shell startup. It does
not verify GPU-process crashes, memory pressure, VoiceOver or other assistive
technology, signing/notarization, update behavior, or every permission and
popup policy. The preview package is not evidence of release signing.

A final 29 October check also mounted the rebuilt branded DMG read-only, copied its app to an isolated temporary directory, and repeated the startup/crash/retry journey successfully. It checked all artifact checksums and the app icon, then detached the volume and removed temporary data. See [installer evidence](feature-verification/macos-installer-2026-10-29.json). This remains an unsigned preview, not Gatekeeper/notarization approval.
