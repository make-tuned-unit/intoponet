# macOS release 0.1.0 (arm64) — 30 October 2026

Built with `npm run package:macos:release -- --arm64` using the keychain Developer ID
identity `Developer ID Application: the Intoponet authors (TEAMID)` and notarytool keychain
profile `intoponet-notary`. Update feed: `https://intoponet.com/updates/arm64`.

| Check | Result |
| --- | --- |
| Apple notarization (app, via electron-builder; DMG, via notarytool) | Accepted |
| `spctl --type execute` on the app | accepted, source=Notarized Developer ID |
| `spctl --type open` on the signed DMG | accepted, source=Notarized Developer ID |
| Quarantined copy of the app from the mounted DMG | accepted |
| Packaged startup and renderer crash recovery (`verify-crash-recovery.mjs`) on an app copied from the DMG | passed |
| `LSMinimumSystemVersion` | 13.0 |
| Blob downloads re-hashed against `SHA256SUMS.txt` | match |

SHA-256:

```
fbace452deb5924bc40921eed763c32f9679eed3c7241073470efebbdec4a51a  Intoponet-0.1.0-arm64.dmg
d962937ff1f67ec457ded35d847a4393ba92774a3add0aa29ca0a16d561c95fe  Intoponet-0.1.0-arm64-mac.zip
```

Files are in the public Vercel Blob store `intoponet-releases` under `releases/0.1.0/`.
The website redirects `/download/mac` and `/updates/arm64/<zip>` to them and serves
`/updates/arm64/releases.json` and `/releases/0.1.0/` (checksums, inventory, SBOM).

Not verified: a live in-app update (needs a 0.1.1 to update to), Intel Macs, and the
intoponet.com DNS cut-over, which was still pending at build time.
