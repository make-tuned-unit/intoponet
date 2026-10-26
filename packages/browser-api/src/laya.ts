/**
 * Laya (PRD §4.5 LAY-001..006, §10): optional, entirely on-device semantic
 * retrieval over absorbed pages. Nothing downloads until the user enables it;
 * the model is pinned and hash-verified; inference has no network access.
 * Answers are extractive passages with citations — never generated text.
 */
import type { KnowledgeHit } from './knowledge'

export const layaChannels = {
  command: 'intoponet:laya',
  /** Main → renderer progress and status events. */
  event: 'intoponet:laya-event',
} as const

export const LAYA_LIMITS = {
  queryLength: 500,
  textLength: 4_000,
  resultLimit: 30,
  passageChars: 400,
} as const

export type LayaModelStatus = {
  id: string
  revision: string
  sizeBytes: number
  downloaded: boolean
  verified: boolean
}

export type LayaStatus = {
  enabled: boolean
  model: LayaModelStatus
  indexedDocuments: number
  totalDocuments: number
  busy: boolean
  lastError: string | null
}

/** A knowledge search hit, with how it was found. */
export type LayaHit = KnowledgeHit & { matchedBy: 'words' | 'meaning' | 'both' }

export type LayaRelated = {
  recordId: string
  url: string
  title: string
  /** Citation into the related document's paragraphs. */
  paragraphIndex: number
  snippet: string
  /** Cosine similarity, 0..1. */
  similarity: number
}

export type LayaTheme = {
  id: string
  label: string
  terms: string[]
  /** Most central first. */
  recordIds: string[]
}

/** An extractive answer: real text from an absorbed page, cited. Never generated. */
export type LayaPassage = {
  recordId: string
  url: string
  title: string
  paragraphIndex: number
  text: string
  /** Similarity-derived 0..1; a ranking signal, not a probability of truth. */
  confidence: number
}

export type LayaProgress =
  | { type: 'download'; file: string; receivedBytes: number; totalBytes: number }
  | { type: 'verify'; file: string }
  | { type: 'embedding'; done: number; total: number; recordId: string | null }
  | { type: 'status'; status: LayaStatus }

export type LayaCommand =
  | { type: 'status' }
  | { type: 'enable' }
  | { type: 'disable'; deleteModel: boolean }
  | { type: 'search'; query: string; limit?: number }
  | { type: 'related'; recordId?: string; text?: string; limit?: number }
  | { type: 'themes' }
  | { type: 'ask'; question: string; limit?: number }
  | { type: 'backfill' }

export interface LayaApi {
  status(): Promise<LayaStatus>
  enable(): Promise<LayaStatus>
  disable(options: { deleteModel: boolean }): Promise<LayaStatus>
  search(query: string, limit?: number): Promise<LayaHit[]>
  related(input: { recordId: string } | { text: string }, limit?: number): Promise<LayaRelated[]>
  themes(): Promise<LayaTheme[]>
  ask(question: string, limit?: number): Promise<LayaPassage[]>
  backfill(): Promise<LayaStatus>
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: LayaProgress) => void): () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}.`)
  return value
}

function limit(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > LAYA_LIMITS.resultLimit) throw new Error('Invalid limit.')
  return value
}

export function parseLayaCommand(value: unknown): LayaCommand {
  if (!isRecord(value)) throw new Error('Invalid Laya command.')
  switch (value['type']) {
    case 'status':
    case 'enable':
    case 'themes':
    case 'backfill':
      return { type: value['type'] }
    case 'disable':
      if (typeof value['deleteModel'] !== 'boolean') throw new Error('Invalid Laya command.')
      return { type: 'disable', deleteModel: value['deleteModel'] }
    case 'search': {
      const n = limit(value['limit'])
      return { type: 'search', query: text(value['query'], LAYA_LIMITS.queryLength, 'query'), ...(n ? { limit: n } : {}) }
    }
    case 'ask': {
      const n = limit(value['limit'])
      return { type: 'ask', question: text(value['question'], LAYA_LIMITS.queryLength, 'question'), ...(n ? { limit: n } : {}) }
    }
    case 'related': {
      const n = limit(value['limit'])
      const hasId = value['recordId'] !== undefined
      const hasText = value['text'] !== undefined
      if (hasId === hasText) throw new Error('Give either a record or text.')
      if (hasId) {
        const id = value['recordId']
        if (typeof id !== 'string' || !/^[a-z]+-[0-9a-f]{8,64}$/.test(id)) throw new Error('Invalid record id.')
        return { type: 'related', recordId: id, ...(n ? { limit: n } : {}) }
      }
      return { type: 'related', text: text(value['text'], LAYA_LIMITS.textLength, 'text'), ...(n ? { limit: n } : {}) }
    }
    default:
      throw new Error('Invalid Laya command.')
  }
}
