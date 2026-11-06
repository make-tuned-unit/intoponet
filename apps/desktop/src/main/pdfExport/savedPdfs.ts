import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { SavedPdfRecord } from '@intoponet/browser-api'

const LIMIT = 1000

function isRecord(value: unknown): value is SavedPdfRecord {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item['id'] === 'string' && typeof item['path'] === 'string' && item['path'].startsWith('/') && /\.pdf$/i.test(item['path'])
    && typeof item['filename'] === 'string' && typeof item['title'] === 'string' && typeof item['url'] === 'string'
    && typeof item['savedAt'] === 'string' && typeof item['bytes'] === 'number'
    && (item['pages'] === null || typeof item['pages'] === 'number') && (item['mode'] === 'formatted' || item['mode'] === 'asSeen')
}

/**
 * The PDFs saved with Export as PDF, so they can be found again in the app (Bookmarks › PDFs).
 * Only the list lives here; the files stay wherever they were saved. Private tabs are never listed.
 */
export class SavedPdfList {
  private items: SavedPdfRecord[] = []

  constructor(private readonly file: string, private readonly write: (file: string, data: string) => Promise<void>, private readonly exists: (path: string) => boolean = existsSync) {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (Array.isArray(value)) this.items = value.filter(isRecord).slice(0, LIMIT)
    } catch {
      // No list yet.
    }
  }

  async add(entry: Omit<SavedPdfRecord, 'id' | 'savedAt'>, savedAt = new Date()): Promise<SavedPdfRecord> {
    const record: SavedPdfRecord = { ...entry, id: randomUUID(), savedAt: savedAt.toISOString() }
    // Saving over the same file replaces its entry.
    this.items = [record, ...this.items.filter((item) => item.path !== entry.path)].slice(0, LIMIT)
    await this.save()
    return record
  }

  /** Newest first; files that were moved or deleted drop off the list. */
  async list(): Promise<SavedPdfRecord[]> {
    const present = this.items.filter((item) => this.exists(item.path))
    if (present.length !== this.items.length) {
      this.items = present
      await this.save()
    }
    return [...present]
  }

  async forget(id: string): Promise<void> {
    const next = this.items.filter((item) => item.id !== id)
    if (next.length === this.items.length) return
    this.items = next
    await this.save()
  }

  private save(): Promise<void> {
    return this.write(this.file, JSON.stringify(this.items)).catch(() => undefined)
  }
}
