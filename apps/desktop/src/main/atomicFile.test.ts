import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/** A rename can be held, so a write can be caught with its temporary file written but not yet in place. */
const renames = vi.hoisted(() => ({ hold: null as Promise<void> | null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (renames.hold) await renames.hold
      return real.rename(from, to)
    },
  }
})

const { atomicWritesInFlight, removeSetAside, removeUnfinishedTemporaries, setAsideUnreadable, writeFileAtomic, writeFileAtomicSync } = await import('./atomicFile')

describe('unreadable files', () => {
  it('moves a damaged file aside so a later save cannot replace it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'))
    const path = join(dir, 'state.json')
    writeFileSync(path, '{"tabs":[{"url":"https://exa')
    expect(setAsideUnreadable(path, 42)).toBe(`${path}.unreadable-42`)
    writeFileAtomicSync(path, '{"tabs":[]}')
    expect(readFileSync(`${path}.unreadable-42`, 'utf8')).toBe('{"tabs":[{"url":"https://exa')
    expect(readdirSync(dir).sort()).toEqual(['state.json', 'state.json.unreadable-42'])
  })
  it('deletes the kept copies of a file when what they hold is cleared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'))
    const path = join(dir, 'history.v1.seal')
    writeFileSync(path, 'old')
    setAsideUnreadable(path, 1)
    writeFileSync(path, 'older')
    setAsideUnreadable(path, 2)
    writeFileSync(path, 'new')
    writeFileSync(join(dir, 'other.json.unreadable-3'), 'not this one')
    removeSetAside(path)
    expect(readdirSync(dir).sort()).toEqual(['history.v1.seal', 'other.json.unreadable-3'])
  })
  it('leaves a missing or empty file alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'))
    expect(setAsideUnreadable(join(dir, 'missing.json'))).toBeNull()
    writeFileSync(join(dir, 'empty.json'), '')
    expect(setAsideUnreadable(join(dir, 'empty.json'))).toBeNull()
    expect(readdirSync(dir)).toEqual(['empty.json'])
  })
})

describe('atomic file writes', () => {
  it('writes in order, the last write wins, and leaves no temporary files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'))
    const path = join(dir, 'state.json')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(path, `{"n":${i}}`)))
    expect(JSON.parse(readFileSync(path, 'utf8')).n).toBe(19)
    writeFileAtomicSync(path, '{"n":"sync"}')
    expect(JSON.parse(readFileSync(path, 'utf8')).n).toBe('sync')
    expect(readdirSync(dir)).toEqual(['state.json'])
  })
  it('keeps the old file when a write fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'))
    const path = join(dir, 'state.json')
    await writeFileAtomic(path, 'old')
    await expect(writeFileAtomic(join(dir, 'missing', 'x.json'), 'new')).rejects.toThrow()
    expect(readFileSync(path, 'utf8')).toBe('old')
  })
  // Last in this file: it ends async writes for the module, as the end of a quit does.
  it('lists writes on their way, and the end of a quit deletes the temporary file of one still unfinished', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atomic-'))
    const path = join(dir, 'history.v1.seal')
    writeFileSync(path, 'old')
    let release = (): void => undefined
    renames.hold = new Promise<void>((resolve) => { release = resolve })
    const outcome = writeFileAtomic(path, 'new').then(() => 'written', () => 'failed')
    // The temporary file is there; the write is waiting to put it in place.
    for (let i = 0; i < 200 && !readdirSync(dir).some((name) => name.endsWith('.tmp')); i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toHaveLength(1)
    expect(atomicWritesInFlight()).toHaveLength(1)
    expect(removeUnfinishedTemporaries()).toBe(1)
    expect(readdirSync(dir)).toEqual(['history.v1.seal'])
    renames.hold = null
    release()
    expect(await outcome).toBe('failed')
    expect(readFileSync(path, 'utf8')).toBe('old')
    expect(readdirSync(dir)).toEqual(['history.v1.seal'])
    await Promise.all(atomicWritesInFlight())
    expect(atomicWritesInFlight()).toEqual([])
    // After the end of the quit no async write starts (it could not finish); the last word is a synchronous write.
    await expect(writeFileAtomic(path, 'late')).rejects.toThrow('quitting')
    expect(removeUnfinishedTemporaries()).toBe(0)
    writeFileAtomicSync(path, 'newest')
    expect(readFileSync(path, 'utf8')).toBe('newest')
    expect(readdirSync(dir)).toEqual(['history.v1.seal'])
  })
})
