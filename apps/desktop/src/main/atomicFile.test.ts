import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic, writeFileAtomicSync } from './atomicFile'

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
