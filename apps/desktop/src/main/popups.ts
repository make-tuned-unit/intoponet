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
  | { action: 'deny'; reason: string }
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
