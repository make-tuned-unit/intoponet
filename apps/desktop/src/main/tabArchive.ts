import { randomUUID } from 'node:crypto'
import { TAB_ARCHIVE_AFTER, type ArchivedTabSnapshot, type TabArchiveAfter } from '@intoponet/browser-api'
import { boundedHistory, type TabHistory } from './closedTabs'

/**
 * Tabs that tidy themselves away: an unpinned tab not looked at for the chosen time closes into
 * Archived tabs, with its back/forward list, and can be found from the address bar and reopened
 * where it was. Private tabs never reach the archive. It is kept like history (sealed on disk,
 * cleared with it) and holds at most the newest 300 tabs for at most 90 days.
 */

const HOUR = 3_600_000
const AFTER_HOURS: Record<TabArchiveAfter, number | null> = { off: null, '12h': 12, '1d': 24, '1w': 168, '30d': 720 }
export const DEFAULT_TAB_ARCHIVE: TabArchiveAfter = 'off'
const MAX_ARCHIVED = 300
const MAX_AGE_MS = 90 * 24 * HOUR

/** How long an unpinned tab waits before being archived, or null when archiving is off. `hourMs` is shortened only by checks. */
export function archiveAfterMs(after: TabArchiveAfter, hourMs = HOUR): number | null {
  const hours = AFTER_HOURS[after]
  return hours === null ? null : hours * hourMs
}

export function isTabArchiveAfter(value: unknown): value is TabArchiveAfter {
  return typeof value === 'string' && (TAB_ARCHIVE_AFTER as readonly string[]).includes(value)
}

export type ArchivedTab = ArchivedTabSnapshot & { history?: TabHistory }

function webUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_192) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export class TabArchive {
  private entries: ArchivedTab[] = []

  constructor(private readonly now: () => number = Date.now) {}

  /** Newest first, without their back/forward lists. */
  list(): ArchivedTabSnapshot[] {
    return this.entries.map(({ history: _history, ...entry }) => entry)
  }

  get size(): number {
    return this.entries.length
  }

  /** Archives a tab (one entry per address: archiving it again moves it to the top). */
  add(tab: { url: string; title: string; favicon: string; history?: TabHistory }): ArchivedTab | null {
    if (!webUrl(tab.url)) return null
    const history = boundedHistory(tab.history)
    const entry: ArchivedTab = {
      id: randomUUID(),
      url: tab.url,
      title: tab.title.slice(0, 300),
      favicon: tab.favicon.startsWith('data:image/') && tab.favicon.length <= 64_000 ? tab.favicon : '',
      archivedAt: this.now(),
      ...(history ? { history } : {}),
    }
    this.entries = [entry, ...this.entries.filter((item) => item.url !== tab.url)].slice(0, MAX_ARCHIVED)
    return entry
  }

  /** Takes an entry out to reopen it. */
  take(id: string): ArchivedTab | null {
    const entry = this.entries.find((item) => item.id === id) ?? null
    if (entry) this.entries = this.entries.filter((item) => item !== entry)
    return entry
  }

  /** History cleared since `since` (ms): archived tabs from then on go too. */
  deleteSince(since: number): void {
    this.entries = this.entries.filter((entry) => entry.archivedAt < since)
  }

  prune(): void {
    const oldest = this.now() - MAX_AGE_MS
    this.entries = this.entries.filter((entry) => entry.archivedAt >= oldest)
  }

  serialize(): string {
    return JSON.stringify({ schema: 'intoponet.tab-archive.v1', entries: this.entries })
  }

  /**
   * A saved payload; anything unreadable or out of bounds is left out, and so is anything `keep` refuses
   * (removed while the file was still unread). Returns false when the payload as a whole could not be read,
   * so the caller can keep that file rather than save over it.
   */
  load(payload: string | null, keep: (entry: ArchivedTab) => boolean = () => true): boolean {
    if (!payload) return true
    let raw: unknown
    try {
      raw = JSON.parse(payload)
    } catch {
      return false
    }
    const entries = (raw as { schema?: unknown; entries?: unknown })?.schema === 'intoponet.tab-archive.v1' ? (raw as { entries: unknown }).entries : null
    if (!Array.isArray(entries)) return false
    const loaded: ArchivedTab[] = []
    for (const item of entries.slice(0, MAX_ARCHIVED)) {
      const record = item as Record<string, unknown>
      if (typeof record !== 'object' || record === null || typeof record['id'] !== 'string' || record['id'].length > 80 || !webUrl(record['url']) ||
          typeof record['title'] !== 'string' || typeof record['favicon'] !== 'string' || typeof record['archivedAt'] !== 'number' || !Number.isFinite(record['archivedAt'])) continue
      const history = boundedHistory(record['history'] as TabHistory | undefined)
      loaded.push({
        id: record['id'],
        url: record['url'],
        title: record['title'].slice(0, 300),
        favicon: record['favicon'].startsWith('data:image/') && record['favicon'].length <= 64_000 ? record['favicon'] : '',
        archivedAt: record['archivedAt'],
        ...(history ? { history } : {}),
      })
    }
    const urls = new Set(this.entries.map((entry) => entry.url))
    this.entries = [...this.entries, ...loaded.filter((entry) => !urls.has(entry.url) && keep(entry))].sort((a, b) => b.archivedAt - a.archivedAt).slice(0, MAX_ARCHIVED)
    this.prune()
    return true
  }
}
