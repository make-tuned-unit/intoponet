import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * Writes that never leave a half-written file: the data goes to a temporary file next to the
 * target, is flushed to disk, then renamed over it (rename is atomic on one volume). A crash or a
 * full disk leaves either the old file or the new one, never a truncated mix.
 */

const queues = new Map<string, Promise<void>>()
/** Async writes not finished yet (each settles, never rejects), and the temporary files they are writing. */
const inFlight = new Set<Promise<void>>()
const temporaries = new Set<string>()
/** Set at the very end of a quit (removeUnfinishedTemporaries): an async write would not finish, so none starts or lands. */
let ended = false
const quitting = (): Error => new Error('Intoponet is quitting.')

export type AtomicWriteOptions = {
  /**
   * Run on the temporary file as soon as it exists, before any data is in it: what is set on it then (a
   * Time Machine exclusion) is on the file from the moment it takes the target's place, since the rename
   * keeps the temporary file's attributes and drops the replaced file's. A failure here does not stop the save.
   */
  prepare?: (temporary: string) => Promise<void>
}

/** Atomic write; writes to the same path run in order (the last one wins). */
export function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600, options: AtomicWriteOptions = {}): Promise<void> {
  const previous = queues.get(path) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    if (ended) throw quitting()
    const temporary = `${path}.${randomUUID()}.tmp`
    temporaries.add(temporary)
    try {
      const handle = await open(temporary, 'w', mode)
      try {
        if (options.prepare) await options.prepare(temporary).catch(() => undefined)
        await handle.writeFile(data)
        await handle.sync()
      } finally {
        await handle.close()
      }
      // Too late: what is written at the end of the quit is newer than this.
      if (ended) throw quitting()
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    } finally {
      temporaries.delete(temporary)
    }
  })
  const settled = next.catch(() => undefined)
  queues.set(path, settled)
  inFlight.add(settled)
  void settled.then(() => {
    inFlight.delete(settled)
    if (queues.get(path) === settled) queues.delete(path)
  })
  return next
}

/** Every async atomic write still on its way to disk (each settles, never rejects): quitting waits for them. */
export function atomicWritesInFlight(): Promise<void>[] {
  return [...inFlight]
}

/**
 * The very end of a quit, once it waited as long as it could: deletes the temporary files of writes
 * still unfinished, and no async write starts or lands after this (synchronous writes still can, so
 * the newest data is written last). Each unfinished write leaves the file it was replacing as it was,
 * and no stray `<file>.<id>.tmp` outlives the app. Returns how many were deleted.
 */
export function removeUnfinishedTemporaries(): number {
  ended = true
  let removed = 0
  for (const temporary of temporaries) {
    try {
      if (!existsSync(temporary)) continue
      rmSync(temporary, { force: true })
      removed += 1
    } catch {
      // Already gone.
    }
  }
  temporaries.clear()
  return removed
}

/** When this run began: a temporary file older than that belongs to a run that is over. */
const startedAt = Date.now()
/** `<file>.<uuid>.tmp`, the temporary file of an atomic write (this module's, and the news cache's). */
const TEMPORARY_NAME = /^.+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i

/**
 * At startup: deletes the temporary files a run that is over left in a folder of the profile, when it
 * stopped in the middle of a write (a crash, a force-quit, or a version before 0.1.23 quitting while a
 * late save was still being written). Only one app runs on a profile, so such a write can never finish;
 * the file it was replacing is as it was. Without this they stay for good, each holding an old copy of
 * what it was saving (history, the library) that clearing it later never reaches. Writes of this run
 * are never touched. Returns how many were deleted.
 */
export function removeLeftoverTemporaries(folder: string, before: number = startedAt): number {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!TEMPORARY_NAME.test(name)) continue
    const path = join(folder, name)
    if (temporaries.has(path)) continue
    try {
      const info = statSync(path)
      if (!info.isFile() || info.mtimeMs >= before) continue
      rmSync(path, { force: true })
      removed += 1
    } catch {
      // Already gone.
    }
  }
  return removed
}

/** Synchronous atomic write, for quit and window-close paths that cannot wait. */
export function writeFileAtomicSync(path: string, data: string | Uint8Array, mode = 0o600): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'w', mode)
    try {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
      let offset = 0
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/**
 * A saved file that is there but could not be used (damaged, or written by a newer version) is
 * moved aside as `<file>.unreadable-<time>` before the app starts that part over, so the next save
 * cannot replace it and what it held stays on disk. An empty file holds nothing and is left as it
 * is. Returns the new path, or null when nothing was moved.
 */
export function setAsideUnreadable(path: string, now: number = Date.now()): string | null {
  try {
    if (statSync(path).size === 0) return null
  } catch {
    return null
  }
  const aside = `${path}.unreadable-${now}`
  try {
    renameSync(path, aside)
    return aside
  } catch (error) {
    console.error(`Could not keep the unreadable ${path} aside:`, error)
    return null
  }
}

/**
 * Deletes the copies setAsideUnreadable kept of a file, when what they hold is being cleared (e.g.
 * Clear browsing data): the app cannot clear part of a file it could not read, so the copy goes.
 */
export function removeSetAside(path: string): void {
  const prefix = `${basename(path)}.unreadable-`
  try {
    for (const name of readdirSync(dirname(path))) if (name.startsWith(prefix)) rmSync(join(dirname(path), name), { force: true })
  } catch {
    // Nothing was kept.
  }
}

/** Wait for queued async writes to a path (e.g. before a synchronous write on quit). */
export function pendingWrite(path: string): Promise<void> {
  return queues.get(path) ?? Promise.resolve()
}
