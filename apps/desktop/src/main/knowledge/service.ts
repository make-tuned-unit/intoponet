import { createHash, randomBytes } from 'node:crypto'
import { analyze, PREVIEW_SIZES } from './analyze'
import { resolveKnowledgeCrypto, type KnowledgeCryptoSource } from './crypto'
import { EXTRACT_SCRIPT, KNOWLEDGE_WORLD_ID, parseExtraction, selectionParagraphs } from './extract'
import { pageRefusal, REFUSALS, urlRefusal } from './policy'
import { KnowledgeIndex } from './searchIndex'
import { knowledgeToJsonLd } from './exportLd'
import { KnowledgeStore } from './store'
import { labelClaims } from './claims'
import type { KnowledgeClaim } from '@intoponet/browser-api'
import {
  KNOWLEDGE_LIMITS,
  type AbsorbPreview,
  type AbsorbRefusal,
  type AbsorbScope,
  type KnowledgeCommand,
  type KnowledgeDocument,
  type KnowledgeHit,
  type KnowledgeRecord,
} from './contract'

/** The part of WebContents Absorb needs; WebContents satisfies it. */
export type KnowledgePage = {
  getURL(): string
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown>
}

type PendingPreview = {
  expiresAt: number
  url: string
  title: string
  siteName: string | null
  lang: string | null
  publishedAt: string | null
  scope: AbsorbScope
  paragraphs: string[]
}

const MIN_WORDS = 30

/** Stable record id per URL (without fragment), so re-absorbing replaces. */
export function knowledgeIdFor(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  return `kn-${createHash('sha256').update(parsed.toString()).digest('hex').slice(0, 24)}`
}

/** Notified after the stored documents change (used by Laya to keep embeddings in step). */
export type KnowledgeChange = { type: 'put'; id: string } | { type: 'remove'; id: string } | { type: 'clear' }

export class KnowledgeService {
  private readonly previews = new Map<string, PendingPreview>()
  private readonly index = new KnowledgeIndex()
  private store: KnowledgeStore | null = null
  private ready: Promise<KnowledgeStore> | null = null
  private readonly now: () => number

  constructor(private readonly options: {
    /** Sites the user chose to leave out (Privacy › Sites to leave out). */
    isExcluded?: (url: string) => boolean
    dir: string
    /** Pass a function (see retryingKnowledgeCrypto) so a Keychain failure can be retried. */
    crypto: KnowledgeCryptoSource
    getActivePage: () => KnowledgePage | null
    now?: () => number
    onChange?: (change: KnowledgeChange) => void
  }) {
    this.now = options.now ?? Date.now
  }

  private async load(): Promise<KnowledgeStore> {
    if (this.store) return this.store
    this.ready ??= (async () => {
      const store = new KnowledgeStore(this.options.dir, await resolveKnowledgeCrypto(this.options.crypto))
      for (const record of await store.list()) {
        const document = await store.get(record.id).catch(() => null)
        if (document) this.index.add(record.id, record.url, record.title, document.paragraphs)
      }
      this.store = store
      return store
    })()
    // A failure (e.g. Keychain access denied) is not kept: the next use tries again.
    const attempt = this.ready
    attempt.catch(() => { if (this.ready === attempt) this.ready = null })
    return attempt
  }

  handle(command: KnowledgeCommand): Promise<unknown> {
    switch (command.type) {
      case 'preview': return this.preview(command.scope)
      case 'commit': return this.commit(command.previewId, command)
      case 'cancel': return Promise.resolve(void this.previews.delete(command.previewId))
      case 'list': return this.list()
      case 'get': return this.get(command.id)
      case 'search': return this.search(command.query, command.limit)
      case 'remove': return this.remove(command.id)
      case 'update': return this.update(command.id, command)
      case 'reindex': return this.reindex(command.id)
      case 'claims': return this.claims(command.id)
      case 'remove-all': return this.removeAll()
      case 'export': return this.exportAll()
    }
  }

  private sweep(): void {
    const now = this.now()
    for (const [id, preview] of this.previews) if (preview.expiresAt < now) this.previews.delete(id)
  }

