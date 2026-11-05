import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadEntry } from '@intoponet/browser-api'
import { DownloadManager, type DownloadItemLike, type DownloadManagerDeps, type DownloadRecord } from './downloadManager'
import { DownloadRateLimiter } from './downloadGuards'
import { reserveDownloadPath, sanitizeDownloadFilename } from './downloadReservation'

/** A stand-in for Electron's DownloadItem that tests drive by hand. */
class FakeItem extends EventEmitter implements DownloadItemLike {
  received = 0
  paused = false
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' = 'progressing'
  savePath = ''
  resumable = false
  constructor(private readonly name: string, readonly total = 1_000, private readonly url = 'https://files.example.com/path/secret?token=1') { super() }
  getFilename(): string { return this.name }
  getURL(): string { return this.url }
  getReceivedBytes(): number { return this.received }
  getTotalBytes(): number { return this.total }
  getState(): 'progressing' | 'completed' | 'cancelled' | 'interrupted' { return this.state }
  isPaused(): boolean { return this.paused }
  canResume(): boolean { return this.resumable }
  setSavePath(path: string): void { this.savePath = path }
  pause(): void { this.paused = true; this.emit('updated', {}, 'progressing') }
  resume(): void { this.paused = false; this.emit('updated', {}, 'progressing') }
  cancel(): void { this.finish('cancelled') }
  progress(bytes: number): void { this.received = bytes; this.emit('updated', {}, 'progressing') }
  interrupt(): void { this.emit('updated', {}, 'interrupted') }
  finish(state: 'completed' | 'cancelled' | 'interrupted'): void {
    if (this.state !== 'progressing') return
    this.state = state
    if (state === 'completed') this.received = this.total
    this.emit('done', {}, state)
  }
}

let directory = ''
let now = 1_000_000
let emitted: DownloadEntry[][] = []
let persisted: DownloadRecord[][] = []

function manager(overrides: Partial<DownloadManagerDeps> = {}): { manager: DownloadManager; deps: DownloadManagerDeps } {
  const deps: DownloadManagerDeps = {
    downloadsDir: () => directory,
    reserve: (dir, name) => reserveDownloadPath(dir, name),
    sanitize: sanitizeDownloadFilename,
    emit: (list) => emitted.push(list),
    persist: (records) => persisted.push(records),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    exists: () => true,
    remove: vi.fn(),
    quarantine: vi.fn(async () => undefined),
    restart: vi.fn(),
    now: () => now,
    ...overrides,
  }
  return { manager: new DownloadManager(deps), deps }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'intoponet-downloads-'))
  now = 1_000_000
  emitted = []
  persisted = []
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

