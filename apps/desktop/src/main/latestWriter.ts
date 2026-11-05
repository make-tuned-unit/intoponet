/**
 * Saves one value (the private library) in order, writing only the newest: a save asked for while
 * another is running waits for it, and saves superseded in the meantime are skipped (their callers
 * learn the outcome of the save that replaced them). flush() waits until everything asked for is on disk.
 */
export class LatestWriter<T> {
  private queued: { value: T; waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> } | null = null
  private running: Promise<void> | null = null

  constructor(private readonly write: (value: T) => Promise<void>) {}

  /** True while a save is running or waiting to run. */
  get pending(): boolean {
    return this.running !== null || this.queued !== null
  }

  save(value: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiters = this.queued?.waiters ?? []
      waiters.push({ resolve, reject })
      this.queued = { value, waiters }
      if (!this.running) this.running = this.drain()
    })
  }

  /** Drop a save that has not started (the value is being deleted); waits for one already running. */
  async discard(): Promise<void> {
    const queued = this.queued
    this.queued = null
    for (const waiter of queued?.waiters ?? []) waiter.resolve()
    await this.flush()
  }

  /** Resolves once nothing is running or waiting (failures are reported to the savers, not here). */
  async flush(): Promise<void> {
    while (this.running) await this.running
  }

  private async drain(): Promise<void> {
    try {
      while (this.queued) {
        const { value, waiters } = this.queued
        this.queued = null
        try {
          await this.write(value)
          for (const waiter of waiters) waiter.resolve()
        } catch (error) {
          for (const waiter of waiters) waiter.reject(error)
        }
      }
    } finally {
      this.running = null
    }
  }
}
