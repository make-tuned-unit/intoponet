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
| Origin and TLS identity | The shell displays the page host and labels HTTPS as secure / HTTP as not secure (`apps/desktop/src/renderer/src/App.tsx:103-110,185,1280-1294`). TLS failure is rejected and surfaced as a navigation failure (`apps/desktop/src/main/index.ts:372-376,382-386,598-614`). | No phishing/origin spoofing assessment, certificate error matrix, HSTS/expired/name-mismatch/self-signed test, or accessibility/visibility review of the identity signal. The “secure” indicator means HTTPS scheme, not a full security verdict. | Define exact origin and certificate-state vocabulary; never imply a site is trustworthy solely because TLS is active. Test lookalike domains, punycode, redirects and certificate failures. |
| Certificate errors | The host denies certificate errors for its browsing session (`apps/desktop/src/main/index.ts:382-386`); load failures in a certificate code range get explanatory text (`apps/desktop/src/main/index.ts:372-376`). | No tests establish coverage across main/subframes, redirects, expired/invalid roots, or platform-specific trust behavior. | Keep fail-closed behavior. Decide whether there will ever be a narrowly scoped, explicit exception flow; do not add a bypass without a separate review and durable origin/cert display. |
| Popups | `setWindowOpenHandler` denies all popup creation and reports a message (`apps/desktop/src/main/index.ts:536-545`). | No real-page popup test, opener relationship test, or usability evidence for login/payment flows blocked by the rule. The comparator baselines do not measure popup behavior (`experiments/electron-compositor/README.md:43-52`; `experiments/cef-compositor/README.md:60-67`). | Decide whether to retain deny-all or provide a user-initiated, isolated tab flow; never silently open a system window or grant an opener bridge. |
| Site permissions | The persistent browsing session denies every permission request (`apps/desktop/src/main/index.ts:379-382`). | The UI has no permission prompt or per-origin grant/revoke model. Permissions were not exercised in either compositor benchmark; denial behavior is not tested for permission variants. | Choose explicit per-permission policy and origin-bound prompts for camera, microphone, location, notifications, clipboard, USB/HID/serial and screen capture. Default deny; make grant duration and revocation visible. |
| Downloads and file handling | Download events are automatically assigned a unique path under the OS Downloads directory and completion is announced (`apps/desktop/src/main/index.ts:358-369,387-399`; `packages/browser-api/src/index.ts` defines the completion event). | No pre-download confirmation, source-origin/size display, dangerous-file handling, malware/phishing scan, partial-file cleanup, filename/path adversarial tests or launch/open policy. Electron comparator explicitly does not test security/download behavior (`experiments/electron-compositor/README.md:43-52`). | Decide prompt and safe-file handling policy, including filename sanitization, overwrite behavior, quarantine/scanning integration, cancellation, origin display, and whether files ever auto-open. |
| Navigation and external protocols | Host navigation is restricted to HTTP(S) (`apps/desktop/src/main/index.ts:77-84,546-548`; `packages/browser-api/src/index.ts` validates launcher intent). Popups are blocked. | No explicit handling or consent flow for `mailto:`, `tel:`, custom app schemes, `file:`, `javascript:` or OS protocol dispatch. No navigation redirect/gesture test matrix. | Keep web content HTTP(S)-only in-panel. Define an allowlist and confirmation UX for any external protocol broker; reject unknown schemes and test redirects, frames and user gestures. |
| WebRTC | Because session permission requests are denied, device capture permissions are not granted through the current browser host (`apps/desktop/src/main/index.ts:379-382`). | No WebRTC leak test for local/public IP exposure, ICE/STUN/TURN, tab teardown, permission denial or future grant behavior. The PRD requires WebRTC compatibility subject to Chromium and a leak policy (WEB-001; §6.3). | Decide whether WebRTC is supported, which device permissions are grantable, and privacy controls for IP exposure. Test leak behavior with and without permission, including VPN/proxy conditions where supported. |
| Passwords and autofill | No Intoponet password manager or credential/autofill API appears in the host or typed browser API (`apps/desktop/src/preload/index.ts:25-104`; `packages/browser-api/src/index.ts`). Website storage uses the persistent `persist:intoponet-default` session (`apps/desktop/src/main/index.ts:524-531`). | No audit of Chromium/Electron save-password prompts, autofill, OS credential integration, profile encryption, form-field exposure, or credential clearing. | Explicitly choose built-in Chromium password save/autofill behavior versus disabled; define OS-backed storage, user controls, clear/export semantics, and avoid exposing passwords to shell IPC or absorption. |
| WebAuthn / passkeys | No host-level WebAuthn/passkey policy or broker is present in the browser API. | Not tested on Electron or CEF, including platform authenticators, security keys, origin scoping, user verification, and browser UI visibility. | Decide supported platform authenticators and relying-party/user-verification UX; preserve Chromium origin binding and document limitations. |
| Automatic updates and CVEs | No browser/app updater, signing pipeline, CVE intake owner, emergency release process, or update rollback implementation is established by the inspected host. Electron and CEF versions are pinned for their benchmark artifacts, not a demonstrated release channel (`experiments/cef-compositor/cef.lock.json`; compositor baselines). | No signed packaged release/update test, rollback test, upstream-to-release latency measurement, or maintainer/on-call assignment. | Name an owner; set an upstream Chromium/Electron-or-CEF tracking cadence and severity SLA; implement signed updates, rollback, regression gates, SBOM and emergency patch process before public beta, per PRD §6.3. |
| Crashes and memory pressure | `render-process-gone` replaces the view and immediately reloads the prior URL (`apps/desktop/src/main/index.ts:616-638`). | Recovery is not benchmarked; no memory-pressure behavior, repeated-crash loop guard, form/data-loss warning, crash report policy, or isolation test exists. Both engine baseline docs list crash recovery as outstanding (`experiments/electron-compositor/BASELINE.md:36-38`; `experiments/cef-compositor/BASELINE.md:44-47`). | Decide retry limits/backoff and user controls; preserve safe state only, avoid surprise form resubmission, show a clear crash state, and define opt-in redacted crash diagnostics. Test renderer and GPU-process failures. |
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
failure cases; permission allow/deny/revoke; popup and external-protocol
navigation; safe-download cases; WebRTC leak checks; crash and memory-pressure
recovery; and package/update/signature checks. Credential/passkey, DRM and
extension conclusions may be explicit product support decisions where a
comparable test is not applicable, but must not be inferred from compositor
performance.

## Decisions still open

1. Keep strict deny-by-default permissions and decide whether origin-bound
   grants are needed for supported device APIs.
2. Decide popup and external-protocol behavior without silently escaping the
   browser trust boundary.
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
