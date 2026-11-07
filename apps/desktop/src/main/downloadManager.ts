import { randomUUID } from 'node:crypto'
import { downloadCaution, isDangerousDownload, type DownloadAttention, type DownloadEntry, type DownloadState } from '@intoponet/browser-api'
import type { DownloadReservation } from './downloadReservation'
import { DownloadRateLimiter } from './downloadGuards'

/** The parts of Electron's DownloadItem the manager uses (tests pass a fake). */
export interface DownloadItemLike {
  getFilename(): string
  getURL(): string
  getReceivedBytes(): number
  getTotalBytes(): number
  getState(): 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  isPaused(): boolean
  canResume(): boolean
  setSavePath(path: string): void
  pause(): void
  resume(): void
  cancel(): void
  on(event: 'updated', listener: (event: unknown, state: 'progressing' | 'interrupted') => void): unknown
  once(event: 'done', listener: (event: unknown, state: 'completed' | 'cancelled' | 'interrupted') => void): unknown
}

export type DownloadContext = {
  isPrivate: boolean
  /** The page that started it (null for downloads the app started, e.g. a retry). */
  pageKey: string | null
  /** The session it came through (a workspace's own sign-ins, or the shared one): a retry uses the same. */
  partition?: string
}

/** What is kept on disk for a finished download (normal tabs only). */
export type DownloadRecord = {
  id: string
  filename: string
  url: string
  path: string
  state: 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  startedAt: number
  endedAt: number
  error: string | null
  /** The session it came through, when not the shared one (a retry signs in the same way). */
  partition?: string
}

export type DownloadManagerDeps = {
  downloadsDir: () => string
  reserve: (directory: string, filename: string) => DownloadReservation
  sanitize: (filename: string) => string
  /** Push the list to the shell (throttled by the manager). */
  emit: (downloads: DownloadEntry[]) => void
  /** Save finished normal-tab downloads (already capped). */
  persist: (records: DownloadRecord[]) => void
  openPath: (path: string) => Promise<string>
  showItemInFolder: (path: string) => void
  exists: (path: string) => boolean
  /** Delete a file the person chose to discard. */
  remove: (path: string) => void
  /** Make sure the macOS quarantine flag is on a finished file. */
  quarantine: (path: string, url: string) => Promise<void>
  /** Start the same address again (retry), through the session it came through. */
  restart: (url: string, isPrivate: boolean, partition?: string) => void
  /** A download ended (for the "Saved … to Downloads" notice). */
  onDone?: (entry: { filename: string; path: string; state: 'completed' | 'cancelled' | 'interrupted' }) => void
  now?: () => number
  limiter?: DownloadRateLimiter
  emitIntervalMs?: number
  maxRecords?: number
}

type Tracked = {
  id: string
  filename: string
  url: string
  path: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  bytesPerSecond: number
  startedAt: number
  endedAt: number | null
  isPrivate: boolean
  pageKey: string | null
  partition: string | null
  exists: boolean
  item: DownloadItemLike | null
  reservation: DownloadReservation | null
  attention: DownloadAttention | null
  /** Dangerous type still to be asked about once the page's multiple-download question is answered. */
  dangerous: boolean
  note: string | null
  error: string | null
  sample: { at: number; bytes: number } | null
}

const FINISHED: ReadonlySet<DownloadState> = new Set(['completed', 'cancelled', 'interrupted'])

function originOf(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : parsed.protocol.replace(/:$/, '')
  } catch {
    return ''
  }
}

