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

  /** The kept list, left in place: a tab closed or archived while still blank takes it with it. */
  keptHistory(tabId: string): History | undefined {
    return this.histories.get(tabId)
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

/**
 * The app window's own page (the shell) reloads whenever its renderer goes away: there is no other way
 * back to the tabs. At once the first time; while it keeps crashing (within `windowMs`) it waits longer
 * each time (1 s, 2 s, 4 s… up to `maxDelayMs`), so a shell that crashes as it loads cannot spin.
 */
export class ShellReloadPolicy {
  private crashes: number[] = []

  constructor(private readonly windowMs = 60_000, private readonly maxDelayMs = 30_000) {}

  /** Records a crash; how long to wait before reloading. */
  crashed(now = Date.now()): number {
    this.crashes = this.crashes.filter((at) => now - at < this.windowMs)
    this.crashes.push(now)
    const repeats = this.crashes.length - 1
    return repeats === 0 ? 0 : Math.min(this.maxDelayMs, 1_000 * 2 ** (repeats - 1))
  }
}
