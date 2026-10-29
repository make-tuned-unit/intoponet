import { closeSync as nativeCloseSync, fstatSync as nativeFstatSync, lstatSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reserveDownloadPath, sanitizeDownloadFilename, type DownloadReservationFileOps } from './downloadReservation'

const temporaryDirectories: string[] = []

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'intoponet-download-reservation-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('download path reservation', () => {
  it('sanitizes separators, controls, bidi controls, dot names, and long UTF-8 names', () => {
    expect(sanitizeDownloadFilename('../../folder\\name\u202E.txt')).toBe('_.._folder_name.txt')
    expect(sanitizeDownloadFilename('\u0000\u202e')).toBe('download')
    expect(Buffer.byteLength(sanitizeDownloadFilename(`${'é'.repeat(200)}.txt`), 'utf8')).toBeLessThanOrEqual(180)
    expect(sanitizeDownloadFilename('.')).toBe('download')
  })

  it('atomically reserves distinct names for concurrent same-name downloads', async () => {
    const directory = makeDirectory()
    const reservations = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => reserveDownloadPath(directory, 'report.pdf'))))
    expect(new Set(reservations.map(({ filename }) => filename)).size).toBe(8)
    for (const { path } of reservations) expect(readFileSync(path)).toHaveLength(0)
  })

  it('does not overwrite existing files or follow a dangling symlink', () => {
    const directory = makeDirectory()
    writeFileSync(join(directory, 'report.txt'), 'keep')
    symlinkSync(join(directory, 'missing-target'), join(directory, 'linked.txt'))
    expect(reserveDownloadPath(directory, 'report.txt').filename).toBe('report (1).txt')
    expect(reserveDownloadPath(directory, 'linked.txt').filename).toBe('linked (1).txt')
    expect(readFileSync(join(directory, 'report.txt'), 'utf8')).toBe('keep')
  })

  it('cleans up only its own empty reservation', () => {
    const directory = makeDirectory()
    const reservation = reserveDownloadPath(directory, 'empty.bin')
    expect(reservation.cleanupIfEmpty()).toBe(true)

    const partial = reserveDownloadPath(directory, 'partial.bin')
    writeFileSync(partial.path, 'partial content')
    expect(partial.cleanupIfEmpty()).toBe(false)
    expect(readFileSync(partial.path, 'utf8')).toBe('partial content')

    const replaced = reserveDownloadPath(directory, 'replaced.bin')
    renameSync(replaced.path, join(directory, 'original-inode.bin'))
    writeFileSync(replaced.path, '')
    expect(replaced.cleanupIfEmpty()).toBe(false)
    expect(readFileSync(replaced.path)).toHaveLength(0)
  })

  it('stops after the bounded number of collisions', () => {
    const directory = makeDirectory()
    for (const name of ['file.txt', 'file (1).txt', 'file (2).txt']) writeFileSync(join(directory, name), 'occupied')
    expect(() => reserveDownloadPath(directory, 'file.txt', 3)).toThrow(/bounded collision/)
  })

  it('removes an empty placeholder after a transient fstat failure when retry establishes identity', () => {
    const directory = makeDirectory()
    const fstatSync = vi.fn((descriptor: number) => nativeFstatSync(descriptor))
    fstatSync.mockImplementationOnce(() => { throw new Error('injected fstat failure') })
    const fileOps: DownloadReservationFileOps = { openSync, fstatSync: fstatSync as unknown as typeof nativeFstatSync, closeSync: nativeCloseSync, lstatSync, unlinkSync }
    expect(() => reserveDownloadPath(directory, 'retry-stat.bin', 100, fileOps)).toThrow('injected fstat failure')
    expect(fstatSync).toHaveBeenCalledTimes(2)
    expect(() => readFileSync(join(directory, 'retry-stat.bin'))).toThrow()
  })

  it('preserves the placeholder if repeated fstat failures leave ownership unknown', () => {
    const directory = makeDirectory()
    const fstatSync = vi.fn(() => { throw new Error('injected fstat failure') })
    const fileOps: DownloadReservationFileOps = { openSync, fstatSync: fstatSync as unknown as typeof nativeFstatSync, closeSync: nativeCloseSync, lstatSync, unlinkSync }
    expect(() => reserveDownloadPath(directory, 'unknown-stat.bin', 100, fileOps)).toThrow('injected fstat failure')
    expect(fstatSync).toHaveBeenCalledTimes(2)
    expect(readFileSync(join(directory, 'unknown-stat.bin'))).toHaveLength(0)
  })

  it('removes an owned empty reservation without retrying a close that may have released the descriptor', () => {
    const directory = makeDirectory()
    const closeSync = vi.fn((descriptor: number) => nativeCloseSync(descriptor))
    closeSync.mockImplementationOnce((descriptor) => { nativeCloseSync(descriptor); throw new Error('injected close failure') })
    const fileOps: DownloadReservationFileOps = { openSync, fstatSync: nativeFstatSync, closeSync: closeSync as unknown as typeof nativeCloseSync, lstatSync, unlinkSync }
    expect(() => reserveDownloadPath(directory, 'retry-close.bin', 100, fileOps)).toThrow('injected close failure')
    expect(closeSync).toHaveBeenCalledTimes(1)
    expect(() => readFileSync(join(directory, 'retry-close.bin'))).toThrow()
  })
})
