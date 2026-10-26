import { createDecipheriv, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { isCaptureId, parseCaptureRecord, type CaptureRecord } from '@intoponet/browser-api'

/**
 * Capture library on disk, organized for Finder:
 *
 *   <root>/<Group name>/<Title> 2026-10-26 at 11.42.05.png
 *
 * Files are ordinary PNG/WebM so they can be dropped into editors and
 * demos (protected by FileVault like the rest of the home folder). The
 * index, folder mapping and thumbnails live in the app's private data.
 * Files are tracked by inode, so renames and moves made in Finder are
 * followed rather than lost.
 */

export const UNSORTED_FOLDER = 'Unsorted'

type StoredCapture = CaptureRecord & { path: string; ino?: number }
type IndexFile = { version: 2; folders: Record<string, string>; records: StoredCapture[] }

export type NewCapture = Omit<CaptureRecord, 'id' | 'createdAt' | 'byteLength' | 'fileName'> & {
  media: Buffer
  thumb: Buffer
  /** Preserve an original timestamp (migration); defaults to now. */
  createdAt?: Date
}

export type GroupLabel = { id: string; label: string }

/** A Finder-safe single path segment. */
export function safeSegment(value: string, fallback: string, max = 80): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()
  return cleaned || fallback
}

const pad = (value: number) => String(value).padStart(2, '0')

/** "Aurora – Wikipedia 2026-10-26 at 11.42.05.png" (local time, like macOS). */
export function captureFileName(title: string, createdAt: Date, extension: 'png' | 'webm'): string {
  const date = `${createdAt.getFullYear()}-${pad(createdAt.getMonth() + 1)}-${pad(createdAt.getDate())}`
  const time = `${pad(createdAt.getHours())}.${pad(createdAt.getMinutes())}.${pad(createdAt.getSeconds())}`
  return `${safeSegment(title, 'Capture', 90)} ${date} at ${time}.${extension}`
}

