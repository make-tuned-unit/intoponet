# Popup policy evidence

The main host routes popup requests through `popupDecision`, which combines
the production `popupPlan` and per-owner `PopupLimiter`. Ordinary new-tab
requests become tabs with the opener's private/public mode; sized sign-in
windows are allowed with sandboxing, context isolation, Node disabled, and the
opener session inherited. `bindPopupCloseWithOwner` closes real popup windows
when their opener WebContents is destroyed. The normal tab path uses the
production `createBrowserTab` callback in the app; this native probe used
BrowserWindow stand-ins with the same session partition selection.

Verification on 2026-10-29 with Electron 45 / Chromium 156 on macOS arm64:

- Native public and private target-blank links reached the production popup
  planner as `tab` decisions; their BrowserWindow stand-ins used the matching
  opener session.
- A private sized popup reached the production `window` plan, inherited the
  private opener's actual Electron session, retained `window.opener`, and had
  no renderer Node global. Destroying the opener closed the child.
- Four quick sized popup attempts from a fresh page yielded three native child
  windows and a denied fourth request. Destroying that opener closed all three
  children.
- From a private sized popup child, four nested popup requests yielded three
  production-helper `tab` decisions and one denial. Three BrowserWindow tab
  stand-ins were created with the private session partition. Nested policy
  unit/native assertions deny unsupported schemes and `about:blank`, while the
  root popup planner still permits `about:blank` as a sized window; the nested
  special-scheme cases were direct helper checks, not renderer-dispatched
  requests.
- The private popup installed a `beforeunload` handler. A normal
  `BrowserWindow.close()` was vetoed and left it alive. When the opener was
  destroyed, the production owner-lifetime helper force-destroyed the popup;
  the `beforeunload` hook did not run again and the child was removed. The
  helper uses `BrowserWindow.destroy()` for this forced cleanup because
  Electron documents that `close()` can be cancelled by the page.
- `popupDecision` denies `file:` URLs, covered by a focused unit test. A
  renderer-created `file:` target did not reach Electron's
  `setWindowOpenHandler` in this run and created no child; therefore this run
  does not prove that the application handler itself blocked that native
  request. Chromium may have suppressed it before dispatch.

The native probe uses loopback fixtures and a temporary user-data directory.
It does not launch the packaged app, exercise the production WebContentsView
tab UI or private-mode cleanup, test real sign-in sites, or cover other
platforms. Evidence is included in
`experiments/browser-policy/evidence/native-browser-2026-10-29.json`.

Electron references:

- https://www.electronjs.org/docs/latest/api/browser-window#winclose
- https://www.electronjs.org/docs/latest/api/browser-window#windestroy
