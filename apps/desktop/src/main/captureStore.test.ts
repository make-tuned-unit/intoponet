import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CaptureLibrary, captureFileName, folderNamesFor, safeSegment, UNSORTED_FOLDER } from './captureStore'

const png = Buffer.from('89504e470d0a1a0a-fake-png-body')
const thumb = Buffer.from('fake-jpeg-thumb')
const at = new Date(2026, 9, 26, 11, 42, 5)
const input = (overrides = {}) => ({
  kind: 'image' as const,
  title: 'Aurora – Wikipedia',
  sourceUrl: 'https://en.wikipedia.org/wiki/Aurora',
  width: 1200,
  height: 800,
  groupId: 'research' as string | null,
  media: png,
  thumb,
  ...overrides,
})

let base = ''
let privateDir = ''
let root = ''
const groups = [{ id: 'research', label: 'Research' }, { id: 'banking', label: 'Banking' }]
const library = () => new CaptureLibrary(privateDir, root, { now: () => at })

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'capture-library-'))
  privateDir = join(base, 'private')
  root = join(base, 'Pictures', 'Intoponet')
})
afterEach(async () => { await rm(base, { recursive: true, force: true }) })

describe('Finder naming', () => {
  it('makes safe, readable names', () => {
    expect(safeSegment('Bank: statement / Oct?', 'x')).toBe('Bank statement Oct')
    expect(safeSegment('...', 'Group')).toBe('Group')
    expect(captureFileName('Aurora – Wikipedia', at, 'png')).toBe('Aurora – Wikipedia 2026-10-26 at 11.42.05.png')
    expect(folderNamesFor([{ id: 'a', label: 'Work' }, { id: 'b', label: 'work' }, { id: 'c', label: 'Unsorted' }]))
      .toEqual({ a: 'Work', b: 'work 2', c: 'Unsorted 2' })
  })
})

describe('capture library', () => {
  it('saves captures into their group folder and keeps thumbnails private', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    const record = await lib.add(input())
    expect(record.fileName).toBe('Aurora – Wikipedia 2026-10-26 at 11.42.05.png')
    expect(await readdir(join(root, 'Research'))).toEqual([record.fileName])
    expect((await lib.filePath(record.id)).path).toBe(join(root, 'Research', record.fileName!))
    expect(await lib.readThumb(record.id)).toEqual(thumb)
    expect(existsSync(join(root, 'thumbs'))).toBe(false)
    const second = await lib.add(input())
    expect(second.fileName).toBe('Aurora – Wikipedia 2026-10-26 at 11.42.05 (2).png')
  })

  it('files ungrouped and unknown-group captures under Unsorted', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    await lib.add(input({ groupId: null }))
    expect((await readdir(join(root, UNSORTED_FOLDER))).length).toBe(1)
  })

  it('moves files when a capture changes group or title', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    const record = await lib.add(input())
    const moved = await lib.update(record.id, { groupId: 'banking', title: 'Statement' })
    expect(moved.fileName).toBe('Statement 2026-10-26 at 11.42.05.png')
    expect(await readdir(join(root, 'Research'))).toEqual([])
    expect(await readdir(join(root, 'Banking'))).toEqual([moved.fileName])
  })

  it('renames folders with their groups and empties deleted groups into Unsorted', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    const record = await lib.add(input())
    await lib.syncGroups([{ id: 'research', label: 'Demo assets' }, { id: 'banking', label: 'Banking' }])
    expect(existsSync(join(root, 'Research'))).toBe(false)
    expect(await readdir(join(root, 'Demo assets'))).toEqual([record.fileName])
    expect((await lib.filePath(record.id)).path).toContain(join('Demo assets', record.fileName!))
    await lib.syncGroups([{ id: 'banking', label: 'Banking' }])
    const [after] = await lib.list()
    expect(after?.groupId).toBeNull()
    expect(await readdir(join(root, UNSORTED_FOLDER))).toEqual([record.fileName])
  })

  it('swaps two group names without collisions', async () => {
    const lib = library()
    await lib.syncGroups([{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }])
    const a = await lib.add(input({ groupId: 'a', title: 'A' }))
    const b = await lib.add(input({ groupId: 'b', title: 'B' }))
    await lib.syncGroups([{ id: 'a', label: 'Two' }, { id: 'b', label: 'One' }])
    expect(await readdir(join(root, 'Two'))).toEqual([a.fileName])
    expect(await readdir(join(root, 'One'))).toEqual([b.fileName])
  })

  it('follows files renamed or moved in Finder, and forgets deleted ones', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    const kept = await lib.add(input({ title: 'Kept' }))
    const gone = await lib.add(input({ title: 'Gone' }))
    await mkdir(join(root, 'Banking'), { recursive: true })
    await rename(join(root, 'Research', kept.fileName!), join(root, 'Banking', 'For the demo.png'))
    await rm(join(root, 'Research', gone.fileName!))
    const fresh = library()
    const records = await fresh.list()
    expect(records.map((item) => item.id)).toEqual([kept.id])
    expect(records[0]).toMatchObject({ fileName: 'For the demo.png', groupId: 'banking' })
  })

  it('persists the index across restarts', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    const record = await lib.add(input({ kind: 'video', durationMs: 4200 }))
    expect((await library().list())[0]).toMatchObject({ id: record.id, kind: 'video', durationMs: 4200 })
  })

  it('removes to the trash hook and removes everything it tracks', async () => {
    const trashed: string[] = []
    const lib = new CaptureLibrary(privateDir, root, { now: () => at, trash: async (path) => { trashed.push(path); await rm(path) } })
    await lib.syncGroups(groups)
    const a = await lib.add(input())
    await writeFile(join(root, 'Research', 'user-file.txt'), 'not ours')
    await lib.remove(a.id)
    expect(trashed).toHaveLength(1)
    await lib.add(input())
    await lib.removeAll()
    expect(await lib.list()).toEqual([])
    expect(await readdir(join(root, 'Research'))).toEqual(['user-file.txt'])
  })

  it('rejects invalid ids', async () => {
    await expect(library().filePath('../index.json')).rejects.toThrow(/Invalid capture id/)
  })
})
