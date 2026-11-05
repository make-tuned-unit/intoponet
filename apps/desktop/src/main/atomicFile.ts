import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'

/**
 * Writes that never leave a half-written file: the data goes to a temporary file next to the
 * target, is flushed to disk, then renamed over it (rename is atomic on one volume). A crash or a
 * full disk leaves either the old file or the new one, never a truncated mix.
 */

const queues = new Map<string, Promise<void>>()

/** Atomic write; writes to the same path run in order (the last one wins). */
export function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600): Promise<void> {
  const previous = queues.get(path) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'w', mode)
      try {
        await handle.writeFile(data)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  })
  const settled = next.catch(() => undefined)
  queues.set(path, settled)
  void settled.then(() => { if (queues.get(path) === settled) queues.delete(path) })
  return next
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

/** Wait for queued async writes to a path (e.g. before a synchronous write on quit). */
export function pendingWrite(path: string): Promise<void> {
  return queues.get(path) ?? Promise.resolve()
}