/** Distinct folder names for groups; Unsorted is reserved. */
export function folderNamesFor(groups: GroupLabel[]): Record<string, string> {
  const used = new Set([UNSORTED_FOLDER.toLowerCase()])
  const result: Record<string, string> = {}
  for (const group of groups) {
    const base = safeSegment(group.label, 'Group')
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} ${n}`
    used.add(name.toLowerCase())
    result[group.id] = name
  }
  return result
}

async function uniquePath(folder: string, fileName: string, ignore?: string): Promise<string> {
  const extension = extname(fileName)
  const stem = fileName.slice(0, fileName.length - extension.length)
  let candidate = join(folder, fileName)
  for (let n = 2; existsSync(candidate) && candidate !== ignore; n += 1) candidate = join(folder, `${stem} (${n})${extension}`)
  return candidate
}

export class CaptureLibrary {
  private index: IndexFile | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly privateDir: string,
    readonly root: string,
    private readonly options: {
      now?: () => Date
      /** Move a file to the Trash instead of deleting it outright. */
      trash?: (path: string) => Promise<void>
    } = {},
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<IndexFile> {
    if (this.index) return this.index
    try {
      const parsed = JSON.parse(await readFile(join(this.privateDir, 'index.json'), 'utf8')) as Partial<IndexFile>
      const folders: Record<string, string> = {}
      for (const [id, name] of Object.entries(parsed.folders ?? {})) {
        if (typeof name === 'string') folders[id] = safeSegment(name, 'Group')
      }
      const records = (Array.isArray(parsed.records) ? parsed.records : []).flatMap((value): StoredCapture[] => {
        const record = parseCaptureRecord(value)
        const path = (value as { path?: unknown }).path
        const ino = (value as { ino?: unknown }).ino
        if (!record || typeof path !== 'string' || path.startsWith('..') || path.includes(`..${sep}`)) return []
        return [{ ...record, path, ...(typeof ino === 'number' ? { ino } : {}) }]
      })
      this.index = { version: 2, folders, records }
    } catch {
      this.index = { version: 2, folders: {}, records: [] }
    }
    return this.index
  }

  private async save(): Promise<void> {
    const index = await this.load()
    await mkdir(this.privateDir, { recursive: true, mode: 0o700 })
    const temporary = join(this.privateDir, `index.${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(index), { mode: 0o600 })
    await rename(temporary, join(this.privateDir, 'index.json'))
  }

  private folderOf(index: IndexFile, groupId: string | null): string {
    return (groupId && index.folders[groupId]) || UNSORTED_FOLDER
  }

  private absolute(record: StoredCapture): string {
    return join(this.root, record.path)
  }

  private thumbPath(id: string): string {
    return join(this.privateDir, 'thumbs', `${id}.jpg`)
  }

  private publicRecord({ path, ino: _ino, ...record }: StoredCapture): CaptureRecord {
    return { ...record, fileName: basename(path) }
  }

  /** Follow files renamed or moved in Finder; forget ones that were deleted. */
  private async reconcile(index: IndexFile): Promise<boolean> {
    const missing = index.records.filter((record) => !existsSync(this.absolute(record)))
    if (missing.length === 0) return false
    const byIno = new Map<number, string>()
    const folders = await readdir(this.root, { withFileTypes: true }).catch(() => [])
    for (const folder of folders) {
      if (!folder.isDirectory()) continue
      const files = await readdir(join(this.root, folder.name), { withFileTypes: true }).catch(() => [])
      for (const file of files) {
        if (!file.isFile()) continue
        const path = join(this.root, folder.name, file.name)
        const info = await stat(path).catch(() => null)
        if (info) byIno.set(info.ino, path)
      }
    }
    const folderToGroup = new Map(Object.entries(index.folders).map(([id, name]) => [name, id]))
    for (const record of missing) {
      const found = record.ino !== undefined ? byIno.get(record.ino) : undefined
      if (found) {
        record.path = relative(this.root, found)
        const folder = basename(dirname(found))
        record.groupId = folderToGroup.get(folder) ?? (folder === UNSORTED_FOLDER ? null : record.groupId)
      } else {
        index.records = index.records.filter((item) => item !== record)
        await rm(this.thumbPath(record.id), { force: true })
      }
    }
    return true
  }

  list(): Promise<CaptureRecord[]> {
    return this.exclusive(async () => {
      const index = await this.load()
      if (await this.reconcile(index)) await this.save()
      return index.records.map((record) => this.publicRecord(record))
    })
  }

  add(input: NewCapture): Promise<CaptureRecord> {
    return this.exclusive(async () => {
      const index = await this.load()
      const { media, thumb, createdAt: originalDate, ...meta } = input
      const createdAt = originalDate ?? this.now()
      const folder = join(this.root, this.folderOf(index, meta.groupId))
      await mkdir(folder, { recursive: true })
      const path = await uniquePath(folder, captureFileName(meta.title, createdAt, meta.kind === 'image' ? 'png' : 'webm'))
      const id = randomUUID()
      const record = parseCaptureRecord({ ...meta, id, createdAt: createdAt.toISOString(), byteLength: media.length })
      if (!record) throw new Error('Capture metadata is invalid.')
      await writeFile(path, media)
      await mkdir(dirname(this.thumbPath(id)), { recursive: true, mode: 0o700 })
      await writeFile(this.thumbPath(id), thumb, { mode: 0o600 })
      const stored: StoredCapture = { ...record, path: relative(this.root, path), ino: (await stat(path)).ino }
      index.records.unshift(stored)
      await this.save()
      return this.publicRecord(stored)
    })
  }

  private async find(id: string): Promise<StoredCapture> {
    if (!isCaptureId(id)) throw new Error('Invalid capture id.')
    const record = (await this.load()).records.find((item) => item.id === id)
    if (!record) throw new Error('Capture not found.')
    return record
  }

  /** Absolute path of a capture's file (for serving, Finder and drag-out). */
  async filePath(id: string): Promise<{ record: CaptureRecord; path: string }> {
    await this.list()
    const record = await this.find(id)
    const path = this.absolute(record)
    if (!existsSync(path)) throw new Error('This capture was moved or deleted in Finder.')
    return { record: this.publicRecord(record), path }
  }

  async readThumb(id: string): Promise<Buffer> {
    await this.find(id)
    return readFile(this.thumbPath(id))
  }

  /** Create (if needed) and return a group's folder. */
  folderPath(groupId: string | null): Promise<string> {
    return this.exclusive(async () => {
      const folder = join(this.root, this.folderOf(await this.load(), groupId))
      await mkdir(folder, { recursive: true })
      return folder
    })
  }

  private async moveTo(index: IndexFile, record: StoredCapture, groupId: string | null, title = record.title): Promise<void> {
    const from = this.absolute(record)
    const folder = join(this.root, this.folderOf(index, groupId))
    await mkdir(folder, { recursive: true })
    const sameName = title === record.title
    const fileName = sameName ? basename(from) : captureFileName(title, new Date(record.createdAt), record.kind === 'image' ? 'png' : 'webm')
    const to = await uniquePath(folder, fileName, from)
    if (to !== from && existsSync(from)) await rename(from, to)
    record.path = relative(this.root, to)
    record.groupId = groupId
    record.title = title
  }

  update(id: string, patch: { groupId?: string | null; title?: string }): Promise<CaptureRecord> {
    return this.exclusive(async () => {
      const index = await this.load()
      const record = await this.find(id)
      const groupId = patch.groupId !== undefined ? (patch.groupId && index.folders[patch.groupId] ? patch.groupId : null) : record.groupId
      await this.moveTo(index, record, groupId, patch.title ?? record.title)
      await this.save()
      return this.publicRecord(record)
    })
  }

  remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.load()
      const record = await this.find(id)
      const path = this.absolute(record)
      if (existsSync(path)) await (this.options.trash ? this.options.trash(path) : rm(path, { force: true }))
      await rm(this.thumbPath(id), { force: true })
      index.records = index.records.filter((item) => item.id !== id)
      await this.save()
    })
  }

  /** Remove every capture this library tracks (to the Trash), and its data. */
  removeAll(): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.load()
      for (const record of index.records) {
        const path = this.absolute(record)
        if (existsSync(path)) await (this.options.trash ? this.options.trash(path) : rm(path, { force: true }))
      }
      await rm(this.privateDir, { recursive: true, force: true })
      this.index = { version: 2, folders: index.folders, records: [] }
    })
  }

  /**
   * Keep folders in step with bookmark groups: rename folders when groups
   * are renamed, and move captures of deleted groups to Unsorted.
   */
  syncGroups(groups: GroupLabel[]): Promise<boolean> {
    return this.exclusive(async () => {
      const index = await this.load()
      const next = folderNamesFor(groups)
      let changed = false
      // Rename via temporary names so swaps ("A"↔"B") cannot collide.
      const renames = Object.entries(next).filter(([id, name]) => index.folders[id] && index.folders[id] !== name)
      const staged: Array<[string, string, string]> = []
      for (const [id, name] of renames) {
        const from = join(this.root, index.folders[id]!)
        if (!existsSync(from)) continue
        const temporary = join(this.root, `.renaming-${randomUUID()}`)
        await rename(from, temporary)
        staged.push([id, temporary, name])
      }
      for (const [, temporary, name] of staged) {
        const target = join(this.root, name)
        if (existsSync(target)) {
          // Merge into an existing folder of that name.
          for (const file of await readdir(temporary)) await rename(join(temporary, file), await uniquePath(target, file))
          await rm(temporary, { recursive: true, force: true })
        } else {
          await rename(temporary, target)
        }
        changed = true
      }
      const previous = index.folders
      index.folders = next
      for (const record of index.records) {
        const oldFolder = (record.groupId && previous[record.groupId]) || UNSORTED_FOLDER
        const newFolder = this.folderOf(index, record.groupId && next[record.groupId] ? record.groupId : null)
        if (record.groupId && !next[record.groupId]) {
          await this.moveTo(index, record, null)
          changed = true
        } else if (oldFolder !== newFolder || dirname(record.path) !== newFolder) {
          const file = join(this.root, newFolder, basename(record.path))
          if (existsSync(file)) {
            record.path = relative(this.root, file)
            changed = true
          }
        }
      }
      if (changed || JSON.stringify(previous) !== JSON.stringify(next)) await this.save()
      return changed
    })
  }
}

