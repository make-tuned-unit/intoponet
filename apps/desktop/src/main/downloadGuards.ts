/**
 * Automatic-download limit: a page may start a few downloads on its own, then further ones are
 * held until the person allows or blocks that page. A download started within a few seconds of the
 * person clicking or typing in the page uses up that gesture and is always allowed.
 */
export type DownloadGate = 'allow' | 'hold' | 'block'

export type DownloadRateLimiterOptions = {
  /** Automatic downloads allowed within the window before further ones are held. */
  maxAutomatic?: number
  windowMs?: number
  /** How long after a click or key press a download counts as asked for. */
  gestureMs?: number
}

type PageState = { automatic: number[]; gestureAt: number | null; decision: 'allow' | 'block' | null }

export class DownloadRateLimiter {
  private readonly pages = new Map<string, PageState>()
  private readonly maxAutomatic: number
  private readonly windowMs: number
  private readonly gestureMs: number

  constructor(options: DownloadRateLimiterOptions = {}) {
    this.maxAutomatic = options.maxAutomatic ?? 3
    this.windowMs = options.windowMs ?? 10_000
    this.gestureMs = options.gestureMs ?? 5_000
  }

  private page(key: string): PageState {
    let state = this.pages.get(key)
    if (!state) {
      state = { automatic: [], gestureAt: null, decision: null }
      this.pages.set(key, state)
    }
    return state
  }

  /** The person clicked or typed in the page. */
  gesture(key: string, now: number): void {
    this.page(key).gestureAt = now
  }

  check(key: string, now: number): DownloadGate {
    const state = this.page(key)
    if (state.decision === 'block') return 'block'
    if (state.gestureAt !== null && now - state.gestureAt <= this.gestureMs) {
      // One gesture, one download.
      state.gestureAt = null
      return 'allow'
    }
    if (state.decision === 'allow') return 'allow'
    state.automatic = state.automatic.filter((at) => now - at < this.windowMs)
    if (state.automatic.length >= this.maxAutomatic) return 'hold'
    state.automatic.push(now)
    return 'allow'
  }

  allow(key: string): void {
    this.page(key).decision = 'allow'
  }

  block(key: string): void {
    this.page(key).decision = 'block'
  }

  /** The page went away (or navigated): its counts and answer go with it. */
  forget(key: string): void {
    this.pages.delete(key)
  }
}
