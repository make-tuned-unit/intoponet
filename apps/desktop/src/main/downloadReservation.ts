import { constants } from 'node:fs'
import { closeSync, fstatSync, lstatSync, openSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const MAX_FILENAME_BYTES = 180
const MAX_COLLISION_ATTEMPTS = 100
const STRIPPED_CONTROLS_AND_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/gu

function truncateUtf8(value: string, byteLimit: number): string {
  let result = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > byteLimit) break
    result += character
    bytes += size
  }
  return result
}

export function sanitizeDownloadFilename(requested: string): string {
  let safe = requested.normalize('NFKC')
    .replace(/[\\/]/gu, '_')
    .replace(STRIPPED_CONTROLS_AND_BIDI, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/gu, '')
  if (!safe || safe === '.' || safe === '..') safe = 'download'

  const dot = safe.lastIndexOf('.')
  const hasExtension = dot > 0 && dot < safe.length - 1
  const stem = hasExtension ? safe.slice(0, dot) : safe
  const extension = hasExtension ? safe.slice(dot) : ''
  const extensionBytes = Buffer.byteLength(extension, 'utf8')
  if (extensionBytes >= MAX_FILENAME_BYTES) return truncateUtf8(safe, MAX_FILENAME_BYTES)
  const truncatedStem = truncateUtf8(stem, MAX_FILENAME_BYTES - extensionBytes)
  return `${truncatedStem || 'download'}${extension}`
}

export type DownloadReservation = {
  path: string
  filename: string
  cleanupIfEmpty: () => boolean
}

export type DownloadReservationFileOps = {
  openSync: typeof openSync
  fstatSync: typeof fstatSync
  closeSync: typeof closeSync
  lstatSync: typeof lstatSync
  unlinkSync: typeof unlinkSync
}

const DEFAULT_FILE_OPS: DownloadReservationFileOps = { openSync, fstatSync, closeSync, lstatSync, unlinkSync }

function cleanupOwnedEmpty(
  candidate: string,
  identity: { device: number; inode: number },
  fileOps: DownloadReservationFileOps,
): boolean {
  try {
    const stat = fileOps.lstatSync(candidate)
    if (!stat.isFile() || stat.dev !== identity.device || stat.ino !== identity.inode || stat.size !== 0) return false
    fileOps.unlinkSync(candidate)
    return true
  } catch {
    return false
  }
}

/** Atomically reserves a unique filename without following an existing path. */
export function reserveDownloadPath(
  directory: string,
  requestedFilename: string,
  maxAttempts = MAX_COLLISION_ATTEMPTS,
  fileOps: DownloadReservationFileOps = DEFAULT_FILE_OPS,
): DownloadReservation {
  const filename = sanitizeDownloadFilename(requestedFilename)
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_COLLISION_ATTEMPTS) {
    throw new RangeError('Invalid download collision-attempt limit')
  }
  const dot = filename.lastIndexOf('.')
  const hasExtension = dot > 0 && dot < filename.length - 1
  const stem = hasExtension ? filename.slice(0, dot) : filename
  const extension = hasExtension ? filename.slice(dot) : ''

  for (let index = 0; index < maxAttempts; index += 1) {
    const suffix = index === 0 ? '' : ` (${index})`
    const suffixBytes = Buffer.byteLength(suffix, 'utf8')
    const boundedExtension = truncateUtf8(extension, Math.max(0, MAX_FILENAME_BYTES - suffixBytes - 1))
    const availableStemBytes = Math.max(1, MAX_FILENAME_BYTES - Buffer.byteLength(boundedExtension, 'utf8') - suffixBytes)
    const candidateName = `${truncateUtf8(stem, availableStemBytes) || 'd'}${suffix}${boundedExtension}`
    const candidate = join(directory, candidateName)
    let descriptor: number
    try {
      descriptor = fileOps.openSync(candidate, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    let identity: { device: number; inode: number } | null = null
    let failure: unknown = null
    try {
      const stat = fileOps.fstatSync(descriptor)
      identity = { device: stat.dev, inode: stat.ino }
    } catch (error) {
      failure = error
      // A transient stat failure can be recovered, but cleanup is still allowed
      // only if a later descriptor stat establishes the exact inode.
      try {
        const stat = fileOps.fstatSync(descriptor)
        identity = { device: stat.dev, inode: stat.ino }
      } catch {
        // Preserve the placeholder when its identity cannot be established.
      }
    }
    try {
      fileOps.closeSync(descriptor)
    } catch (error) {
      failure ??= error
      // A failing close may already have released the descriptor. Retrying
      // could close an unrelated file that reused that descriptor number.
    }
    if (failure !== null) {
      if (identity) cleanupOwnedEmpty(candidate, identity, fileOps)
      throw failure
    }

    // A successful fstat establishes this; retain the guard for injected or
    // unusual adapters rather than ever deleting by pathname alone.
    if (!identity) throw new Error('Could not identify reserved download file')

    return {
      path: candidate,
      filename: candidateName,
      cleanupIfEmpty: () => {
        return cleanupOwnedEmpty(candidate, identity!, fileOps)
      },
    }
  }
  throw new Error('No available download filename after bounded collision attempts')
}
