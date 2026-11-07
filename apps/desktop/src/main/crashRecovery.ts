/**
 * Keep a broken renderer from automatically reloading in a crash loop.
 * A user initiated retry starts a fresh recovery window.
 * The crashed page's back/forward list is kept until the page loads again (`History`).
 */
export class CrashRecoveryPolicy<History = unknown> {
  private crashes = new Map<string, number[]>()
  private paused = new Set<string>()
  private histories = new Map<string, History>()

  constructor(private readonly windowMs = 60_000) {}

  recordCrash(tabId: string, now = Date.now()): boolean {
    const recent = (this.crashes.get(tabId) ?? []).filter((at) => now - at < this.windowMs)
    recent.push(now)
    this.crashes.set(tabId, recent)
    const mayRetry = recent.length === 1 && !this.paused.has(tabId)
    if (!mayRetry) this.paused.add(tabId)
    return mayRetry
  }

  canAutoRecover(tabId: string): boolean {
    return !this.paused.has(tabId)
  }

  /** The back/forward list the crashed page had (none: it loads its address only). */
  keepHistory(tabId: string, history: History | undefined): void {
    if (history === undefined) this.histories.delete(tabId)
    else this.histories.set(tabId, history)
  }

  /** The kept list, handed out once: when the page loads again, automatically or on Reload. */
  takeHistory(tabId: string): History | undefined {
    const history = this.histories.get(tabId)
    this.histories.delete(tabId)
    return history
  }

  manualRetry(tabId: string): void {
    this.crashes.delete(tabId)
    this.paused.delete(tabId)
  }

  forget(tabId: string): void {
    this.crashes.delete(tabId)
    this.paused.delete(tabId)
    this.histories.delete(tabId)
  }
}
