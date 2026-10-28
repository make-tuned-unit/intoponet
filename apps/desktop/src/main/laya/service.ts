import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KnowledgeDocument, KnowledgeHit, KnowledgeRecord } from '@intoponet/browser-api'
import {
  LAYA_LIMITS,
  type LayaCommand,
  type LayaHit,
  type LayaPassage,
  type LayaProgress,
  type LayaRelated,
  type LayaStatus,
  type LayaTheme,
} from './contract'
import type { KnowledgeCrypto } from '../knowledge/crypto'
import type { KnowledgeChange } from '../knowledge/service'
import { deleteModel, downloadModel, LAYA_MODEL, modelPresent, modelSizeBytes, verifyModel } from './model'
import type { Embedder } from './pool'
import { chunkParagraphs, distinctiveTerms, dot, fuseRanks, kmeans, meanVector, normalise, themeCount, trimPassage, type Chunk } from './retrieval'
import { VectorStore, type DocumentVectors } from './vectors'

/** The parts of the knowledge service Laya reads. */
export type KnowledgeSource = {
  list(): Promise<KnowledgeRecord[]>
  get(id: string): Promise<KnowledgeDocument>
  search(query: string, limit?: number): Promise<KnowledgeHit[]>
  /** Paragraph-level word matches (several per page); optional for older sources. */
  searchParagraphs?(query: string, limit?: number): Promise<KnowledgeHit[]>
}

/** Below this cosine similarity a passage is not offered as an answer. */
const MIN_ANSWER_SIMILARITY = 0.3
const MIN_RELATED_SIMILARITY = 0.25
const CHUNK_TOKENS = 220
const EMBED_BATCH = 12
const TEXT_BATCH = 32
const TEXT_CACHE = 8_000
const LAYA_DIMENSIONS = LAYA_MODEL.dimensions

type ScoredChunk = { recordId: string; chunk: Chunk; similarity: number }

/** Model file operations; injectable so tests never touch the network or a real model. */
export type ModelOps = {
  download: typeof downloadModel
  verify: (root: string) => Promise<boolean>
  present: (root: string) => boolean
  remove: (root: string) => Promise<void>
}

const realModelOps: ModelOps = { download: downloadModel, verify: (root) => verifyModel(root), present: modelPresent, remove: deleteModel }

/**
 * Laya: optional, local-only semantic retrieval over absorbed pages.
 * Off until enabled; the model is pinned and verified; inference runs in
 * network-less workers; answers are cited passages, never generated text.
 */
export class LayaService {
  private readonly dir: string
  private readonly knowledge: KnowledgeSource
  private readonly fetchImpl: typeof fetch
  private readonly openEmbedder: (modelRoot: string) => Promise<Embedder>
  private readonly emit: (event: LayaProgress) => void
  private readonly cryptoInput: KnowledgeCrypto | Promise<KnowledgeCrypto>
  private enabled = false
  private verified = false
  private busy = false
  private lastError: string | null = null
  private embedder: Embedder | null = null
  private embedderPromise: Promise<Embedder> | null = null
  private vectorStore: VectorStore | null = null
  private cache = new Map<string, DocumentVectors>()
  private cacheLoaded = false
  private themesCache: { version: number; themes: LayaTheme[] } | null = null
  private version = 0
  private queue = new Set<string>()
  private draining: Promise<void> | null = null
  private settingsLoaded: Promise<void> | null = null
  private readonly model: ModelOps