describe('DownloadManager', () => {
  it('tracks progress to completion, shows only the origin, quarantines and remembers the file', () => {
    const { manager: downloads, deps } = manager()
    const item = new FakeItem('report.pdf')
    const id = downloads.track(item, { isPrivate: false, pageKey: '1' })
    expect(item.savePath).toBe(join(directory, 'report.pdf'))
    let [entry] = downloads.list()
    expect(entry).toMatchObject({ id, filename: 'report.pdf', origin: 'https://files.example.com', state: 'progressing', live: true })
    expect(JSON.stringify(entry)).not.toContain('token')

    now += 500
    item.progress(400)
    now += 500
    item.progress(900)
    entry = downloads.list()[0]!
    expect(entry.receivedBytes).toBe(900)
    expect(entry.bytesPerSecond).toBeGreaterThan(0)

    item.finish('completed')
    entry = downloads.list()[0]!
    expect(entry).toMatchObject({ state: 'completed', exists: true, live: false, bytesPerSecond: 0 })
    expect(deps.quarantine).toHaveBeenCalledWith(join(directory, 'report.pdf'), item.getURL())
    expect(persisted.at(-1)).toHaveLength(1)
    expect(persisted.at(-1)![0]).toMatchObject({ filename: 'report.pdf', state: 'completed' })
  })

  it('pauses, resumes and cancels a live download', () => {
    const { manager: downloads } = manager()
    const item = new FakeItem('big.zip')
    const id = downloads.track(item, { isPrivate: false, pageKey: '1' })
    expect(downloads.pause(id)[0]!.state).toBe('paused')
    expect(item.paused).toBe(true)
    expect(downloads.resume(id)[0]!.state).toBe('progressing')
    expect(item.paused).toBe(false)
    downloads.cancel(id)
    expect(downloads.list()[0]).toMatchObject({ state: 'cancelled', live: false, canRetry: true })
  })

  it('throttles progress pushes to at most four a second', () => {
    const { manager: downloads } = manager({ now: () => Date.now() })
    const item = new FakeItem('stream.bin', 100_000)
    downloads.track(item, { isPrivate: false, pageKey: '1' })
    emitted = []
    for (let step = 1; step <= 100; step += 1) {
      vi.advanceTimersByTime(10)
      item.progress(step * 100)
    }
    vi.advanceTimersByTime(300)
    // 1 second of updates every 10 ms → at most 5 pushes (4/s plus the trailing one).
    expect(emitted.length).toBeLessThanOrEqual(5)
    expect(emitted.at(-1)![0]!.receivedBytes).toBe(10_000)
  })

  it('retries a failed download: resumes when possible, else starts again', () => {
    const { manager: downloads, deps } = manager()
    const item = new FakeItem('a.iso')
    const id = downloads.track(item, { isPrivate: true, pageKey: '1' })
    item.interrupt()
    expect(downloads.list()[0]!.state).toBe('interrupted')
    item.resumable = true
    expect(downloads.retry(id)[0]!.state).toBe('progressing')
    item.finish('interrupted')
    item.resumable = false
    downloads.retry(id)
    expect(deps.restart).toHaveBeenCalledWith(item.getURL(), true)
    expect(downloads.list()).toHaveLength(0)
  })

  it('opens and shows finished files, and says when one is gone', async () => {
    let exists = true
    const { manager: downloads, deps } = manager({ exists: () => exists })
    const item = new FakeItem('notes.txt')
    const id = downloads.track(item, { isPrivate: false, pageKey: '1' })
    await expect(downloads.open(id)).rejects.toThrow(/finished/)
    item.finish('completed')
    await downloads.open(id)
    expect(deps.openPath).toHaveBeenCalledWith(join(directory, 'notes.txt'))
    downloads.show(id)
    expect(deps.showItemInFolder).toHaveBeenCalledWith(join(directory, 'notes.txt'))
    exists = false
    await expect(downloads.open(id)).rejects.toThrow(/no longer in Downloads/)
    expect(downloads.list()[0]!.exists).toBe(false)
  })

  it('never remembers private-tab downloads, and forgets them when private browsing ends', () => {
    const { manager: downloads } = manager()
    const item = new FakeItem('private.pdf')
    downloads.track(item, { isPrivate: true, pageKey: '1' })
    item.finish('completed')
    expect(persisted.at(-1)).toEqual([])
    expect(downloads.list()).toHaveLength(1)
    downloads.forgetPrivate()
    expect(downloads.list()).toHaveLength(0)
  })

  it('removes entries and clears finished ones without touching active downloads', () => {
    const { manager: downloads } = manager()
    const done = new FakeItem('done.txt')
    const active = new FakeItem('active.txt')
    const doneId = downloads.track(done, { isPrivate: false, pageKey: '1' })
    downloads.track(active, { isPrivate: false, pageKey: '2' })
    done.finish('completed')
    downloads.clearFinished()
    expect(downloads.list().map((entry) => entry.filename)).toEqual(['active.txt'])
    expect(() => downloads.remove(doneId)).toThrow()
    const activeId = downloads.list()[0]!.id
    downloads.remove(activeId)
    expect(active.state).toBe('cancelled')
    expect(downloads.list()).toHaveLength(0)
  })

  it('caps the remembered list and restores it on the next launch', () => {
    const { manager: downloads } = manager({ maxRecords: 3 })
    for (let index = 0; index < 5; index += 1) {
      const item = new FakeItem(`file-${index}.txt`)
      downloads.track(item, { isPrivate: false, pageKey: null })
      item.finish('completed')
    }
    const saved = persisted.at(-1)!
    expect(saved.map((record) => record.filename)).toEqual(['file-4.txt', 'file-3.txt', 'file-2.txt'])
    const { manager: next } = manager({ exists: (path) => !path.endsWith('file-3.txt') })
    next.restore(JSON.parse(JSON.stringify(saved)))
    next.restore('garbage')
    expect(next.list().map((entry) => [entry.filename, entry.exists, entry.live])).toEqual([
      ['file-4.txt', true, false], ['file-3.txt', false, false], ['file-2.txt', true, false],
    ])
  })

  it('asks before keeping a dangerous file type; Discard cancels it', () => {
    const { manager: downloads } = manager()
    const item = new FakeItem('install.command')
    const id = downloads.track(item, { isPrivate: false, pageKey: '1' })
    expect(item.paused).toBe(true)
    expect(downloads.list()[0]).toMatchObject({ attention: 'dangerous-type', state: 'paused' })
    // Resume is refused until the person answers.
    downloads.resume(id)
    expect(item.paused).toBe(true)
    downloads.discard(id)
    expect(item.state).toBe('cancelled')
    expect(downloads.list()).toHaveLength(0)
  })

  it('Keep resumes a dangerous file; one that finished while waiting is deleted on Discard', () => {
    const { manager: downloads, deps } = manager()
    const kept = new FakeItem('tool.sh')
    const keptId = downloads.track(kept, { isPrivate: false, pageKey: '1' })
    downloads.keep(keptId)
    expect(kept.paused).toBe(false)
    expect(downloads.list()[0]!.attention).toBeNull()

    const raced = new FakeItem('evil.pkg')
    const racedId = downloads.track(raced, { isPrivate: false, pageKey: '1' })
    raced.finish('completed')
    expect(downloads.list()[0]).toMatchObject({ state: 'completed', attention: 'dangerous-type' })
    downloads.discard(racedId)
    expect(deps.remove).toHaveBeenCalledWith(join(directory, 'evil.pkg'))
  })

  it('holds a page’s fourth automatic download and asks; Allow resumes, Block cancels', () => {
    const limiter = new DownloadRateLimiter({ maxAutomatic: 3, windowMs: 10_000 })
    const { manager: downloads } = manager({ limiter })
    const items = Array.from({ length: 5 }, (_, index) => new FakeItem(`auto-${index}.txt`))
    for (const item of items.slice(0, 4)) downloads.track(item, { isPrivate: false, pageKey: 'page' })
    expect(items.slice(0, 3).every((item) => !item.paused)).toBe(true)
    expect(items[3]!.paused).toBe(true)
    const held = downloads.list().find((entry) => entry.filename === 'auto-3.txt')!
    expect(held.attention).toBe('multiple-downloads')
    downloads.allowMultiple(held.id)
    expect(items[3]!.paused).toBe(false)

    const other = new DownloadRateLimiter({ maxAutomatic: 1 })
    const { manager: blocking } = manager({ limiter: other })
    const first = new FakeItem('one.txt')
    const second = new FakeItem('two.txt')
    const third = new FakeItem('three.txt')
    blocking.track(first, { isPrivate: false, pageKey: 'p' })
    const secondId = blocking.track(second, { isPrivate: false, pageKey: 'p' })
    blocking.blockMultiple(secondId)
    expect(second.state).toBe('cancelled')
    blocking.track(third, { isPrivate: false, pageKey: 'p' })
    expect(third.state).toBe('cancelled')
    expect(blocking.list()[0]!.error).toMatch(/Blocked/)
  })

  it('a click in the page lets its next download through', () => {
    const limiter = new DownloadRateLimiter({ maxAutomatic: 0 })
    const { manager: downloads } = manager({ limiter })
    downloads.gesture('page')
    const item = new FakeItem('clicked.txt')
    downloads.track(item, { isPrivate: false, pageKey: 'page' })
    expect(item.paused).toBe(false)
  })

  it('reports a download it could not reserve a path for as failed', () => {
    const { manager: downloads } = manager({ reserve: () => { throw new Error('disk full') } })
    const item = new FakeItem('x.txt')
    downloads.track(item, { isPrivate: false, pageKey: '1' })
    expect(item.state).toBe('cancelled')
    expect(downloads.list()[0]).toMatchObject({ state: 'interrupted', error: 'The file could not be saved in Downloads.' })
  })
})

describe('Files the app saves itself', () => {
  it('lists an exported PDF as a finished download, kept for normal tabs only', () => {
    const { manager: downloads } = manager()
    downloads.recordSaved({ filename: 'Page – Site – 2026-11-05.pdf', url: 'https://example.com/a', path: `${directory}/Page.pdf`, bytes: 1234, isPrivate: false })
    downloads.recordSaved({ filename: 'Saved page 2026-11-05.pdf', url: 'https://secret.example/', path: `${directory}/Saved.pdf`, bytes: 99, isPrivate: true })
    const list = downloads.list()
    expect(list[0]).toMatchObject({ filename: 'Saved page 2026-11-05.pdf', state: 'completed', exists: true, isPrivate: true })
    expect(list[1]).toMatchObject({ filename: 'Page – Site – 2026-11-05.pdf', state: 'completed', totalBytes: 1234 })
    vi.runAllTimers()
    const kept = persisted.at(-1) ?? []
    expect(kept.map((record) => record.filename)).toEqual(['Page – Site – 2026-11-05.pdf'])
  })
})
