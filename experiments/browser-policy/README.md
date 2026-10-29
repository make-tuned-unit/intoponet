# Native browser policy probe

Run with the repository's installed Electron and esbuild:

    node experiments/browser-policy/run.mjs

The runner builds a small Electron main process in a fresh temporary directory,
creates a separate temporary --user-data-dir, and deletes both after the
process exits or times out. It removes ELECTRON_RUN_AS_NODE from the child
environment. It starts local HTTP and HTTPS fixtures bound only to
127.0.0.1; OpenSSL generates a temporary self-signed localhost certificate
and key. The private key is removed with the temporary directory.

The permission handlers use the production SitePermissionBroker,
SitePermissionStore, kindsFor, and originOf implementations. The certificate
event calls the same session-scoped rejectCertificateErrorForSession helper
used by the production host. The probe exercises a fake Chromium camera
device; it does not open camera hardware or call macOS askForMediaAccess.
Its adapter returns synthetic system-access approval so the app-level broker
can be observed without granting OS permission.

The dated report records Electron/Chromium versions, native permission callback
results, denied/granted permission-query states, the self-signed certificate
event and main-frame navigation failure, and remaining limits. It is written
to experiments/browser-policy/evidence/native-browser-2026-10-29.json.
Loopback ports are ephemeral; this is evidence for that run, not a
deterministic fixture hash or a complete browser security assessment.

## Current result

On 2026-10-29 with Electron 45.0.0 / Chromium 156.0.8078.48 on macOS arm64:

- The http://localhost renderer was a secure context. Camera permission
  started denied; the production broker received an origin-bound camera
  request, an Allow decision returned a fake camera track, and permission
  state became granted.
- broker.reset(origin, false, 'camera') changed the permission query to
  denied, while the already-active fake camera track remained live. The probe
  then explicitly stopped that track; a subsequent capture request created a
  new prompt, and dismissing it returned NotAllowedError. A separate
  127.0.0.1 origin was blocked and remained denied. The loopback hostname and
  IP were treated as different origins.
- A pending broker request tied to the Electron WebContents was cancelled on
  main-frame navigation by the production owner-lifecycle helper: pending
  request count went from 1 to 0 and the callback received false.
- A separate pending request was also denied when its owning WebContents was
  destroyed; its pending count went from 1 to 0.
- A top-level self-signed https://localhost navigation emitted
  net::ERR_CERT_AUTHORITY_INVALID / -202. The production certificate helper
  prevented the default and called callback(false); the fixture marker was
  absent after the failed navigation.
- An HTTP top-level navigation redirected to that self-signed HTTPS origin;
  Electron reported `isMainFrame: true`, the production helper prevented the
  default and called `callback(false)`, and the target failed with
  `ERR_CERT_AUTHORITY_INVALID` / -202.
- An HTTP parent page loaded an HTTPS iframe with the same invalid certificate.
  Electron reported `isMainFrame: false`; the helper prevented the default
  and called `callback(false)`. The parent document stayed loaded and its
  marker and heading remained readable.
- Two concurrent HTTP downloads with the same `Content-Disposition` filename
  completed in the runner's temporary downloads directory as
  `same-name.txt` and `same-name (1).txt`; both saved payloads matched their
  expected bytes. The runner removes this directory at exit.
- profileDirectoryRemovedAfterRun was true in the evidence report.

## Limits

This is a native Electron API probe, not a packaged Intoponet launch. Its
BrowserWindow, test session, synthetic decision callback, and in-memory store
do not exercise the production WebContentsView, permission-bar UI, IPC command
path, persistent permission file, systemPreferences, or private session
lifecycle. It covers camera only, using fake media; it does not grant real
camera access. Resetting a saved permission decision does not stop an existing
media track in this probe. The probe does not exercise the production UI's
behavior for stopping/reloading active captures or dispatching device-change
events. It also does not test microphone, location, notifications, clipboard,
OS-dialog races, renderer process crash handling, expiry, hostname mismatch,
public CA trust, WebRTC, or other platforms. The certificate matrix uses one
temporary self-signed localhost certificate, so it does not characterize other
certificate errors. No trust override was installed: Electron documents
`setCertificateVerifyProc` as accepting a certificate when its callback returns
`0`, which would bypass the exact failure under test. These results do not
establish broader redirect or iframe policy beyond the exercised loopback cases
and do not test certificate exception behavior.

Electron's official `certificate-error` app event defines `isMainFrame`, the
event callback, and default handling; the Session API requires permission request and check
handlers for complete permission handling. The probe's sandboxed renderer
preferences use Electron's BrowserWindow webPreferences. References:

- https://www.electronjs.org/docs/latest/api/app#event-certificate-error
- https://www.electronjs.org/docs/latest/api/session#sessetcertificateverifyprocproc
- https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler
- https://www.electronjs.org/docs/latest/api/browser-window#new-browserwindowoptions
