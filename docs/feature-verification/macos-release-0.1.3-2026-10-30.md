# macOS release 0.1.3 (arm64) — 30 October 2026

Adds automatic update checks (shortly after launch, then about daily; on by default, with a switch in
Settings) and an "update ready" banner, plus The Olds' two-country background (e.g. US–China relations
for "Chinamaxxing"). Files were uploaded to Blob and verified before the site was deployed.

| Check | Result |
| --- | --- |
| Apple notarization (app and DMG) | Accepted |
| Quarantined copy of the app from the mounted DMG | accepted, source=Notarized Developer ID; version 0.1.3 |
| Packaged startup and renderer crash recovery | passed |
| `/download/mac` and the feed's ZIP, re-hashed live | match `SHA256SUMS.txt` |
| Automatic check in the signed app, launched via LaunchServices with no interaction | `idle` at launch → `not-available` at 55 s; `updates.json` saved `lastCheckedAt` |

```
88965c555cad59a68dadc77b5c511b49f9713020c8d718786ce7ef8d26210e8c  Intoponet-0.1.3-arm64.dmg
8ee337b947233746f9830f7126b8a89d83b26e1246eaaba75f1ef486bc360bfc  Intoponet-0.1.3-arm64-mac.zip
```

Installed 0.1.0–0.1.2 apps have no automatic checks; they reach 0.1.3 through Settings › Check and
download, and check automatically from then on.
