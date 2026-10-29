# ADR-007: Browser security and capability policy

- Status: Proposed; policy and release evidence incomplete
- Decision owners: project maintainers
- Scope: browser-facing security behavior for Electron and CEF candidates
- Related requirements: PRD WEB-001, WEB-006, WEB-007, WEB-009; PRD §6.3 and §11; ADR-001

## Context

Intoponet embeds Chromium but owns the browser host, user-facing security
signals, permission and download decisions, and the upstream update process. The
current Electron host is a useful security spike, not a public-browser security
approval. The current CEF program is a compositor comparator and does not yet
implement an equivalent browser policy surface. ADR-001 therefore remains open.

This record inventories observed implementation, evidence not yet collected,
and decisions still required before public beta. “Implemented” below describes
code presence only; it does not imply a security test passed. No item in this
record is security approval.

## Current policy inventory

| Area | Current implementation | Untested / evidence gap | Required decision before public beta |
|---|---|---|---|
| Renderer sandbox and privileged bridge | Electron shell and website `WebContentsView` set `sandbox: true`, `nodeIntegration: false`, and `contextIsolation: true` (`apps/desktop/src/main/index.ts:524-532,846-861`). Only the trusted shell gets the preload; it exposes a frozen typed browser API (`apps/desktop/src/preload/index.ts:25-104`). | No sandbox escape or renderer-to-host isolation test, IPC fuzz/property suite, or production packaged-build verification. | Keep arbitrary page renderers sandboxed with no preload/native/Node bridge; verify packaged settings and fuzz the validated command boundary. |
| Site isolation / process model | No explicit site-isolation setting or process-model policy is configured in the Electron host. The CEF comparator parity contract requires Chromium sandbox and no page bindings (`experiments/cef-compositor/README.md:60-67`). | Neither candidate has measured cross-site process isolation or adversarial origin-boundary evidence. The CEF sample is a compositor workload, not an equivalent browser host. | Record the Chromium site-isolation defaults and any platform limitations; test cross-site iframe/process boundaries for the selected engine and supported platforms. |
| Origin and TLS identity | The shell displays the page host and labels HTTPS as secure / HTTP as not secure (`apps/desktop/src/renderer/src/App.tsx:103-110,185,1280-1294`). TLS failure is rejected and surfaced as a navigation failure (`apps/desktop/src/main/index.ts:372-376,382-386,598-614`). A native probe covers direct, redirected, and iframe self-signed certificate rejection (see below). | No phishing/origin spoofing assessment, HSTS, expired/name-mismatch/public-CA certificate coverage, or accessibility/visibility review of the identity signal. The “secure” indicator currently means HTTPS scheme, not a full security verdict. | Define exact origin and certificate-state vocabulary; never imply a site is trustworthy solely because TLS is active. Test lookalike domains, punycode, redirects and certificate failures. |
| Certificate errors | The host denies certificate errors for its browsing session through `rejectCertificateErrorForSession` (`apps/desktop/src/main/browserCertificatePolicy.ts`). The 2026-10-29 native Electron probe exercised direct top-level self-signed localhost navigation, an HTTP redirect to the same invalid HTTPS origin, and the same invalid origin in an iframe. Each raised `ERR_CERT_AUTHORITY_INVALID`; the production helper prevented the default and called `callback(false)`. The iframe's `isMainFrame` was false and the HTTP parent stayed usable (`experiments/browser-policy/evidence/native-browser-2026-10-29.json`). | No coverage for expired certificates, hostname mismatch, public CA trust, other certificate errors, or other platforms. This is a loopback probe, not packaged-app verification. | Keep fail-closed behavior. Decide whether there will ever be a narrowly scoped, explicit exception flow; do not add a bypass without a separate review and durable origin/cert display. |
| Popups | The page handler uses production `popupDecision`, `nestedPopupDecision`, `popupWindowOptions`, and `bindPopupCloseWithOwner` helpers: ordinary new-tab dispositions route to tabs, sized windows retain `window.opener`, nested children are rate-limited and forced to HTTP(S) tabs, and owner destruction force-destroys child windows (`apps/desktop/src/main/index.ts`; `apps/desktop/src/main/popups.ts`). Native loopback probe on Electron 45 observed public/private tab plans, actual private child-session inheritance, opener retention, three allowed popup children and a denied fourth at both root and nested levels. A test child's ordinary close was vetoed by `beforeunload`; owner destruction force-destroyed the child without rerunning the hook (`experiments/browser-policy/evidence/native-browser-2026-10-29.json`; `docs/browser-popup-policy.md`). | Tabs are BrowserWindow stand-ins rather than production WebContentsView tabs. The `file:` renderer request did not reach `setWindowOpenHandler`; special-scheme and nested `about:blank` denial are verified by production helper checks, not actual renderer dispatch. Real sign-in compatibility, packaged behavior, and other platforms remain untested. | Decide whether the opener-preserving sign-in window is acceptable or should become an isolated tab flow. Test redirects, nested windows, private-session lifecycle and user-visible attribution. |
| Site permissions | `setPermissionRequestHandler` maps camera, microphone, location, notifications and clipboard reads to the in-app permission broker and per-origin remembered decisions; private-tab decisions are in memory (`apps/desktop/src/main/index.ts`; `apps/desktop/src/main/sitePermissions.ts`). The 2026-10-29 native Electron probe uses production broker/helpers with a fake camera device: Allow succeeds, reset changes permission query to denied, and a later request prompts again; the already-active fake capture track remains live after reset until explicitly stopped. Dismiss denies the later request; Block remains stored for a separate origin; pending requests are denied on page navigation and WebContents destruction by the production owner-lifecycle helper (`experiments/browser-policy/evidence/native-browser-2026-10-29.json`). | Probe does not exercise production permission-bar/IPC UI, whether the UI stops/reloads an existing capture or dispatches device-change events on reset, real OS access grants, persistent permission-file behavior, microphone/location/notifications/clipboard, renderer process crashes, or private-session cleanup. Compositor benchmarks do not exercise permissions. | Validate every supported permission with the actual host UI and system adapter. Ensure saved decisions can be reset, and decide whether/how reset stops active media captures. Decide whether additional device APIs should remain denied or receive explicit prompts. |
| Downloads and file handling | Download destinations are atomically reserved in the OS Downloads directory with exclusive creation and sanitized single-component filenames (`apps/desktop/src/main/downloadReservation.ts`; `apps/desktop/src/main/index.ts`). Existing names, dangling symlinks and concurrent same-name downloads do not overwrite each other. Cancelled or interrupted downloads only remove an owned empty reservation. The native Electron probe saved two same-name downloads with intact payloads in a temporary directory (`experiments/browser-policy/evidence/native-browser-2026-10-29.json`; details in `docs/browser-downloads.md`). | No pre-download confirmation, source-origin/size display, dangerous-file handling, malware/phishing scan, partial-file cleanup policy for nonempty files, or launch/open policy. Native test used Electron 45/macOS only and a temp directory. Electron comparator explicitly does not test security/download behavior (`experiments/electron-compositor/README.md:43-52`). | Decide prompt and safe-file handling policy, including quarantine/scanning integration, cancellation, origin display, and whether files ever auto-open. |
| Navigation and external protocols | In-panel navigation and popup destinations are restricted to HTTP(S) (`apps/desktop/src/main/index.ts`; `apps/desktop/src/main/popups.ts`; `packages/browser-api/src/index.ts` validates launcher intent). | No explicit handling or consent flow for `mailto:`, `tel:`, custom app schemes, `file:`, `javascript:` or OS protocol dispatch. No navigation redirect/gesture test matrix. | Keep web content HTTP(S)-only in-panel. Define an allowlist and confirmation UX for any external protocol broker; reject unknown schemes and test redirects, frames and user gestures. |
| WebRTC | Camera and microphone requests use the user permission bar and origin-scoped decisions; other device/network capabilities not mapped by `kindsFor` are denied (`apps/desktop/src/main/sitePermissions.ts`). | No WebRTC leak test for local/public IP exposure, ICE/STUN/TURN, tab teardown, permission denial or allowed capture. The PRD requires WebRTC compatibility subject to Chromium and a leak policy (WEB-001; §6.3). | Decide whether WebRTC is supported, which device permissions are grantable, and privacy controls for IP exposure. Test leak behavior with and without permission, including VPN/proxy conditions where supported. |
| Passwords and autofill | No Intoponet password manager or credential/autofill API appears in the host or typed browser API (`apps/desktop/src/preload/index.ts:25-104`; `packages/browser-api/src/index.ts`). Website storage uses the persistent `persist:intoponet-default` session (`apps/desktop/src/main/index.ts:524-531`). | No audit of Chromium/Electron save-password prompts, autofill, OS credential integration, profile encryption, form-field exposure, or credential clearing. | Explicitly choose built-in Chromium password save/autofill behavior versus disabled; define OS-backed storage, user controls, clear/export semantics, and avoid exposing passwords to shell IPC or absorption. |
| WebAuthn / passkeys | No host-level WebAuthn/passkey policy or broker is present in the browser API. | Not tested on Electron or CEF, including platform authenticators, security keys, origin scoping, user verification, and browser UI visibility. | Decide supported platform authenticators and relying-party/user-verification UX; preserve Chromium origin binding and document limitations. |
| Automatic updates and CVEs | A macOS signing/notarization pipeline is implemented but remains unexercised with release credentials (see `docs/macos-packaging.md`). A manual native macOS updater is implemented behind a release-build HTTPS feed setting, with preview updates disabled; no live signed update, CVE intake owner, emergency release process or update rollback is established. See `docs/automatic-updates.md`. Electron and CEF versions are pinned for their benchmark artifacts, not a demonstrated release channel (`experiments/cef-compositor/cef.lock.json`; compositor baselines). | No signed packaged release/update test, rollback test, upstream-to-release latency measurement, or maintainer/on-call assignment. | Name an owner; set an upstream Chromium/Electron-or-CEF tracking cadence and severity SLA; implement signed updates, rollback, regression gates, SBOM and emergency patch process before public beta, per PRD §6.3. |
| Crashes and memory pressure | `render-process-gone` replaces the view and allows one automatic URL reload per tab within a 60-second window. A second crash latches automatic recovery off until explicit Reload/new navigation or tab close, even after the time window expires (`apps/desktop/src/main/index.ts`; `apps/desktop/src/main/crashRecovery.ts`). | The policy helper and actual packaged renderer crash/retry flow have passed tests using temporary profiles (`docs/feature-verification/macos-installer-2026-10-29.json`). GPU-process failure, memory pressure and form-state preservation remain unverified; no crash reporting policy is approved. Both engine baseline docs list crash recovery as outstanding (`experiments/electron-compositor/BASELINE.md:36-38`; `experiments/cef-compositor/BASELINE.md:44-47`). | Test renderer and GPU-process failures in the selected engine and packaged builds. Decide on opt-in redacted diagnostics and user guidance for unsaved page state. Automatic recovery reloads the URL and does not preserve POST bodies or in-page form state. |
| DRM and codecs | Electron comparator observed local H.264 and VP8 playback; CEF rejected H.264 and hung on the VP8 test (`experiments/electron-compositor/BASELINE.md:1-24`; `experiments/cef-compositor/BASELINE.md:35-42`). | This measures local decode only, not encrypted media/DRM, platform CDMs, license flows, codec packaging rights, or production distribution. | Publish a supported media/DRM and codec matrix by OS/build. Decide whether DRM is supported, with licensing and update implications; do not imply Chrome parity. |
| Extensions | No extension installation/management surface or extension IPC API exists. PRD prohibits arbitrary plugin installation in v0.1 (`INTOPONET_PRD.md:178-187`). | Compatibility and risk of Chromium extension APIs have not been evaluated. | Keep extensions unsupported in v0.1 unless a separately reviewed allowlisted design is approved; explicitly communicate that limitation. |
| Phishing / malware | No Safe Browsing or equivalent reputation feed/interstitial implementation is visible in the host. | No malicious-download, phishing, malware, warning bypass or feed-update tests. | Decide whether to integrate a supported protection service or clearly document lack of coverage; evaluate privacy and egress before adding remote reputation checks. |

