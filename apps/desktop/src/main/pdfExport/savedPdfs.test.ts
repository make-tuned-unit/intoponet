import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SavedPdfList } from './savedPdfs'

const entry = (path: string) => ({ path, filename: path.split('/').pop()!, title: 'A page', url: 'https://example.org/a', pages: 2, bytes: 1000, mode: 'formatted' as const })

describe('saved PDF list', () => {
  it('lists newest first, survives a restart, forgets and drops missing files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'saved-pdfs-'))
    const file = join(dir, 'saved-pdfs.json')
    const write = async (path: string, data: string) => writeFileSync(path, data)
    const files = new Set(['/x/one.pdf', '/x/two.pdf'])
    const list = new SavedPdfList(file, write, (path) => files.has(path))
    const one = await list.add(entry('/x/one.pdf'), new Date('2026-11-01'))
    await list.add(entry('/x/two.pdf'), new Date('2026-11-02'))
    await list.add(entry('/x/two.pdf'), new Date('2026-11-03'))
    expect((await list.list()).map((item) => item.path)).toEqual(['/x/two.pdf', '/x/one.pdf'])
    const again = new SavedPdfList(file, write, (path) => files.has(path))
    expect((await again.list()).length).toBe(2)
    await again.forget(one.id)
    expect((await again.list()).map((item) => item.path)).toEqual(['/x/two.pdf'])
    files.delete('/x/two.pdf')
    expect(await again.list()).toEqual([])
  })
  it('ignores a damaged file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'saved-pdfs-'))
    writeFileSync(join(dir, 'bad.json'), '[{"path":"relative.pdf"}, 3]')
    return expect(new SavedPdfList(join(dir, 'bad.json'), async () => undefined).list()).resolves.toEqual([])
  })
})
