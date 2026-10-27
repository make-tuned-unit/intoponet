/**
 * Absorb and local knowledge (PRD §4.5, §10). A page is absorbed only when the
 * user asks, after a preview. Its readable text is extracted on this device,
 * stored encrypted, and searchable offline with paragraph citations. Nothing
 * here is sent anywhere; page content is data, never instructions.
 */

export const knowledgeChannels = {
  command: 'intoponet:knowledge',
} as const

export const KNOWLEDGE_LIMITS = {
  records: 500,
  documentBytes: 5 * 1024 * 1024,
  paragraphs: 2_000,
  textChars: 200_000,
  previewParagraphs: 8,
  previewEntities: 24,
  previewDates: 12,
  noteLength: 2_000,
  titleLength: 300,
  queryLength: 300,
  searchLimit: 50,
  previewTtlMs: 5 * 60 * 1000,
} as const

export type KnowledgeEntity = { text: string; kind: 'place' | 'name' | 'term'; count: number }
export type KnowledgePlace = { name: string; countryCode: string; lat: number; lon: number; count: number }
export type KnowledgeDate = { text: string; iso: string | null }
export type AbsorbScope = 'article' | 'selection'

export type AbsorbPreview = {
  previewId: string
  url: string
  title: string
  siteName: string | null
  lang: string | null
  publishedAt: string | null
  scope: AbsorbScope
  wordCount: number
  paragraphCount: number
  /** The first few paragraphs, for the preview sheet. */
  paragraphs: string[]
  entities: KnowledgeEntity[]
  places: KnowledgePlace[]
  dates: KnowledgeDate[]
  linkCount: number
  selectionAvailable: boolean
}

export type AbsorbRefusal = { refused: true; reason: string }

export type KnowledgeRecord = {
  id: string
  url: string
  title: string
  siteName: string | null
  lang: string | null
  publishedAt: string | null
  absorbedAt: string
  scope: AbsorbScope
  wordCount: number
  paragraphCount: number
  entities: KnowledgeEntity[]
  places: KnowledgePlace[]
  dates: KnowledgeDate[]
  note: string | null
}

export type KnowledgeDocument = KnowledgeRecord & { paragraphs: string[] }

export type KnowledgeHit = {
  recordId: string
  url: string
  title: string
  /** Citation: index into the document's paragraphs. */
  paragraphIndex: number
  snippet: string
  /** [start, end) offsets of matched terms inside `snippet`. */
  matches: Array<[number, number]>
  score: number
}

export type KnowledgeCommand =
  | { type: 'preview'; scope: AbsorbScope }
  | { type: 'commit'; previewId: string; removeEntities?: string[]; note?: string }
  | { type: 'cancel'; previewId: string }
  | { type: 'list' }
  | { type: 'get'; id: string }
  | { type: 'search'; query: string; limit?: number }
  | { type: 'remove'; id: string }
  | { type: 'update'; id: string; note?: string | null; removeEntities?: string[]; title?: string }
  | { type: 'reindex'; id: string }
  | { type: 'remove-all' }
  | { type: 'export' }

export interface KnowledgeApi {
  preview(scope: AbsorbScope): Promise<AbsorbPreview | AbsorbRefusal>
  commit(previewId: string, options?: { removeEntities?: string[]; note?: string }): Promise<KnowledgeRecord>
  cancel(previewId: string): Promise<void>
  list(): Promise<KnowledgeRecord[]>
  get(id: string): Promise<KnowledgeDocument>
  search(query: string, limit?: number): Promise<KnowledgeHit[]>
  remove(id: string): Promise<void>
  update(id: string, patch: { note?: string | null; removeEntities?: string[]; title?: string }): Promise<KnowledgeRecord>
  reindex(id: string): Promise<KnowledgeRecord>
  removeAll(): Promise<void>
  /** Every absorbed page with its text, places and citations, as JSON-LD (schema.org). */
  exportAll(): Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isKnowledgeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]+-[0-9a-f]{8,64}$/.test(value)
}

function parseId(value: unknown, kind = 'knowledge'): string {
  if (!isKnowledgeId(value)) throw new Error(`Invalid ${kind} id.`)
  return value
}

function parseEntityList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid entity list.')
  return value.map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 200) throw new Error('Invalid entity.')
    return item
  })
}

function parseScope(value: unknown): AbsorbScope {
  if (value === 'article' || value === 'selection') return value
  throw new Error('Invalid absorb scope.')
}

export function parseKnowledgeCommand(value: unknown): KnowledgeCommand {
  if (!isRecord(value) || typeof value['type'] !== 'string') throw new Error('Invalid knowledge command.')
  switch (value['type']) {
    case 'preview':
      return { type: 'preview', scope: parseScope(value['scope']) }
    case 'commit': {
      const command: KnowledgeCommand = { type: 'commit', previewId: parseId(value['previewId'], 'preview') }
      if (value['removeEntities'] !== undefined) command.removeEntities = parseEntityList(value['removeEntities'])
      if (value['note'] !== undefined) {
        if (typeof value['note'] !== 'string' || value['note'].length > KNOWLEDGE_LIMITS.noteLength) throw new Error('Invalid note.')
        command.note = value['note']
      }
      return command
    }
    case 'cancel':
      return { type: 'cancel', previewId: parseId(value['previewId'], 'preview') }
    case 'list':
    case 'export':
    case 'remove-all':
      return { type: value['type'] }
    case 'get':
    case 'remove':
    case 'reindex':
      return { type: value['type'], id: parseId(value['id']) }
    case 'search': {
      const query = value['query']
      if (typeof query !== 'string' || query.length > KNOWLEDGE_LIMITS.queryLength) throw new Error('Invalid search.')
      const command: KnowledgeCommand = { type: 'search', query }
      if (value['limit'] !== undefined) {
        const limit = value['limit']
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > KNOWLEDGE_LIMITS.searchLimit) throw new Error('Invalid limit.')
        command.limit = limit
      }
      return command
    }
    case 'update': {
      const command: KnowledgeCommand = { type: 'update', id: parseId(value['id']) }
      if ('note' in value) {
        const note = value['note']
        if (note !== null && (typeof note !== 'string' || note.length > KNOWLEDGE_LIMITS.noteLength)) throw new Error('Invalid note.')
        command.note = note as string | null
      }
      if (value['removeEntities'] !== undefined) command.removeEntities = parseEntityList(value['removeEntities'])
      if (value['title'] !== undefined) {
        const title = value['title']
        if (typeof title !== 'string' || !title.trim() || title.length > KNOWLEDGE_LIMITS.titleLength) throw new Error('Invalid title.')
        command.title = title.trim()
      }
      return command
    }
    default:
      throw new Error('Unknown knowledge command.')
  }
}
