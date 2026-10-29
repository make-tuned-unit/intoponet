/**
 * Keep a broken renderer from automatically reloading in a crash loop.
 * A user initiated retry starts a fresh recovery window.
 */
export class CrashRecoveryPolicy {
  private crashes = new Map<string, number[]>()
  private paused = new Set<string>()

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

  manualRetry(tabId: string): void {
    this.crashes.delete(tabId)
    this.paused.delete(tabId)
  }

  forget(tabId: string): void {
    this.crashes.delete(tabId)
    this.paused.delete(tabId)
  }
}