## Benchmark and validation gaps

The current Electron and CEF evidence is compositor evidence. Electron's five
corrected runs and CEF's five runs were recorded on an Apple M4 with a 30 Hz
display and do not meet the PRD's 60 fps target. CEF's video result is a failed
WebM run that hung, while Electron decoded the local H.264 and VP8 samples. The
comparators explicitly leave permissions, crash recovery, accessibility/IME,
energy impact and production packaging incomplete
(`experiments/electron-compositor/BASELINE.md`; `experiments/cef-compositor/BASELINE.md`).
Neither benchmark measures the browser-policy rows above, including certificate
handling, real popup flows, download safety, WebRTC leakage, credentials,
passkeys, updates, DRM, or extensions.

Before ADR-001 can select an engine, both candidates need matched security
scenarios and written results in their experiment result directories. At
minimum: sandbox/site-isolation verification; origin/TLS and certificate
failure cases beyond the narrow Electron probe; permission allow/block/reset
through the production UI and system adapter, including active-capture behavior;
popup and external-protocol
navigation; safe-download cases; WebRTC leak checks; crash and memory-pressure
recovery; and package/update/signature checks. Credential/passkey, DRM and
extension conclusions may be explicit product support decisions where a
comparable test is not applicable, but must not be inferred from compositor
performance.

