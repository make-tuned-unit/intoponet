# macOS release 0.1.1 (arm64) — 30 October 2026

Brand v3 release of the desktop app (icon, logo, colours, Inter). Built with
`npm run package:macos:release -- --arm64` using the keychain Developer ID identity and the
`intoponet-notary` profile. Update feed: `https://intoponet.com/updates/arm64`.

| Check | Result |
| --- | --- |
| Apple notarization (app and DMG) | Accepted |
| `spctl` on app and signed DMG | accepted, source=Notarized Developer ID |
| Quarantined copy of the app from the mounted DMG | accepted; CFBundleShortVersionString 0.1.1 |
| Packaged startup and renderer crash recovery (`verify-crash-recovery.mjs`) | passed |
| `intoponet.com/download/mac` re-hashed after upload | matches `SHA256SUMS.txt` |

```
f21d976fa922bb687a28e01430073b8383c46c27dd95449eb94f2a364f246d8f  Intoponet-0.1.1-arm64.dmg
dc6b6b6c87bda552f2127d97f76fc35bb4c1a7a6c3aa4495612a5922719f438e  Intoponet-0.1.1-arm64-mac.zip
```

Incident: the website was deployed with 0.1.1 redirects a few minutes before the files were
uploaded, so `/download/mac` returned 404 until the upload finished. The update feed still listed
0.1.0 during that window, so installed apps were unaffected. For future releases, upload to Blob
before deploying the site.

Verified later the same day: an end-to-end in-app update from 0.1.0 to 0.1.1 (see olds-live-sample-2026-10-30.md).
