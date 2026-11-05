/**
 * Browsing history: pages visited in normal tabs, kept sealed on this Mac. Private tabs, sites
 * left out (Privacy › Sites to leave out) and browsing with footprints off are never recorded.
 * Retention follows the footprint retention setting.
 */
export const historyChannels = {
  command: 'intoponet:history',
  event: 'intoponet:history-event',
} as const

export type HistoryVisit = {
  id: string
  url: string
  title: string
  /** Host for the site icon ("en.wikipedia.org"). */
  host: string
  /** Epoch milliseconds. */
  visitedAt: number
}

/** One local calendar day of results, newest first. `day` is "YYYY-MM-DD" in this Mac's time zone. */
export type HistoryDay = { day: string; visits: HistoryVisit[] }

export type HistorySearchResult = {
  days: HistoryDay[]
  /** Pass back as `cursor` for the next page; null at the end. */
  nextCursor: number | null
  total: number
}

export type HistoryRetentionDays = 0 | 7 | 30 | 90
export type HistoryPolicy = { footprints: boolean; retentionDays: HistoryRetentionDays }

export type ClearRange = 'hour' | 'day' | 'week' | 'all'
export type ClearBrowsingDataRequest = {
  range: ClearRange
  history: boolean
  /** Cookies and site data (local storage, IndexedDB, service workers…). */
  siteData: boolean
  cache: boolean
  downloads: boolean
}
export type ClearBrowsingDataResult = {
  /** Visits since this time (epoch ms) were removed; 0 means all time. */
  since: number
  cleared: string[]
  /** Something that could not be done exactly as asked (e.g. cache is cleared for all time). */
  notes: string[]
}

export type HistoryCommand =
  | { type: 'search'; query: string; cursor: number; limit: number }
  | { type: 'delete'; ids: string[] }
  | { type: 'delete-day'; day: string }
  | { type: 'clear' }
  | { type: 'set-policy'; policy: HistoryPolicy }
  | { type: 'clear-browsing-data'; request: ClearBrowsingDataRequest }

export type HistoryEvent =
  /** Open the History view (⌘Y from the app menu). */
  | { type: 'open' }
  /** Visits were added or removed. */
  | { type: 'changed' }

export interface HistoryApi {
  search(query: string, options?: { cursor?: number; limit?: number }): Promise<HistorySearchResult>
  delete(ids: string[]): Promise<void>
  deleteDay(day: string): Promise<void>
  clear(): Promise<void>
  setPolicy(policy: HistoryPolicy): Promise<void>
  clearBrowsingData(request: ClearBrowsingDataRequest): Promise<ClearBrowsingDataResult>
  subscribe(listener: (event: HistoryEvent) => void): () => void
}

const RANGES: ClearRange[] = ['hour', 'day', 'week', 'all']
const RETENTION = [0, 7, 30, 90]

/** How far back a clear range reaches (0 = all time). */
export function clearRangeStart(range: ClearRange, now: number): number {
  switch (range) {
    case 'hour': return now - 3_600_000
    case 'day': return now - 86_400_000
    case 'week': return now - 7 * 86_400_000
    case 'all': return 0
  }
}

export function parseHistoryCommand(value: unknown): HistoryCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid history command.')
  const v = value as Record<string, unknown>
  switch (v['type']) {
    case 'search': {
      const query = v['query']
      const cursor = v['cursor']
      const limit = v['limit']
      if (typeof query !== 'string' || query.length > 500) break
      if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0 || cursor > 1_000_000) break
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500) break
      return { type: 'search', query, cursor, limit }
    }
    case 'delete': {
      const ids = v['ids']
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1_000 || !ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id))) break
      return { type: 'delete', ids: ids as string[] }
    }
    case 'delete-day':
      if (typeof v['day'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v['day'])) break
      return { type: 'delete-day', day: v['day'] }
    case 'clear':
      return { type: 'clear' }
    case 'set-policy': {
      const policy = v['policy'] as Record<string, unknown> | null
      if (typeof policy !== 'object' || policy === null || typeof policy['footprints'] !== 'boolean' || !RETENTION.includes(policy['retentionDays'] as number)) break
      return { type: 'set-policy', policy: { footprints: policy['footprints'], retentionDays: policy['retentionDays'] as HistoryRetentionDays } }
    }
    case 'clear-browsing-data': {
      const r = v['request'] as Record<string, unknown> | null
      if (typeof r !== 'object' || r === null || !RANGES.includes(r['range'] as ClearRange)) break
      const flags = ['history', 'siteData', 'cache', 'downloads'] as const
      if (!flags.every((flag) => typeof r[flag] === 'boolean')) break
      return {
        type: 'clear-browsing-data',
        request: { range: r['range'] as ClearRange, history: r['history'] as boolean, siteData: r['siteData'] as boolean, cache: r['cache'] as boolean, downloads: r['downloads'] as boolean },
      }
    }
  }
  throw new Error('Invalid history command.')
}