## Decisions still open

1. Keep strict deny-by-default permissions and verify origin-bound grants,
   decision reset behavior, and the UI policy for already-active device
   captures.
2. Decide whether opener-preserving sign-in popups remain supported, and define
   any external-protocol consent flow without escaping the browser trust
   boundary silently.
3. Adopt a safe-download flow and decide what malware protection can be offered
   without hidden browsing-data egress.
4. Choose credential and passkey capabilities, storage protection and deletion
   behavior.
5. Define supported WebRTC, DRM/codecs and extension compatibility by platform.
6. Establish the signed update, CVE intake, emergency patch and rollback owner
   and process.
7. Validate crash recovery, origin/TLS presentation, sandbox and site isolation
   in packaged builds for the eventual engine.

Until those decisions and evidence exist, ADR-007 remains proposed and ADR-001
remains open. This document records a policy backlog; it does not certify the
current implementation or approve public release.

## Permission lifecycle follow-through — 29 October

The broker now defers storing an Allow decision until its pending OS prompt is still current. Reset, private-session exit, a newer overlapping decision, navigation, renderer failure and tab/popup destruction invalidate pending requests; a late OS response cannot restore them. Private-session invalidation runs before asynchronous storage cleanup. Repeated Allow clicks do not produce duplicate OS prompts.

The production lifecycle helper cancels at document-navigation start. Because requests currently retain a WebContents owner rather than a requesting frame ID, any frame changing documents conservatively cancels that owner's pending prompts; same-document navigation does not. Frame-specific prompting would avoid dismissing an unrelated prompt during an embedded frame's navigation and remains a compatibility improvement. Unit tests cover OS-prompt races; native probe evidence covers navigation/destruction, synthetic camera Allow/reset/Block, and self-signed TLS denial for direct navigation, redirect target, and iframe while preserving the parent page. No real OS media permission was changed.
