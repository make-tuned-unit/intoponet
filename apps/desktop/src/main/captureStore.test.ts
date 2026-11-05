import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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

describe('capture index safety', () => {
  // A real PNG header (IHDR 640×480) so a rebuilt record gets its size.
  const realPng = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from([0, 0, 2, 128, 0, 0, 1, 224]), Buffer.from('rest')])

  it('keeps a corrupt index aside and rebuilds it from the files in the library', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    const image = await lib.add(input({ media: realPng }))
    await lib.add(input({ kind: 'video', title: 'Clip', groupId: null }))
    await writeFile(join(privateDir, 'index.json'), '{"version":2,"records":[{"trunc')
    const fresh = library()
    const records = await fresh.list()
    expect(records.map((item) => [item.kind, item.title, item.fileName]).sort()).toEqual([
      ['image', 'Aurora – Wikipedia', image.fileName],
      ['video', 'Clip', 'Clip 2026-10-26 at 11.42.05.webm'],
    ])
    const rebuiltImage = records.find((item) => item.kind === 'image')!
    expect(rebuiltImage).toMatchObject({ width: 640, height: 480, createdAt: at.toISOString(), byteLength: realPng.length })
    // The damaged index is kept for inspection, and a fresh one written.
    const kept = (await readdir(privateDir)).filter((name) => name.startsWith('index.json.corrupt-'))
    expect(kept).toHaveLength(1)
    expect(await readFile(join(privateDir, kept[0]!), 'utf8')).toContain('trunc')
    expect(JSON.parse(await readFile(join(privateDir, 'index.json'), 'utf8')).records).toHaveLength(2)
    // Without a thumbnail the image itself stands in; the group comes back with the next sync.
    expect(await fresh.readThumb(rebuiltImage.id)).toEqual(realPng)
    await fresh.syncGroups(groups)
    expect((await fresh.list()).find((item) => item.id === rebuiltImage.id)?.groupId).toBe('research')
  })

  it('does not treat an unreadable index as empty, and never saves over it', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    await lib.add(input())
    const before = await readFile(join(privateDir, 'index.json'))
    // Make the index unreadable (not missing, not corrupt): EISDIR stands in for EACCES/EMFILE.
    await rename(join(privateDir, 'index.json'), join(privateDir, 'saved.json'))
    await mkdir(join(privateDir, 'index.json'))
    const fresh = library()
    await expect(fresh.list()).rejects.toThrow(/could not be read/)
    await expect(fresh.add(input())).rejects.toThrow(/could not be read/)
    // Once readable again, the next call succeeds with everything intact.
    await rm(join(privateDir, 'index.json'), { recursive: true })
    await rename(join(privateDir, 'saved.json'), join(privateDir, 'index.json'))
    expect(await readFile(join(privateDir, 'index.json'))).toEqual(before)
    expect(await fresh.list()).toHaveLength(1)
  })

  it('puts back folders left hidden mid-rename by a quit', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    const record = await lib.add(input())
    await rename(join(root, 'Research'), join(root, '.renaming-0b7c5a4e-1d2f-4c3b-9a8e-7f6d5c4b3a21-Research'))
    await mkdir(join(root, '.renaming-1b7c5a4e-1d2f-4c3b-9a8e-7f6d5c4b3a21'))
    const records = await library().list()
    expect((await readdir(root)).sort()).toEqual(['Recovered captures', 'Research'])
    expect(records.map((item) => item.id)).toEqual([record.id])
  })

  it('puts folders back when renaming them fails part-way', async () => {
    const lib = library()
    await lib.syncGroups(groups)
    await lib.add(input())
    // A file where the renamed folder should go makes the merge fail.
    await writeFile(join(root, 'Studies'), 'in the way')
    await expect(lib.syncGroups([{ id: 'research', label: 'Studies' }, { id: 'banking', label: 'Banking' }])).rejects.toThrow()
    expect((await readdir(root)).filter((name) => name.startsWith('.'))).toEqual([])
    expect(await readdir(join(root, 'Research'))).toHaveLength(1)
  })
})

