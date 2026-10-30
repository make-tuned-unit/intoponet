# macOS update path

## Current behavior

Packaged macOS builds check for updates automatically by default: about 45 seconds after launch, then roughly once a day while the app is open. The time of the last check (manual or automatic) is kept in `updates.json` in the app's data folder, so a relaunch does not check again until a day has passed. People can turn this off under **Settings › Updates › Check for updates automatically**; the manual **Check and download** button remains.

Each check uses Electron's native `autoUpdater` (Squirrel.Mac) against `<feed>/releases.json`. When an update is found, Squirrel.Mac downloads and verifies it in the background. A banner then says the version is ready, with **Restart now** and **Later**; **Restart to install** is also in Settings. A downloaded update is applied the next time the app quits and reopens. An automatic check never interrupts a check in progress or replaces an update waiting to install.

The updater is disabled in preview builds and when no feed URL is configured. `INTOPONET_MAC_UPDATE_URL` is a release-build setting containing an HTTPS base URL with no credentials, query string, or fragment. The package script rejects plain HTTP, local/IP hosts, nonstandard ports, and URL credentials or query parameters.

The renderer receives only a small status value (state, installed version, whether automatic checks are on, the last check time, and the downloaded version) and a generic failure message. Raw updater errors and feed URLs are not sent to the renderer. The app adds no updater account, auth token, analytics event, or persistent device identifier. A check reveals the app version, network address and standard request metadata to the update server; nothing about browsing is sent.

## Release artifacts

The macOS package script creates the app ZIP from the final built app bundle after the release signing, notarization, stapling, and Gatekeeper checks. It records hashes for the DMG, ZIP, CycloneDX SBOM, inventory, and `SHA256SUMS.txt`. When a valid update base URL is configured, it also emits `releases.json` with the version, archive URL, SHA-256 digest, byte size, and publication time. The feed points to the ZIP produced for that architecture, so arm64 and x64 releases need distinct update paths or equivalent architecture-aware server behavior.

The generated JSON contains the current build entry; Squirrel.Mac's static JSON format needs only the entry named by `currentRelease`. An operator maintaining a live feed may retain older entries for history, must publish the JSON and referenced ZIP at the configured locations, and should verify the downloaded artifacts against the release inventory. Packaging never uploads or publishes files.

## Security and rollout limits

Electron requires a signed macOS app for Squirrel.Mac updates. The release package gate requires Developer ID signing and notarization credentials, but no public update endpoint or credentials are configured in this repository. There is no live signed update check/download/restart evidence, and no claim of end-to-end update verification is made. The native updater and macOS code-signature checks are used; this project adds no custom signature-verification code.

Automatic checks are daily and on by default. There is no staged rollout management, in-app rollback, automatic previous-version recovery, or assigned CVE response owner. A recovery release must use a higher version. Operators should retain and distribute the previous known-good installer while a recovery release is prepared. A downloaded update will be applied on the next app launch according to Electron's native updater behavior.

## Verification record

The controller tests cover preview/platform/feed disablement, no request before the explicit action, check/download/restart state transitions, generic errors, IPC command validation, and rejected non-HTTPS or local feed URLs. Release-inventory tests cover ZIP and feed-manifest checksums. These are local tests; they do not verify a Developer ID update, a public feed, live server redirects, or a production release.

References: [Electron update guide](https://www.electronjs.org/docs/latest/tutorial/updates), [Electron `autoUpdater` API](https://www.electronjs.org/docs/latest/api/auto-updater/), [Electron code signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing), [Squirrel.Mac update format](https://github.com/Squirrel/Squirrel.Mac#update-file-json-format).
