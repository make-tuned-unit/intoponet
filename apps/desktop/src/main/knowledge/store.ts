import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KnowledgeCrypto } from './crypto'
import { isKnowledgeId, KNOWLEDGE_LIMITS, type KnowledgeDate, type KnowledgeDocument, type KnowledgeEntity, type KnowledgePlace, type KnowledgeRecord } from './contract'

/**
 * Encrypted on-disk knowledge store: one sealed index of record metadata and
 * one sealed file per document. Writes are atomic (temp file + rename).
 */
export class KnowledgeStore {
  private records: KnowledgeRecord[] | null = null

  constructor(private readonly dir: string, private readonly crypto: KnowledgeCrypto) {}

  private indexPath(): string {
    return join(this.dir, 'index.bin')
  }

  private docPath(id: string): string {
    if (!isKnowledgeId(id)) throw new Error('Invalid knowledge id.')
    return join(this.dir, `${id}.bin`)
  }

  private async writeSealed(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    await mkdir(this.dir, { recursive: true })
    await writeFile(temporary, this.crypto.seal(Buffer.from(JSON.stringify(value), 'utf8')), { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  }

  private async readSealed(path: string): Promise<unknown> {
    return JSON.parse(this.crypto.unseal(await readFile(path)).toString('utf8')) as unknown
  }

  async list(): Promise<KnowledgeRecord[]> {
    if (this.records) return this.records
    if (!existsSync(this.indexPath())) {
      this.records = []
      return this.records
    }
    const raw = await this.readSealed(this.indexPath())
    this.records = Array.isArray(raw) ? raw.flatMap((item) => {
      const record = parseRecord(item)
      return record ? [record] : []
    }) : []
    return this.records
  }

  async get(id: string): Promise<KnowledgeDocument | null> {
    const record = (await this.list()).find((item) => item.id === id)
    if (!record || !existsSync(this.docPath(id))) return null
    const raw = await this.readSealed(this.docPath(id))
    const paragraphs = isRecordLike(raw) && Array.isArray(raw['paragraphs'])
      ? raw['paragraphs'].filter((item): item is string => typeof item === 'string')
      : []
    return { ...record, paragraphs }
  }

  /** Insert or replace a document. Enforces the record and size limits. */
  async put(document: KnowledgeDocument): Promise<KnowledgeRecord> {
    const records = await this.list()
    const exists = records.some((item) => item.id === document.id)
    if (!exists && records.length >= KNOWLEDGE_LIMITS.records) {
      throw new Error(`Your knowledge library is full (${KNOWLEDGE_LIMITS.records} pages). Remove some to absorb more.`)
    }
    const body = JSON.stringify({ paragraphs: document.paragraphs })
    if (Buffer.byteLength(body, 'utf8') > KNOWLEDGE_LIMITS.documentBytes) throw new Error('This page is too large to absorb.')
    const { paragraphs: _paragraphs, ...record } = document
    await this.writeSealed(this.docPath(document.id), { paragraphs: document.paragraphs })
    const next = [record, ...records.filter((item) => item.id !== document.id)]
    await this.writeSealed(this.indexPath(), next)
    this.records = next
    return record
  }

  async updateRecord(record: KnowledgeRecord): Promise<KnowledgeRecord> {
    const records = await this.list()
    if (!records.some((item) => item.id === record.id)) throw new Error('That absorbed page no longer exists.')
    const next = records.map((item) => (item.id === record.id ? record : item))
    await this.writeSealed(this.indexPath(), next)
    this.records = next
    return record
  }

  async remove(id: string): Promise<void> {
    const records = await this.list()
    const next = records.filter((item) => item.id !== id)
    await rm(this.docPath(id), { force: true })
    await this.writeSealed(this.indexPath(), next)
    this.records = next
  }

  async removeAll(): Promise<void> {
    this.records = []
    if (!existsSync(this.dir)) return
    for (const name of await readdir(this.dir)) {
      if (name === 'key.seal') continue
      if (name.endsWith('.bin') || name.endsWith('.tmp')) await rm(join(this.dir, name), { force: true })
    }
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const str = (value: unknown): value is string => typeof value === 'string'
const nullableStr = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function entities(value: unknown): KnowledgeEntity[] {
  return Array.isArray(value) ? value.flatMap((item): KnowledgeEntity[] => isRecordLike(item) && str(item['text']) &&
    (item['kind'] === 'place' || item['kind'] === 'name' || item['kind'] === 'term') && typeof item['count'] === 'number'
    ? [{ text: item['text'], kind: item['kind'], count: item['count'] }]
    : []) : []
}

function places(value: unknown): KnowledgePlace[] {
  return Array.isArray(value) ? value.flatMap((item): KnowledgePlace[] => isRecordLike(item) && str(item['name']) && str(item['countryCode']) &&
    typeof item['lat'] === 'number' && typeof item['lon'] === 'number' && typeof item['count'] === 'number'
    ? [{ name: item['name'], countryCode: item['countryCode'], lat: item['lat'], lon: item['lon'], count: item['count'] }]
    : []) : []
}

function dates(value: unknown): KnowledgeDate[] {
  return Array.isArray(value) ? value.flatMap((item): KnowledgeDate[] => isRecordLike(item) && str(item['text'])
    ? [{ text: item['text'], iso: nullableStr(item['iso']) }]
    : []) : []
}

export function parseRecord(value: unknown): KnowledgeRecord | null {
  if (!isRecordLike(value) || !isKnowledgeId(value['id']) || !str(value['url']) || !str(value['title']) || !str(value['absorbedAt'])) return null
  return {
    id: value['id'],
    url: value['url'],
    title: value['title'],
    siteName: nullableStr(value['siteName']),
    lang: nullableStr(value['lang']),
    publishedAt: nullableStr(value['publishedAt']),
    absorbedAt: value['absorbedAt'],
    scope: value['scope'] === 'selection' ? 'selection' : 'article',
    wordCount: typeof value['wordCount'] === 'number' ? value['wordCount'] : 0,
    paragraphCount: typeof value['paragraphCount'] === 'number' ? value['paragraphCount'] : 0,
    entities: entities(value['entities']),
    places: places(value['places']),
    dates: dates(value['dates']),
    note: nullableStr(value['note']),
  }
}
