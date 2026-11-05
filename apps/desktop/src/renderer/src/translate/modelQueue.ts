import { PIVOT_LANGUAGE, type TranslateStatus } from '@intoponet/browser-api'

export type ModelApi = {
  status(): Promise<TranslateStatus>
  install(code: string): Promise<TranslateStatus>
}

/** Languages to download for these groups: your language first, then the most used. */
export function modelsToFetch(groups: Map<string, unknown[]>, target: string, ready: Set<string>, supported: (code: string | null) => boolean): string[] {
  const sources = [...groups.keys()].sort((a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0))
  return (groups.size ? [target, ...sources] : []).filter((code) => !ready.has(code) && supported(code))
}

const BUSY = /Another language is downloading/

type Pending = { code: string; loud: boolean; urgent: boolean; resolve: (ok: boolean) => void; reject: (error: unknown) => void }

/**
 * Language downloads, one at a time. Anything that shows text in another
 * language asks for its models with ensure(); each language downloads once,
 * the first time it is needed, and a language that fails is not retried
 * automatically this session (a manual install() still can). Urgent requests
 * (the open page, or one the reader asked for) go ahead of headline ones.
 *
 * Quiet requests (headlines and titles) download at most a few new languages per
 * session: a World list can hold a dozen languages, about 70 MB each. Past that a
 * language is held back (isHeld) until the reader adds it or a page needs it.
 */
export class ModelQueue {
  status: TranslateStatus | null = null
  private readonly jobs = new Map<string, Promise<boolean>>()
  private readonly pending: Pending[] = []
  private running = false
  private readonly held = new Set<string>()
  private quietDownloads = 0

  constructor(
    private readonly api: ModelApi,
    private readonly onStatus: (status: TranslateStatus) => void,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    /** New languages quiet requests may download per session. */
    private readonly quietLimit = 3,
  ) {}

  /** Held back from a quiet download (over this session's allowance); the reader can still add it. */
  isHeld(code: string): boolean {
    return this.held.has(code)
  }

  private downloaded(code: string): boolean | null {
    if (code === PIVOT_LANGUAGE) return true
    const language = this.status?.languages.find((item) => item.code === code)
    return language ? language.downloaded : null
  }

  /** Download whatever of these is missing, quietly. Resolves with the codes that could not be made ready. */
  async ensure(codes: string[], options: { urgent?: boolean } = {}): Promise<string[]> {
    const unique = [...new Set(codes)]
    const results = await Promise.all(unique.map((code) => this.job(code, false, options.urgent === true).catch(() => false)))
    return unique.filter((_, index) => !results[index])
  }

  /** A download the reader asked for: first in line, retried even after an earlier failure, and errors are thrown. */
  async install(code: string): Promise<void> {
    const known = this.jobs.get(code)
    if (known) {
      this.promote(code)
      if (await known.catch(() => false)) return
      this.jobs.delete(code)
    }
    await this.job(code, true, true)
  }

  /** A language was removed: it can download again later. */
  forget(code: string): void {
    this.jobs.delete(code)
    this.held.delete(code)
  }

  private promote(code: string): void {
    const index = this.pending.findIndex((item) => item.code === code)
    if (index === -1 || this.pending[index]!.urgent) return
    const [entry] = this.pending.splice(index, 1)
    this.enqueueUrgent({ ...entry!, urgent: true })
  }

  /** After other urgent requests, ahead of quiet ones. */
  private enqueueUrgent(entry: Pending): void {
    const firstQuiet = this.pending.findIndex((item) => !item.urgent)
    this.pending.splice(firstQuiet === -1 ? this.pending.length : firstQuiet, 0, entry)
  }

  private job(code: string, loud: boolean, urgent: boolean): Promise<boolean> {
    if (urgent && this.held.has(code)) {
      this.held.delete(code)
      this.jobs.delete(code)
    }
    const known = this.jobs.get(code)
    if (known) {
      if (urgent) this.promote(code)
      return known
    }
    const job = new Promise<boolean>((resolve, reject) => {
      const entry = { code, loud, urgent, resolve, reject }
      if (urgent) this.enqueueUrgent(entry)
      else this.pending.push(entry)
    })
    this.jobs.set(code, job)
    void this.pump()
    return job
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (let next = this.pending.shift(); next; next = this.pending.shift()) {
        try {
          next.resolve(await this.run(next.code, next.loud, next.urgent))
        } catch (error) {
          next.reject(error)
        }
      }
    } finally {
      this.running = false
    }
  }

  private async run(code: string, loud: boolean, urgent: boolean): Promise<boolean> {
    if (!this.status) this.status = await this.api.status().catch(() => null)
    // A download started elsewhere holds the main process's one slot: wait for it, up to about 20 minutes.
    for (let attempt = 0; attempt < 600; attempt++) {
      const present = this.downloaded(code)
      if (present === true) return true
      if (present === null) {
        if (loud) throw new Error('That language is not available.')
        return false
      }
      if (!urgent && attempt === 0) {
        if (this.quietDownloads >= this.quietLimit) {
          this.held.add(code)
          return false
        }
        this.quietDownloads += 1
      }
      try {
        this.status = await this.api.install(code)
        this.onStatus(this.status)
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (!BUSY.test(message)) {
          if (loud) throw error
          return false
        }
        await this.wait(2_000)
        this.status = await this.api.status().catch(() => this.status)
      }
    }
    return false
  }
}