  constructor(options: {
    dir: string
    crypto: KnowledgeCrypto | Promise<KnowledgeCrypto>
    knowledge: KnowledgeSource
    openEmbedder: (modelRoot: string) => Promise<Embedder>
    emit?: (event: LayaProgress) => void
    fetchImpl?: typeof fetch
    modelOps?: ModelOps
  }) {
    this.model = options.modelOps ?? realModelOps
    this.dir = options.dir
    this.cryptoInput = options.crypto
    this.knowledge = options.knowledge
    this.openEmbedder = options.openEmbedder
    this.emit = options.emit ?? (() => undefined)
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  handle(command: LayaCommand): Promise<unknown> {
    switch (command.type) {
      case 'status': return this.status()
      case 'enable': return this.enable()
      case 'disable': return this.disable({ deleteModel: command.deleteModel })
      case 'search': return this.search(command.query, command.limit)
      case 'related': return command.recordId !== undefined ? this.related({ recordId: command.recordId }, command.limit) : this.related({ text: command.text ?? '' }, command.limit)
      case 'themes': return this.themes()
      case 'ask': return this.ask(command.question, command.limit)
      case 'backfill': return this.backfill().then(() => this.status())
    }
  }

  // ---- Settings and lifecycle ----------------------------------------------

  private settingsPath(): string {
    return join(this.dir, 'settings.json')
  }

  private loadSettings(): Promise<void> {
    this.settingsLoaded ??= (async () => {
      try {
        if (existsSync(this.settingsPath())) {
          const raw = JSON.parse(await readFile(this.settingsPath(), 'utf8')) as { enabled?: unknown }
          this.enabled = raw.enabled === true
        }
      } catch {
        this.enabled = false
      }
    })()
    return this.settingsLoaded
  }

  private async saveSettings(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.settingsPath(), JSON.stringify({ enabled: this.enabled }), { mode: 0o600 })
  }

  private async vectors(): Promise<VectorStore> {
    this.vectorStore ??= new VectorStore(join(this.dir, 'vectors'), await this.cryptoInput)
    return this.vectorStore
  }

  async status(): Promise<LayaStatus> {
    await this.loadSettings()
    const records = await this.knowledge.list().catch(() => [] as KnowledgeRecord[])
    const ids = new Set(await (await this.vectors()).ids().catch(() => [] as string[]))
    return {
      enabled: this.enabled,
      model: { id: LAYA_MODEL.id, revision: LAYA_MODEL.revision, sizeBytes: modelSizeBytes(), downloaded: this.model.present(this.dir), verified: this.verified },
      indexedDocuments: records.filter((record) => ids.has(record.id)).length,
      totalDocuments: records.length,
      busy: this.busy,
      lastError: this.lastError,
    }
  }

  private async publishStatus(): Promise<void> {
    this.emit({ type: 'status', status: await this.status() })
  }

  /** LAY-005: the only path that downloads anything, and only on the user's request. */
  async enable(): Promise<LayaStatus> {
    await this.loadSettings()
    this.busy = true
    this.lastError = null
    await this.publishStatus()
    try {
      await this.model.download(
        this.dir,
        this.fetchImpl,
        (progress) => this.emit({ type: 'download', ...progress }),
        (file) => this.emit({ type: 'verify', file }),
      )
      this.verified = await this.model.verify(this.dir)
      if (!this.verified) throw new Error('The model could not be verified.')
      this.enabled = true
      await this.saveSettings()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Laya could not be enabled.'
      throw new Error(this.lastError)
    } finally {
      this.busy = false
      await this.publishStatus()
    }
    void this.backfill().catch(() => undefined)
    return this.status()
  }

  async disable(options: { deleteModel: boolean }): Promise<LayaStatus> {
    await this.loadSettings()
    this.enabled = false
    this.queue.clear()
    await this.saveSettings()
    await this.closeEmbedder()
    if (options.deleteModel) {
      await this.model.remove(this.dir)
      await (await this.vectors()).clear()
      this.cache.clear()
      this.cacheLoaded = false
      this.verified = false
      this.bump()
    }
    await this.publishStatus()
    return this.status()
  }

  async close(): Promise<void> {
    await this.closeEmbedder()
  }

  private async closeEmbedder(): Promise<void> {
    const embedder = this.embedder ?? (this.embedderPromise ? await this.embedderPromise.catch(() => null) : null)
    this.embedder = null
    this.embedderPromise = null
    await embedder?.close()
  }

  private async ready(): Promise<Embedder> {
    await this.loadSettings()
    if (!this.enabled) throw new Error('Laya is off. Turn it on to search by meaning.')
    if (!this.verified) {
      this.verified = await this.model.verify(this.dir)
      if (!this.verified) throw new Error('Laya’s model is missing or changed. Turn Laya off and on again to re-download it.')
    }
    if (this.embedder) return this.embedder
    this.embedderPromise ??= this.openEmbedder(this.dir).then((embedder) => {
      this.embedder = embedder
      return embedder
    })
    return this.embedderPromise
  }