/**
 * One-time import of captures saved by the earlier encrypted store
 * (key.seal + index.bin + AES-GCM files) into the Finder library.
 */
export async function migrateEncryptedCaptures(
  legacyDir: string,
  library: CaptureLibrary,
  unseal: (sealed: Buffer) => Promise<string>,
): Promise<number> {
  if (!existsSync(join(legacyDir, 'key.seal')) || !existsSync(join(legacyDir, 'index.bin'))) return 0
  const key = Buffer.from(await unseal(await readFile(join(legacyDir, 'key.seal'))), 'base64')
  const open = (sealed: Buffer): Buffer => {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12))
    decipher.setAuthTag(sealed.subarray(12, 28))
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()])
  }
  const parsed = JSON.parse(open(await readFile(join(legacyDir, 'index.bin'))).toString('utf8')) as unknown[]
  let migrated = 0
  for (const value of [...parsed].reverse()) {
    const record = parseCaptureRecord(value)
    if (!record) continue
    try {
      const { id: _id, createdAt, byteLength: _bytes, fileName: _fileName, ...meta } = record
      await library.add({
        ...meta,
        createdAt: new Date(createdAt),
        media: open(await readFile(join(legacyDir, `${record.id}.bin`))),
        thumb: open(await readFile(join(legacyDir, `${record.id}.thumb.bin`))),
      })
      migrated += 1
    } catch {
      // Skip unreadable items; the rest still migrate.
    }
  }
  await rm(legacyDir, { recursive: true, force: true })
  return migrated
}