  async preview(scope: AbsorbScope): Promise<AbsorbPreview | AbsorbRefusal> {
    this.sweep()
    const page = this.options.getActivePage()
    if (!page) return { refused: true, reason: REFUSALS.noPage }
    const before = urlRefusal(page.getURL()) ?? (this.options.isExcluded?.(page.getURL()) ? REFUSALS.excludedSite : null)
    if (before) return { refused: true, reason: before }
    let raw: unknown
    try {
      raw = await page.executeJavaScriptInIsolatedWorld(KNOWLEDGE_WORLD_ID, [{ code: EXTRACT_SCRIPT }])
    } catch {
      return { refused: true, reason: REFUSALS.failed }
    }
    const extraction = parseExtraction(raw)
    if (!extraction) return { refused: true, reason: REFUSALS.failed }
    // The page may have navigated while the script ran: check the URL it reports too.
    const after = urlRefusal(extraction.url) ?? pageRefusal(extraction)
    if (after) return { refused: true, reason: after }
    const selection = selectionParagraphs(extraction.selection)
    if (scope === 'selection' && !selection.length) return { refused: true, reason: REFUSALS.noSelection }
    const paragraphs = scope === 'selection' ? selection : extraction.paragraphs
    const analysis = analyze(paragraphs)
    if (analysis.wordCount < (scope === 'selection' ? 3 : MIN_WORDS)) return { refused: true, reason: REFUSALS.tooLittle }
    const url = extraction.canonical && sameSite(extraction.canonical, extraction.url) ? extraction.canonical : extraction.url
    const previewId = `preview-${randomBytes(12).toString('hex')}`
    const title = cleanTitle(extraction.title, extraction.siteName) || new URL(url).hostname
    this.previews.set(previewId, {
      expiresAt: this.now() + KNOWLEDGE_LIMITS.previewTtlMs,
      url,
      title,
      siteName: extraction.siteName,
      lang: extraction.lang,
      publishedAt: extraction.publishedAt,
      scope,
      paragraphs,
    })
    return {
      previewId,
      url,
      title,
      siteName: extraction.siteName,
      lang: extraction.lang,
      publishedAt: extraction.publishedAt,
      scope,
      wordCount: analysis.wordCount,
      paragraphCount: paragraphs.length,
      paragraphs: paragraphs.slice(0, PREVIEW_SIZES.paragraphs),
      entities: analysis.entities.slice(0, PREVIEW_SIZES.entities),
      places: analysis.places,
      dates: analysis.dates.slice(0, PREVIEW_SIZES.dates),
      linkCount: extraction.linkCount,
      selectionAvailable: selection.length > 0,
    }
  }

  async commit(previewId: string, options: { removeEntities?: string[]; note?: string } = {}): Promise<KnowledgeRecord> {
    this.sweep()
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error('This preview has expired. Absorb the page again.')
    const store = await this.load()
    const removed = new Set((options.removeEntities ?? []).map((text) => text.toLowerCase()))
    const analysis = analyze(preview.paragraphs, removed)
    const document: KnowledgeDocument = {
      id: knowledgeIdFor(preview.url),
      url: preview.url,
      title: preview.title,
      siteName: preview.siteName,
      lang: preview.lang,
      publishedAt: preview.publishedAt,
      absorbedAt: new Date(this.now()).toISOString(),
      scope: preview.scope,
      wordCount: analysis.wordCount,
      paragraphCount: preview.paragraphs.length,
      entities: analysis.entities,
      places: analysis.places,
      dates: analysis.dates,
      note: options.note?.trim() ? options.note.trim() : null,
      paragraphs: preview.paragraphs,
    }
    const record = await store.put(document)
    this.previews.delete(previewId)
    this.index.add(record.id, record.url, record.title, document.paragraphs)
    this.notify({ type: 'put', id: record.id })
    return record
  }

  private notify(change: KnowledgeChange): void {
    try {
      this.options.onChange?.(change)
    } catch {
      // Observers never break the store.
    }
  }

