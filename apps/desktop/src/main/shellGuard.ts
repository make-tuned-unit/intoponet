/**
 * The app window (the shell) has the full window.intoponet API. It must only ever show the app's own
 * page: these checks keep it from being navigated elsewhere (a dropped link, a stray location change)
 * and let IPC handlers refuse anything that is not the shell's own top frame.
 */

/**
 * Whether `candidate` is the app's own page. `appUrl` is the dev server URL (same origin counts, so
 * Vite's reloads keep working) or the packaged file:// URL of index.html (that exact file only).
 */
export function isAppShellUrl(candidate: string, appUrl: string): boolean {
  let target: URL
  let app: URL
  try {
    target = new URL(candidate)
    app = new URL(appUrl)
  } catch {
    return false
  }
  if (app.protocol === 'file:') return target.protocol === 'file:' && target.host === app.host && target.pathname === app.pathname
  if (app.protocol !== 'http:' && app.protocol !== 'https:') return false
  return target.origin === app.origin
}

/** Permissions the shell itself may use (copying a link); everything else is refused. */
export const SHELL_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write', 'fullscreen'])
