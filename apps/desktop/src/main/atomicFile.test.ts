import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeSetAside, setAsideUnreadable, writeFileAtomic, writeFileAtomicSync } from './atomicFile'

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
})