  async list(): Promise<KnowledgeRecord[]> {
    const records = await (await this.load()).list()
    return [...records].sort((a, b) => b.absorbedAt.localeCompare(a.absorbedAt))
  }

  async get(id: string): Promise<KnowledgeDocument> {
    const document = await (await this.load()).get(id)
    if (!document) throw new Error('That absorbed page no longer exists.')
    return document
  }

  async searchParagraphs(query: string, limit = 30): Promise<KnowledgeHit[]> {
    await this.load()
    return this.index.searchParagraphs(query, Math.min(limit, KNOWLEDGE_LIMITS.searchLimit))
  }

  async search(query: string, limit = 20): Promise<KnowledgeHit[]> {
    await this.load()
    return this.index.search(query, Math.min(limit, KNOWLEDGE_LIMITS.searchLimit))
  }

  async remove(id: string): Promise<void> {
    await (await this.load()).remove(id)
    this.index.remove(id)
    this.notify({ type: 'remove', id })
  }

  async update(id: string, patch: { note?: string | null; removeEntities?: string[]; title?: string }): Promise<KnowledgeRecord> {
    const store = await this.load()
    const document = await store.get(id)
    if (!document) throw new Error('That absorbed page no longer exists.')
    const { paragraphs, ...record } = document
    const removed = new Set((patch.removeEntities ?? []).map((text) => text.toLowerCase()))
    const next: KnowledgeRecord = {
      ...record,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() ? patch.note.trim() : null } : {}),
      entities: record.entities.filter((entity) => !removed.has(entity.text.toLowerCase())),
      places: record.places.filter((place) => !removed.has(place.name.toLowerCase())),
    }
    const saved = await store.updateRecord(next)
    if (patch.title !== undefined) this.index.add(id, saved.url, saved.title, paragraphs)
    return saved
  }

  /** Recompute entities, places and dates from the stored paragraphs. */
  async reindex(id: string): Promise<KnowledgeRecord> {
    const store = await this.load()
    const document = await store.get(id)
    if (!document) throw new Error('That absorbed page no longer exists.')
    const analysis = analyze(document.paragraphs)
    const { paragraphs, ...record } = document
    const saved = await store.updateRecord({ ...record, entities: analysis.entities, places: analysis.places, dates: analysis.dates, wordCount: analysis.wordCount })
    this.index.add(id, saved.url, saved.title, paragraphs)
    return saved
  }

  /** Claims in one page, labelled against every other absorbed page (all on this Mac). */
  async claims(id: string): Promise<KnowledgeClaim[]> {
    const target = await this.get(id)
    const others: KnowledgeDocument[] = []
    for (const record of await this.list()) {
      if (record.id === id) continue
      try {
        others.push(await this.get(record.id))
      } catch {
        // A damaged record is skipped, not fatal.
      }
    }
    return labelClaims(target, others)
  }

  async exportAll(): Promise<string> {
    const store = await this.load()
    const records = await this.list()
    const documents: KnowledgeDocument[] = []
    for (const record of records) {
      const document = await store.get(record.id).catch(() => null)
      if (document) documents.push(document)
    }
    return knowledgeToJsonLd(documents, new Date(this.now()))
  }

  async removeAll(): Promise<void> {
    await (await this.load()).removeAll()
    this.index.clear()
    this.previews.clear()
    this.notify({ type: 'clear' })
  }
}

function sameSite(a: string, b: string): boolean {
  try {
    return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '')
  } catch {
    return false
  }
}

/** Drop a trailing " - Site" / " | Site" / " — Site" brand from a page title. */
export function cleanTitle(title: string, siteName: string | null): string {
  const value = title.trim()
  const parts = value.split(/\s+[-|–—·]\s+/)
  if (parts.length < 2) return value
  const last = parts[parts.length - 1]!.toLowerCase()
  const site = (siteName ?? '').toLowerCase()
  const brandLike = (site && (last === site || site.includes(last) || last.includes(site))) || /^(wikipedia|the [a-z ]+ times|bbc news|reuters|ap news)$/.test(last)
  return brandLike ? parts.slice(0, -1).join(' - ').trim() : value
}
