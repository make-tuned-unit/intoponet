import { SAFE_DIALOG_PREFERENCES } from './leavePrompt'

/**
 * What to do when a page opens a window (PRD WEB-001, WEB-009).
 * - Sized popups (window.open with features, as sign-in flows use) open as a
 *   small real window that keeps `window.opener`, so "Sign in with …" can
 *   report back to the page.
 * - Links meant for a new tab open as a tab.
 * - Anything that is not http(s) is refused, and a page that opens windows in
 *   a burst is stopped.
 */
export type PopupPlan =
  | { action: 'deny'; reason: string; /** Blocked only because nobody clicked or typed: the site may be asked about. */ withoutGesture?: true }
  | { action: 'tab'; background: boolean }
  | { action: 'window'; width: number; height: number }

export function popupPlan(details: { url: string; disposition: string; features: string }): PopupPlan {
  let url: URL
  try {
    url = new URL(details.url)
  } catch {
    return { action: 'deny', reason: 'Blocked a popup with an invalid address.' }
  }
  // about:blank popups are how many sign-in flows start before navigating; allow them only as windows.
  const blank = details.url === 'about:blank' || details.url === ''
  if (!blank && url.protocol !== 'https:' && url.protocol !== 'http:') return { action: 'deny', reason: 'Blocked a popup to an unsupported address.' }
  if (details.disposition === 'new-window' || blank) {
    const size = (name: string, fallback: number): number => {
      const match = details.features.match(new RegExp(`(?:^|,)\\s*${name}\\s*=\\s*(\\d+)`, 'i'))
      const value = match ? Number(match[1]) : fallback
      return Math.min(1200, Math.max(320, Number.isFinite(value) ? value : fallback))
    }
    return { action: 'window', width: size('width', 520), height: size('height', 680) }
  }
  return { action: 'tab', background: details.disposition === 'background-tab' }
}

/** At most `max` windows per page in `windowMs`; beyond that, popups are blocked. */
export class PopupLimiter {
  private recent = new Map<number, number[]>()
  constructor(private readonly max = 3, private readonly windowMs = 10_000) {}
  allow(owner: number, now = Date.now()): boolean {
    const times = (this.recent.get(owner) ?? []).filter((at) => now - at < this.windowMs)
    if (times.length >= this.max) {
      this.recent.set(owner, times)
      return false
    }
    times.push(now)
    this.recent.set(owner, times)
    return true
  }
  forget(owner: number): void {
    this.recent.delete(owner)
  }
}

/**
 * Pages may open tabs and windows only right after the person clicked or typed in them
 * (Electron does not report Chromium's user activation to the window-open handler, so main
 * watches the page's own input). One input allows one popup, within `windowMs`.
 */
export class UserActivation {
  private last = new Map<number, number>()
  constructor(private readonly windowMs = 5_000) {}
  note(owner: number, now = Date.now()): void {
    this.last.set(owner, now)
  }
  consume(owner: number, now = Date.now()): boolean {
    const at = this.last.get(owner)
    this.last.delete(owner)
    return at !== undefined && now - at >= 0 && now - at <= this.windowMs
  }
  forget(owner: number): void {
    this.last.delete(owner)
  }
}

/** Input that counts as the person acting on a page (not pointer movement or scrolling). */
export function isActivationInput(type: string): boolean {
  return type === 'mouseDown' || type === 'mouseUp' || type === 'rawKeyDown' || type === 'keyDown' || type === 'char' || type === 'gestureTap' || type === 'touchEnd'
}

/** Watch a page's input so its window-open requests can be told apart from unprompted ones. */
export function trackUserActivation(contents: Pick<Electron.WebContents, 'id' | 'on' | 'once'>, activation: UserActivation): void {
  const id = contents.id
  contents.on('input-event', (_event: Electron.Event, input: Electron.InputEvent) => {
    if (isActivationInput(input.type)) activation.note(id)
  })
  contents.once('destroyed', () => activation.forget(id))
}

export function popupDecision(
  details: { url: string; disposition: string; features: string },
  limiter: PopupLimiter,
  owner: number,
  now = Date.now(),
  /** The person clicked or typed in the page just before (or always allows this site's pop-ups). */
  activated = true,
): PopupPlan {
  const plan = popupPlan(details)
  if (plan.action === 'deny') return plan
  if (!activated) return { action: 'deny', reason: 'Blocked a pop-up the page opened on its own.', withoutGesture: true }
  if (!limiter.allow(owner, now)) {
    return { action: 'deny', reason: 'This page opened several windows at once; the rest were blocked.' }
  }
  return plan
}

/** Popup windows do not own more popup windows: allow only HTTP(S) children as tabs. */
export function nestedPopupDecision(
  details: { url: string; disposition: string; features: string },
  limiter: PopupLimiter,
  owner: number,
  now = Date.now(),
  activated = true,
): PopupPlan {
  const plan = popupPlan(details)
  if (plan.action === 'deny') return plan
  let url: URL
  try { url = new URL(details.url) } catch { return { action: 'deny', reason: 'Blocked a popup with an invalid address.' } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { action: 'deny', reason: 'Blocked a popup to an unsupported address.' }
  }
  const rateLimited = popupDecision(details, limiter, owner, now, activated)
  if (rateLimited.action === 'deny') return rateLimited
  return { action: 'tab', background: false }
}

export function popupWindowOptions(
  plan: Extract<PopupPlan, { action: 'window' }>,
  parent?: Electron.BrowserWindow | null,
): Electron.BrowserWindowConstructorOptions {
  return {
    width: plan.width,
    height: plan.height,
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'Sign-in window',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, ...SAFE_DIALOG_PREFERENCES },
  }
}

export function bindPopupCloseWithOwner(child: Electron.BrowserWindow, opener: Electron.WebContents): void {
  // The owner is already gone; the popup must not veto its own lifetime cleanup.
  const closeWithOpener = (): void => { if (!child.isDestroyed()) child.destroy() }
  opener.once('destroyed', closeWithOpener)
  child.once('closed', () => { if (!opener.isDestroyed()) opener.removeListener('destroyed', closeWithOpener) })
}