export class DownloadManager {
  private readonly entries: Tracked[] = []
  private readonly limiter: DownloadRateLimiter
  private readonly now: () => number
  private readonly emitIntervalMs: number
  private readonly maxRecords: number
  private lastEmit = 0
  private emitTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: DownloadManagerDeps) {
    this.limiter = deps.limiter ?? new DownloadRateLimiter()
    this.now = deps.now ?? Date.now
    this.emitIntervalMs = deps.emitIntervalMs ?? 250
    this.maxRecords = deps.maxRecords ?? 200
  }

  /** Remembered finished downloads from earlier runs. */
  restore(records: unknown): void {
    if (!Array.isArray(records)) return
    for (const raw of records.slice(0, this.maxRecords)) {
      const record = raw as Partial<DownloadRecord>
      if (
        typeof record?.id !== 'string' || typeof record.filename !== 'string' || typeof record.url !== 'string' ||
        typeof record.path !== 'string' || !['completed', 'cancelled', 'interrupted'].includes(record.state as string) ||
        typeof record.startedAt !== 'number' || typeof record.endedAt !== 'number'
      ) continue
      this.entries.push({
        id: record.id, filename: record.filename, url: record.url, path: record.path, state: record.state as DownloadRecord['state'],
        receivedBytes: Number(record.receivedBytes) || 0, totalBytes: Number(record.totalBytes) || 0, bytesPerSecond: 0,
        startedAt: record.startedAt, endedAt: record.endedAt, isPrivate: false, pageKey: null, partition: typeof record.partition === 'string' ? record.partition : null,
        exists: record.state === 'completed' && this.deps.exists(record.path),
        item: null, reservation: null, attention: null, dangerous: false, note: downloadCaution(record.filename),
        error: typeof record.error === 'string' ? record.error : null, sample: null,
      })
    }
  }

  /** A file the app wrote itself (Export as PDF): listed as a finished download, with Open and Show in Finder. */
  recordSaved(input: { filename: string; url: string; path: string; bytes: number; isPrivate: boolean }): string {
    const now = this.now()
    const entry: Tracked = {
      id: randomUUID(), filename: this.deps.sanitize(input.filename), url: input.url, path: input.path, state: 'completed',
      receivedBytes: input.bytes, totalBytes: input.bytes, bytesPerSecond: 0, startedAt: now, endedAt: now,
      isPrivate: input.isPrivate, pageKey: null, partition: null, exists: true, item: null, reservation: null,
      attention: null, dangerous: false, note: null, error: null, sample: null,
    }
    this.entries.unshift(entry)
    this.save()
    this.scheduleEmit()
    return entry.id
  }

  /** The person clicked or typed in a page (a download right after is one they asked for). */
  gesture(pageKey: string): void {
    this.limiter.gesture(pageKey, this.now())
  }

  forgetPage(pageKey: string): void {
    this.limiter.forget(pageKey)
  }

  /** Call from session 'will-download'. */
  track(item: DownloadItemLike, context: DownloadContext): string {
    const requested = item.getFilename() || 'download'
    const now = this.now()
    const entry: Tracked = {
      id: randomUUID(), filename: this.deps.sanitize(requested), url: item.getURL(), path: '', state: 'progressing',
      receivedBytes: 0, totalBytes: Math.max(0, item.getTotalBytes() || 0), bytesPerSecond: 0, startedAt: now, endedAt: null,
      isPrivate: context.isPrivate, pageKey: context.pageKey, partition: context.partition ?? null, exists: false, item, reservation: null,
      attention: null, dangerous: false, note: null, error: null, sample: { at: now, bytes: 0 },
    }
    this.entries.unshift(entry)

    const gate = context.pageKey ? this.limiter.check(context.pageKey, now) : 'allow'
    if (gate === 'block') {
      item.cancel()
      this.finish(entry, 'cancelled', 'Blocked: this site tried to download many files.')
      return entry.id
    }

    let reservation: DownloadReservation | null = null
    try {
      reservation = this.deps.reserve(this.deps.downloadsDir(), requested)
      item.setSavePath(reservation.path)
    } catch {
      item.cancel()
      reservation?.cleanupIfEmpty()
      this.finish(entry, 'interrupted', 'The file could not be saved in Downloads.')
      return entry.id
    }
    entry.reservation = reservation
    entry.filename = reservation.filename
    entry.path = reservation.path
    entry.dangerous = isDangerousDownload(reservation.filename)
    entry.note = downloadCaution(reservation.filename)

    if (gate === 'hold') entry.attention = 'multiple-downloads'
    else if (entry.dangerous) entry.attention = 'dangerous-type'
    if (entry.attention) {
      // Waits for the person. If it still completes, Discard deletes the finished file.
      item.pause()
      entry.state = 'paused'
    }

    item.on('updated', (_event, state) => this.onUpdated(entry, state))
    item.once('done', (_event, state) => this.onDone(entry, state))
    this.scheduleEmit()
    return entry.id
  }

  private onUpdated(entry: Tracked, state: 'progressing' | 'interrupted'): void {
    const item = entry.item
    if (!item || FINISHED.has(entry.state)) return
    const now = this.now()
    const bytes = item.getReceivedBytes()
    entry.receivedBytes = bytes
    entry.totalBytes = Math.max(0, item.getTotalBytes() || 0)
    if (state === 'interrupted') {
      entry.state = 'interrupted'
      entry.bytesPerSecond = 0
    } else {
      entry.state = item.isPaused() ? 'paused' : 'progressing'
      if (entry.state === 'paused') {
        entry.bytesPerSecond = 0
        entry.sample = null
      } else if (!entry.sample) {
        entry.sample = { at: now, bytes }
      } else if (now - entry.sample.at >= 200) {
        const rate = ((bytes - entry.sample.bytes) * 1000) / (now - entry.sample.at)
        entry.bytesPerSecond = entry.bytesPerSecond ? Math.round(entry.bytesPerSecond * 0.6 + rate * 0.4) : Math.round(rate)
        entry.sample = { at: now, bytes }
      }
    }
    this.scheduleEmit()
  }

  private onDone(entry: Tracked, state: 'completed' | 'cancelled' | 'interrupted'): void {
    if (entry.item) {
      entry.receivedBytes = entry.item.getReceivedBytes()
      entry.totalBytes = Math.max(entry.totalBytes, entry.item.getTotalBytes() || 0)
    }
    if (state !== 'completed') entry.reservation?.cleanupIfEmpty()
    this.finish(entry, state, state === 'interrupted' ? 'The download was interrupted.' : null)
    if (state === 'completed') {
      entry.exists = true
      void this.deps.quarantine(entry.path, entry.url).catch(() => undefined)
    }
    this.deps.onDone?.({ filename: entry.filename, path: entry.path, state })
  }

  private finish(entry: Tracked, state: 'completed' | 'cancelled' | 'interrupted', error: string | null): void {
    entry.state = state
    entry.endedAt = this.now()
    entry.bytesPerSecond = 0
    entry.error = state === 'completed' ? null : entry.error ?? error
    entry.sample = null
    // A file that finished while waiting keeps only the dangerous-type question (Discard deletes it).
    if (state !== 'completed') entry.attention = null
    else if (entry.attention === 'multiple-downloads') entry.attention = entry.dangerous ? 'dangerous-type' : null
    this.save()
    this.scheduleEmit()
  }

  private view(entry: Tracked): DownloadEntry {
    const live = !!entry.item && !FINISHED.has(entry.state)
    return {
      id: entry.id,
      filename: entry.filename,
      origin: originOf(entry.url),
      state: entry.state,
      receivedBytes: entry.receivedBytes,
      totalBytes: entry.totalBytes,
      bytesPerSecond: entry.bytesPerSecond,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      isPrivate: entry.isPrivate,
      exists: entry.state === 'completed' && entry.exists,
      live,
      canRetry: (entry.state === 'interrupted' || entry.state === 'cancelled') && /^https?:/.test(entry.url),
      attention: entry.attention,
      note: entry.note,
      error: entry.error,
    }
  }

  list(): DownloadEntry[] {
    return this.entries.map((entry) => this.view(entry))
  }

  /** A download started from this page is still under way (the page must not be unloaded). */
  activeForPage(pageKey: string): boolean {
    return this.entries.some((entry) => entry.pageKey === pageKey && (entry.state === 'progressing' || entry.state === 'paused'))
  }

  /** Re-check which finished files are still on disk (when the list is opened). */
  refresh(): DownloadEntry[] {
    for (const entry of this.entries) if (entry.state === 'completed') entry.exists = this.deps.exists(entry.path)
    return this.list()
  }

  private find(id: string): Tracked {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry) throw new Error('That download is no longer listed.')
    return entry
  }

  private liveItem(entry: Tracked): DownloadItemLike | null {
    return entry.item && !FINISHED.has(entry.state) ? entry.item : null
  }

  pause(id: string): DownloadEntry[] {
    const entry = this.find(id)
    const item = this.liveItem(entry)
    if (item && entry.state === 'progressing') {
      item.pause()
      entry.state = 'paused'
      entry.bytesPerSecond = 0
      entry.sample = null
    }
    return this.emitNow()
  }

  resume(id: string): DownloadEntry[] {
    const entry = this.find(id)
    const item = this.liveItem(entry)
    if (item && !entry.attention && (entry.state === 'paused' || (entry.state === 'interrupted' && item.canResume()))) {
      item.resume()
      entry.state = 'progressing'
      entry.sample = { at: this.now(), bytes: entry.receivedBytes }
    }
    return this.emitNow()
  }

  cancel(id: string): DownloadEntry[] {
    const item = this.liveItem(this.find(id))
    item?.cancel()
    return this.emitNow()
  }

  async open(id: string): Promise<DownloadEntry[]> {
    const entry = this.find(id)
    if (entry.state !== 'completed' || entry.attention) throw new Error('Only a finished download can be opened.')
    if (!this.deps.exists(entry.path)) {
      entry.exists = false
      this.emitNow()
      throw new Error(`${entry.filename} is no longer in Downloads.`)
    }
    const failure = await this.deps.openPath(entry.path)
    if (failure) throw new Error(`${entry.filename} could not be opened.`)
    return this.list()
  }

  show(id: string): DownloadEntry[] {
    const entry = this.find(id)
    if (!entry.path) throw new Error('This download has no file.')
    if (entry.state === 'completed' && !this.deps.exists(entry.path)) {
      entry.exists = false
      this.emitNow()
      throw new Error(`${entry.filename} is no longer in Downloads.`)
    }
    this.deps.showItemInFolder(entry.path)
    return this.list()
  }

  remove(id: string): DownloadEntry[] {
    const entry = this.find(id)
    this.liveItem(entry)?.cancel()
    this.entries.splice(this.entries.indexOf(entry), 1)
    this.save()
    return this.emitNow()
  }

  retry(id: string): DownloadEntry[] {
    const entry = this.find(id)
    if (entry.state !== 'interrupted' && entry.state !== 'cancelled') return this.list()
    const item = entry.item
    if (item && entry.state === 'interrupted' && item.canResume()) {
      item.resume()
      entry.state = 'progressing'
      entry.error = null
      entry.endedAt = null
      entry.sample = { at: this.now(), bytes: entry.receivedBytes }
      return this.emitNow()
    }
    if (!/^https?:/.test(entry.url)) throw new Error('This download cannot be tried again.')
    this.entries.splice(this.entries.indexOf(entry), 1)
    this.save()
    if (entry.partition) this.deps.restart(entry.url, entry.isPrivate, entry.partition)
    else this.deps.restart(entry.url, entry.isPrivate)
    return this.emitNow()
  }

  keep(id: string): DownloadEntry[] {
    const entry = this.find(id)
    if (entry.attention !== 'dangerous-type') return this.list()
    entry.attention = null
    entry.dangerous = false
    const item = this.liveItem(entry)
    if (item && entry.state === 'paused') {
      item.resume()
      entry.state = 'progressing'
      entry.sample = { at: this.now(), bytes: entry.receivedBytes }
    }
    return this.emitNow()
  }

  discard(id: string): DownloadEntry[] {
    const entry = this.find(id)
    const item = this.liveItem(entry)
    if (item) {
      item.cancel()
    } else if (entry.state === 'completed' && entry.attention && entry.path) {
      // Finished before the answer came: remove only the file this download reserved.
      try { this.deps.remove(entry.path) } catch { /* already gone */ }
    }
    this.entries.splice(this.entries.indexOf(entry), 1)
    this.save()
    return this.emitNow()
  }

  allowMultiple(id: string): DownloadEntry[] {
    const { pageKey } = this.find(id)
    if (pageKey) this.limiter.allow(pageKey)
    for (const entry of this.entries) {
      if (entry.attention !== 'multiple-downloads' || entry.pageKey !== pageKey) continue
      entry.attention = entry.dangerous ? 'dangerous-type' : null
      const item = this.liveItem(entry)
      if (!entry.attention && item && entry.state === 'paused') {
        item.resume()
        entry.state = 'progressing'
        entry.sample = { at: this.now(), bytes: entry.receivedBytes }
      }
    }
    return this.emitNow()
  }

  blockMultiple(id: string): DownloadEntry[] {
    const { pageKey } = this.find(id)
    if (pageKey) this.limiter.block(pageKey)
    for (const entry of [...this.entries]) {
      if (entry.attention !== 'multiple-downloads' || entry.pageKey !== pageKey) continue
      entry.error = 'Blocked: this site tried to download many files.'
      const item = this.liveItem(entry)
      if (item) item.cancel()
      else if (entry.state === 'completed' && entry.path) {
        try { this.deps.remove(entry.path) } catch { /* already gone */ }
        this.entries.splice(this.entries.indexOf(entry), 1)
      }
    }
    this.save()
    return this.emitNow()
  }

  /** Drop finished downloads from the list (files stay). `since` limits it to ones started since then. */
  clearFinished(since = 0): DownloadEntry[] {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]!
      if (FINISHED.has(entry.state) && !entry.attention && entry.startedAt >= since) this.entries.splice(index, 1)
    }
    this.save()
    return this.emitNow()
  }

  /** Private browsing ended: its downloads leave the list. */
  forgetPrivate(): void {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]!
      if (entry.isPrivate && FINISHED.has(entry.state)) this.entries.splice(index, 1)
    }
    this.emitNow()
  }

  records(): DownloadRecord[] {
    return this.entries
      .filter((entry) => !entry.isPrivate && FINISHED.has(entry.state) && !entry.attention && entry.endedAt !== null)
      .slice(0, this.maxRecords)
      .map((entry) => ({
        id: entry.id, filename: entry.filename, url: entry.url, path: entry.path, state: entry.state as DownloadRecord['state'],
        receivedBytes: entry.receivedBytes, totalBytes: entry.totalBytes, startedAt: entry.startedAt, endedAt: entry.endedAt!, error: entry.error,
        ...(entry.partition ? { partition: entry.partition } : {}),
      }))
  }

  private save(): void {
    // Keep the in-memory list bounded too (active downloads are never dropped).
    let finished = 0
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index]!
      if (!FINISHED.has(entry.state)) continue
      finished += 1
      if (finished > this.maxRecords) {
        this.entries.splice(index, 1)
        index -= 1
      }
    }
    this.deps.persist(this.records())
  }

  private emitNow(): DownloadEntry[] {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.lastEmit = this.now()
    const list = this.list()
    this.deps.emit(list)
    return list
  }

  /** Progress reaches the shell at most once per interval (4 a second by default). */
  private scheduleEmit(): void {
    if (this.emitTimer) return
    const wait = this.emitIntervalMs - (this.now() - this.lastEmit)
    if (wait <= 0) {
      this.emitNow()
      return
    }
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emitNow()
    }, wait)
  }
}