  private bump(): void {
    this.version += 1
    this.themesCache = null
  }

  // ---- Keeping embeddings in step with the knowledge store ------------------

  onKnowledgeChange(change: KnowledgeChange): void {
    void (async () => {
      const store = await this.vectors()
      if (change.type === 'remove') {
        await store.remove(change.id)
        this.cache.delete(change.id)
        this.queue.delete(change.id)
        this.bump()
      } else if (change.type === 'clear') {
        await store.clear()
        this.cache.clear()
        this.queue.clear()
        this.bump()
      } else {
        await this.loadSettings()
        if (!this.enabled) return
        this.queue.add(change.id)
        void this.drain()
      }
    })().catch(() => undefined)
  }

  /** Embed every absorbed page that has no current vectors. */
  async backfill(): Promise<void> {
    await this.loadSettings()
    if (!this.enabled) return
    const store = await this.vectors()
    const have = new Set(await store.ids())
    for (const record of await this.knowledge.list()) {
      if (!have.has(record.id)) this.queue.add(record.id)
      else {
        const vectors = this.cache.get(record.id) ?? await store.get(record.id)
        if (!vectors || vectors.revision !== LAYA_MODEL.revision) this.queue.add(record.id)
      }
    }
    await this.drain()
  }

  private drain(): Promise<void> {
    this.draining ??= (async () => {
      this.busy = true
      await this.publishStatus()
      const total = this.queue.size
      let done = 0
      try {
        while (this.queue.size && this.enabled) {
          const id = this.queue.values().next().value as string
          this.queue.delete(id)
          this.emit({ type: 'embedding', done, total: Math.max(total, done + this.queue.size + 1), recordId: id })
          try {
            await this.embedDocument(id)
          } catch (error) {
            this.lastError = error instanceof Error ? error.message : 'A page could not be indexed.'
          }
          done += 1
        }
        this.emit({ type: 'embedding', done, total: Math.max(total, done), recordId: null })
      } finally {
        this.busy = false
        this.draining = null
        await this.publishStatus()
      }
    })()
    return this.draining
  }

