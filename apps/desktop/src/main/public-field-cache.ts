import { closeSync, fstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseFieldSnapshot, type FieldSnapshot } from '@intoponet/field-snapshot'

export const MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES = 5 * 1024 * 1024

type RenameFile = (from: string, to: string) => void

/** Read at most the cache limit plus one byte, even if the file grows after stat. */
export function readLocalPublicFieldCache(filePath: string): FieldSnapshot | null {
  let descriptor: number
  try {
    descriptor = openSync(filePath, 'r')
  } catch {
    return null
  }
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES) return null
    const bytes = Buffer.alloc(MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES + 1)
    let total = 0
    while (total < bytes.length) {
      const count = readSync(descriptor, bytes, total, bytes.length - total, total)
      if (count === 0) break
      total += count
    }
    if (total === 0 || total > MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES) return null
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total))
    return parseFieldSnapshot(text)
  } catch {
    return null
  } finally {
    closeSync(descriptor)
  }
}

/** Atomically replace the local public cache; failed writes leave the prior file untouched. */
export function writeLocalPublicFieldCache(filePath: string, snapshot: FieldSnapshot, renameFile: RenameFile = renameSync): void {
  const text = JSON.stringify(snapshot)
  if (Buffer.byteLength(text, 'utf8') > MAX_LOCAL_PUBLIC_FIELD_CACHE_BYTES) {
    throw new Error('Local public-field snapshot exceeds the cache byte limit.')
  }
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameFile(temporary, filePath)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* The write may have failed before creating the temporary file. */ }
    const detail = error instanceof Error ? error.message : 'filesystem operation failed'
    throw new Error(`Could not cache the local public-field snapshot: ${detail}`)
  }
}
