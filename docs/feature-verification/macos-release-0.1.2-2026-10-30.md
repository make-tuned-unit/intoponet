# macOS release 0.1.2 (arm64) — 30 October 2026

Delivers The Olds matching fixes from the live-headline testing (see `olds-live-sample-2026-10-30.md`).
Built with `npm run package:macos:release -- --arm64` (keychain Developer ID, `intoponet-notary` profile).
Files were uploaded to Blob and verified before the website redirects and update feed were deployed.

| Check | Result |
| --- | --- |
| Apple notarization (app and DMG) | Accepted |
| Quarantined copy of the app from the mounted DMG | accepted, source=Notarized Developer ID; version 0.1.2 |
| Packaged startup and renderer crash recovery | passed |
| `intoponet.com/download/mac` and the feed's ZIP, re-hashed live | match `SHA256SUMS.txt` |
| Update feed `currentRelease` | 0.1.2 |

```
411afbd197ec82edabdcdee1774adf9863db61efca2366826f2aa9b85b07ecc4  Intoponet-0.1.2-arm64.dmg
9a607eabdbe9fcbc0939941dfdabd5f0b11ae767cb4add6a74d53127488c702a  Intoponet-0.1.2-arm64-mac.zip
```

The in-app update path (Check and download → Restart to install) was verified end to end for 0.1.0 → 0.1.1
on the same feed and Squirrel.Mac setup.
