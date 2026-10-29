# macOS packaging

This repository builds a macOS DMG from the Electron workspace. The package
contains the production `out/` files, Electron, the project license, and third
party notices. Workspace TypeScript packages are bundled by electron-vite; the
packaging script checks both Electron main and preload bundles for unresolved
package imports before it creates an installer.

Packaging runs on macOS and requires the repository's locked npm dependencies,
Xcode command line tools (`codesign`, `hdiutil`, and `xcrun`), and network access
for Electron Builder's Electron download when the matching Electron archive is
not cached.

## Local unsigned preview

```sh
npm ci
npm run package:macos:preview
```

The preview is unsigned, not notarized, and must not be offered as a public
download. On Apple Silicon it targets arm64; on Intel it targets x64. Override
the architecture with `npm run package:macos:preview -- --arm64` or
`npm run package:macos:preview -- --x64`. The output is under `dist/macos/`.

The preview command intentionally ignores and removes signing/notarization
environment variables in its child build process. It does not access the
keychain or Apple's notary service.

## Signed public release build

Run this only from the macOS release machine after the Developer ID Application
certificate and App Store Connect API key have been provisioned:

```sh
export INTOPONET_MAC_SIGN_IDENTITY='Developer ID Application: Example (TEAMID1234)'
export CSC_LINK='/absolute/path/to/developer-id-application.p12'
export CSC_KEY_PASSWORD='…'
export APPLE_API_KEY='/absolute/path/to/AuthKey_KEYID1234.p8'
export APPLE_API_KEY_ID='KEYID1234'
export APPLE_API_ISSUER='00000000-0000-0000-0000-000000000000'
npm run package:macos:release
```

The command fails before building if any credential is missing or malformed.
`CSC_LINK` must point to a local `.p12` file. The signing identity must be a
Developer ID Application identity with its Team ID. The App Store Connect key
is used by electron-builder to notarize and staple the app; the script then
submits the DMG to Apple's `notarytool` service and staples that ticket too.
It fails unless `codesign` verifies the app, `stapler` validates both app and
DMG tickets, and Gatekeeper (`spctl`) accepts the app. Never put credentials or
certificate files in the repository.
The hardened runtime entitlements contain only `com.apple.security.cs.allow-jit`,
which Electron documents as needed for Electron/V8 notarization. This app has no
native Node add-ons, so the broader unsigned-memory and library-validation
exceptions are not enabled. The release signing and notarization path has not
been exercised until valid Developer ID and App Store Connect credentials are
available; a successful unsigned preview does not approve a public release.

The command supports `--arm64` and `--x64` overrides using the same syntax as
the preview command. It emits a DMG and release inventory; this repository does
not publish the files or modify the website download page.

## Files produced

- `dist/macos/<preview|release>/<version>-<architecture>/Intoponet-<version>-<architecture>.dmg`
- electron-builder's intermediate `.app` bundle beside that DMG
- `Intoponet-<version>-<architecture>.cdx.json` (CycloneDX production dependency SBOM)
- `Intoponet-<version>-<architecture>.inventory.json` (runtime and artifact inventory)
- `SHA256SUMS.txt` (DMG, SBOM, and inventory checksums)

`dist/macos/` and the temporary standalone app staging directory are ignored by
Git. Preview and release outputs for each architecture have separate
directories, so building a preview does not erase an existing release. The
standalone staging directory keeps npm workspace symlinks and development-only
dependencies out of the packaged app.

The inventory command runs after app validation and, for releases, after DMG
notarization, stapling, and Gatekeeper assessment. The DMG digest therefore
identifies its post-stapling bytes. Preview and release inventory files remain
under their corresponding mode-specific output directories.

## Inventory scope and release operations

The CycloneDX document comes from the locked `@intoponet/desktop` production
dependency graph. Electron is a development dependency in npm because it is a
build/runtime tool, but electron-builder embeds it in the app; the inventory
therefore adds the locked Electron version and its embedded Chromium version
explicitly. Chromium's version is resolved from the lockfile-installed
`electron-to-chromium` mapping for that exact Electron version. The mapping
source and version are recorded in both SBOM and inventory. This is version
metadata evidence, not a runtime probe. Workspace TypeScript dependencies are
reported by npm's workspace graph and compiled into `app.asar` by electron-vite;
they are not installed as separate workspace packages in the shipped app.
License metadata is carried as available from package metadata. This inventory
does not claim an exhaustive license review or public-release approval.
Set `SOURCE_DATE_EPOCH` to a fixed source/build timestamp when byte-identical
SBOM metadata is needed across reruns; the SBOM timestamp and serial number are
then normalized deterministically from that input and its contents. Artifact
hashes always describe the exact files created by each package run.

For an approved release, publish the DMG with its matching `.cdx.json`,
`.inventory.json`, and `SHA256SUMS.txt` as one version/architecture set. Verify
the published files against `SHA256SUMS.txt` after upload. Retain the previous
signed, notarized artifact and its inventory until the new release has passed
the release operator's acceptance checks. To roll back, withdraw the new
download and restore the retained previous artifact plus its matching inventory
and checksums; then verify the restored hashes and signature/notarization
status. The application has no automatic updater or in-app downgrade/rollback
mechanism, so this is an operator-managed download rollback procedure.

There is no assigned automatic Chromium/Electron CVE intake owner or automated
update policy in this repository. Release operators must assign an owner to
review Electron/Chromium advisories and decide when to update the pinned runtime
before public distribution. The SBOM and version mapping make the shipped
runtime identifiable; they do not perform vulnerability triage or prove that a
runtime is free of known CVEs.