  private async embedDocument(id: string): Promise<void> {
    const embedder = await this.ready()
    const document = await this.knowledge.get(id).catch(() => null)
    if (!document) return
    const chunks = chunkParagraphs(document.paragraphs, (text) => embedder.countTokens(text), CHUNK_TOKENS)
    const vectors: Float32Array[] = []
    for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
      vectors.push(...await embedder.embed(chunks.slice(start, start + EMBED_BATCH).map((chunk) => chunk.text)))
    }
    const value: DocumentVectors = { recordId: id, revision: LAYA_MODEL.revision, dims: LAYA_MODEL.dimensions, chunks, vectors }
    await (await this.vectors()).put(value)
    this.cache.set(id, value)
    this.bump()
  }

  private async allVectors(): Promise<DocumentVectors[]> {
    const store = await this.vectors()
    const records = new Set((await this.knowledge.list()).map((record) => record.id))
    if (!this.cacheLoaded) {
      for (const id of await store.ids()) {
        if (!records.has(id) || this.cache.has(id)) continue
        const value = await store.get(id)
        if (value && value.revision === LAYA_MODEL.revision) this.cache.set(id, value)
      }
      this.cacheLoaded = true
    }
    return [...this.cache.values()].filter((value) => records.has(value.recordId))
  }

  // ---- Retrieval ------------------------------------------------------------

  /**
   * Meaning similarity of each text to a query, on this Mac; null when Laya is
   * off or its model is not ready (never starts a download).
   */
  async similarities(query: string, texts: string[]): Promise<number[] | null> {
    await this.loadSettings()
    if (!this.enabled || texts.length === 0) return null
    try {
      const embedder = await this.ready()
      const [q, ...rest] = await embedder.embed([query, ...texts].map((text) => text.slice(0, LAYA_LIMITS.textLength)))
      if (!q || rest.length !== texts.length) return null
      return rest.map((vector) => dot(normalise(q), normalise(vector)))
    } catch {
      return null
    }
  }

  /**
   * Unit vectors for many short texts (headlines, news items, sentences), for
   * meaning comparisons elsewhere on this Mac (The Olds). Cached by text, so a
   * day's news items are embedded once; null when Laya is off.
   */
  private textVectors = new Map<string, Float32Array>()
  async embedTexts(texts: string[]): Promise<Float32Array[] | null> {
    await this.loadSettings()
    if (!this.enabled || texts.length === 0) return null
    try {
      const embedder = await this.ready()
      const keys = texts.map((text) => text.slice(0, LAYA_LIMITS.textLength))
      const missing = [...new Set(keys.filter((key) => !this.textVectors.has(key)))]
      for (let i = 0; i < missing.length; i += TEXT_BATCH) {
        const batch = missing.slice(i, i + TEXT_BATCH)
        const vectors = await embedder.embed(batch)
        batch.forEach((key, index) => { if (vectors[index]) this.textVectors.set(key, normalise(vectors[index]!)) })
      }
      // Keep the cache bounded: drop the oldest entries.
      while (this.textVectors.size > TEXT_CACHE) this.textVectors.delete(this.textVectors.keys().next().value!)
      return keys.map((key) => this.textVectors.get(key) ?? new Float32Array(LAYA_DIMENSIONS))
    } catch {
      return null
    }
  }

  private async embedQuery(text: string): Promise<Float32Array> {
    const embedder = await this.ready()
    const [vector] = await embedder.embed([text.slice(0, LAYA_LIMITS.textLength)])
    if (!vector) throw new Error('The query could not be embedded.')
    return vector
  }

  private scoreChunks(query: Float32Array, documents: DocumentVectors[], exclude?: string): ScoredChunk[] {
    const scored: ScoredChunk[] = []
    for (const document of documents) {
      if (document.recordId === exclude) continue
      document.vectors.forEach((vector, index) => {
        scored.push({ recordId: document.recordId, chunk: document.chunks[index]!, similarity: dot(query, vector) })
      })
    }
    return scored.sort((a, b) => b.similarity - a.similarity)
  }

  private bestPerRecord(scored: ScoredChunk[]): ScoredChunk[] {
    const seen = new Set<string>()
    return scored.filter((item) => {
      if (seen.has(item.recordId)) return false
      seen.add(item.recordId)
      return true
    })
  }

  /** Hybrid search: BM25 words + embedding meaning, fused by reciprocal rank. */
  async search(query: string, limit = 20): Promise<LayaHit[]> {
    const capped = Math.min(limit, LAYA_LIMITS.resultLimit)
    const wordHits = await this.knowledge.search(query, LAYA_LIMITS.resultLimit)
    const meaning = this.bestPerRecord(this.scoreChunks(await this.embedQuery(query), await this.allVectors()))
      .filter((item) => item.similarity >= MIN_RELATED_SIMILARITY)
      .slice(0, LAYA_LIMITS.resultLimit)
    const records = new Map((await this.knowledge.list()).map((record) => [record.id, record]))
    const fused = fuseRanks(wordHits.map((hit) => hit.recordId), meaning.map((item) => item.recordId))
    const hits: LayaHit[] = []
    for (const entry of fused.slice(0, capped)) {
      const wordHit = wordHits.find((hit) => hit.recordId === entry.key)
      if (wordHit) {
        hits.push({ ...wordHit, score: entry.score, matchedBy: entry.matchedBy })
        continue
      }
      const best = meaning.find((item) => item.recordId === entry.key)
      const record = records.get(entry.key)
      if (!best || !record) continue
      const snippet = trimPassage(best.chunk.text, query, 240)
      hits.push({
        recordId: record.id,
        url: record.url,
        title: record.title,
        paragraphIndex: best.chunk.paragraphStart,
        snippet,
        matches: wordOffsets(snippet, query),
        score: entry.score,
        matchedBy: entry.matchedBy,
      })
    }
    return hits
  }

  /** Pages close in meaning to one absorbed page (or to some text). */
  async related(input: { recordId: string } | { text: string }, limit = 8): Promise<LayaRelated[]> {
    const documents = await this.allVectors()
    let query: Float32Array
    let exclude: string | undefined
    if ('recordId' in input) {
      const own = documents.find((document) => document.recordId === input.recordId)
      if (!own || !own.vectors.length) return []
      query = meanVector(own.vectors)
      exclude = input.recordId
    } else {
      query = await this.embedQuery(input.text)
    }
    const records = new Map((await this.knowledge.list()).map((record) => [record.id, record]))
    return this.bestPerRecord(this.scoreChunks(query, documents, exclude))
      .filter((item) => item.similarity >= MIN_RELATED_SIMILARITY && records.has(item.recordId))
      .slice(0, Math.min(limit, LAYA_LIMITS.resultLimit))
      .map((item) => {
        const record = records.get(item.recordId)!
        return {
          recordId: record.id,
          url: record.url,
          title: record.title,
          paragraphIndex: item.chunk.paragraphStart,
          snippet: trimPassage(item.chunk.text, '', 240),
          similarity: Math.max(0, Math.min(1, item.similarity)),
        }
      })
  }

  /** Group absorbed pages into themes, labelled by their distinctive names and terms. */
  async themes(): Promise<LayaTheme[]> {
    await this.ready()
    if (this.themesCache && this.themesCache.version === this.version) return this.themesCache.themes
    const documents = (await this.allVectors()).filter((document) => document.vectors.length)
    const records = new Map((await this.knowledge.list()).map((record) => [record.id, record]))
    if (documents.length < 2) {
      this.themesCache = { version: this.version, themes: [] }
      return []
    }
    const centres = documents.map((document) => meanVector(document.vectors))
    const assignment = kmeans(centres, themeCount(documents.length))
    const termsOf = (id: string): string[] => (records.get(id)?.entities ?? []).filter((entity) => entity.kind !== 'term' || entity.count >= 3).map((entity) => entity.text)
    const clusters = new Map<number, number[]>()
    assignment.forEach((cluster, index) => clusters.set(cluster, [...(clusters.get(cluster) ?? []), index]))
    const themes: LayaTheme[] = []
    for (const [cluster, members] of [...clusters.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const centroid = meanVector(members.map((index) => centres[index]!))
      const ordered = [...members].sort((a, b) => dot(centres[b]!, centroid) - dot(centres[a]!, centroid))
      const memberIds = ordered.map((index) => documents[index]!.recordId)
      const others = documents.filter((_, index) => !members.includes(index)).map((document) => termsOf(document.recordId))
      const terms = distinctiveTerms(memberIds.map(termsOf), others)
      themes.push({
        id: `theme-${cluster}-${memberIds[0]}`,
        label: terms.slice(0, 2).join(' · ') || records.get(memberIds[0]!)?.title || 'Theme',
        terms,
        recordIds: memberIds,
      })
    }
    this.themesCache = { version: this.version, themes }
    return themes
  }

  /** Extractive answers: the best-matching real passages, cited. Never generated. */
  /**
   * Extractive answers: passages ranked by meaning and by the question's own
   * words together (reciprocal rank fusion), so a paragraph that says it in
   * exactly those words is never missed. Each passage is quoted and cited.
   */
  async ask(question: string, limit = 5): Promise<LayaPassage[]> {
    const capped = Math.min(limit, LAYA_LIMITS.resultLimit)
    const documents = await this.allVectors()
    const semantic = this.scoreChunks(await this.embedQuery(question), documents).filter((item) => item.similarity >= MIN_ANSWER_SIMILARITY).slice(0, 40)
    const allWords = this.knowledge.searchParagraphs ? await this.knowledge.searchParagraphs(question, 30) : await this.knowledge.search(question, 30)
    // Only strong word matches count (a stray shared word like "oxygen" in an unrelated page does not).
    const topWord = allWords[0]?.score ?? 0
    const words = allWords.filter((hit) => hit.score >= topWord * 0.35)
    // One key per chunk: a word hit joins the chunk that covers its paragraph.
    const chunkKey = (recordId: string, paragraph: number): string | null => {
      const document = documents.find((item) => item.recordId === recordId)
      const chunk = document?.chunks.find((item) => paragraph >= item.paragraphStart && paragraph <= item.paragraphEnd)
      return chunk ? `${recordId}|${chunk.paragraphStart}` : `${recordId}|p${paragraph}`
    }
    const semanticKeys = semantic.map((item) => `${item.recordId}|${item.chunk.paragraphStart}`)
    const wordKeys = words.map((hit) => chunkKey(hit.recordId, hit.paragraphIndex)).filter((key): key is string => key !== null)
    const fused = fuseRanks([...new Set(wordKeys)], [...new Set(semanticKeys)])
    const records = new Map((await this.knowledge.list()).map((record) => [record.id, record]))
    const distinctRecords = new Set(fused.map((entry) => entry.key.split('|')[0])).size
    // With only a page or two absorbed, show several passages from each.
    const perRecordCap = distinctRecords <= 2 ? capped : 2
    const perRecord = new Map<string, number>()
    const passages: LayaPassage[] = []
    for (const entry of fused) {
      if (passages.length >= capped) break
      const recordId = entry.key.split('|')[0]!
      const record = records.get(recordId)
      if (!record || (perRecord.get(recordId) ?? 0) >= perRecordCap) continue
      const wordHit = words.find((hit) => chunkKey(hit.recordId, hit.paragraphIndex) === entry.key)
      const meaning = semantic.find((item) => `${item.recordId}|${item.chunk.paragraphStart}` === entry.key)
      let text: string
      let paragraphIndex: number
      if (wordHit) {
        const document = await this.knowledge.get(recordId).catch(() => null)
        const paragraph = document?.paragraphs[wordHit.paragraphIndex] ?? wordHit.snippet
        text = trimPassage(paragraph, question, LAYA_LIMITS.passageChars)
        paragraphIndex = wordHit.paragraphIndex
      } else if (meaning) {
        text = trimPassage(meaning.chunk.text, question, LAYA_LIMITS.passageChars)
        paragraphIndex = await this.citeParagraph(recordId, meaning.chunk, text)
      } else continue
      perRecord.set(recordId, (perRecord.get(recordId) ?? 0) + 1)
      const similarity = meaning ? Math.max(0, Math.min(1, (meaning.similarity - 0.2) / 0.6)) : 0
      passages.push({
        recordId: record.id,
        url: record.url,
        title: record.title,
        paragraphIndex,
        text,
        // A ranking signal, not a probability: meaning similarity, lifted when the words match too.
        confidence: Math.min(1, entry.matchedBy === 'both' ? Math.max(similarity, 0.55) + 0.15 : entry.matchedBy === 'words' ? Math.max(similarity, 0.45) : similarity),
      })
    }
    return passages
  }

  /** The paragraph inside the chunk's range that actually contains the passage. */
  private async citeParagraph(recordId: string, chunk: Chunk, passage: string): Promise<number> {
    if (chunk.paragraphStart === chunk.paragraphEnd) return chunk.paragraphStart
    const probe = passage.replace(/^…\s*/, '').slice(0, 60)
    const document = await this.knowledge.get(recordId).catch(() => null)
    for (let index = chunk.paragraphStart; index <= chunk.paragraphEnd; index += 1) {
      if (document?.paragraphs[index]?.replace(/\s+/g, ' ').includes(probe)) return index
    }
    return chunk.paragraphStart
  }
}

/** Offsets of the query's words inside a snippet, for highlighting. */
export function wordOffsets(snippet: string, query: string): Array<[number, number]> {
  const words = new Set(query.toLowerCase().match(/\p{L}{3,}/gu) ?? [])
  const out: Array<[number, number]> = []
  for (const match of snippet.matchAll(/\p{L}{3,}/gu)) {
    if (words.has(match[0].toLowerCase())) out.push([match.index!, match.index! + match[0].length])
  }
  return out
}
