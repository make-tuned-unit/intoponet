import { randomUUID } from 'node:crypto'
import type { ClosedTabSnapshot } from '@intoponet/browser-api'

/** A page's back/forward list, as Electron's navigationHistory gives and restores it. */
export type TabHistory = {
  entries: { url: string; title: string; pageState?: string }[]
  index: number
}

export type ClosedTab = ClosedTabSnapshot & { history?: TabHistory }

export type ClosingTab = {
  url: string
  title: string
  favicon: string
  /** Private tabs are never remembered. */
  isPrivate: boolean
  history?: TabHistory
}

const MAX_HISTORY_ENTRIES = 50
/** Saved page state (scroll position, form fields) above this is dropped; the page still reopens. */
const MAX_PAGE_STATE_CHARS = 64_000

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0
  } catch {
    return false
  }
}

/** Only web entries, at most the 50 around the current one; the index follows them. */
function boundedHistory(history: TabHistory | undefined): TabHistory | undefined {
  if (!history || !Array.isArray(history.entries) || history.entries.length === 0) return undefined
  let index = Math.min(Math.max(0, Math.trunc(history.index)), history.entries.length - 1)
  const kept: TabHistory['entries'] = []
  history.entries.forEach((entry, position) => {
    if (!httpUrl(entry.url)) {
      if (position < index) index -= 1
      return
    }
    kept.push({
      url: entry.url,
      title: (entry.title ?? '').slice(0, 300),
      ...(typeof entry.pageState === 'string' && entry.pageState.length <= MAX_PAGE_STATE_CHARS ? { pageState: entry.pageState } : {}),
    })
  })
  if (kept.length === 0) return undefined
  index = Math.min(Math.max(0, index), kept.length - 1)
  const start = Math.max(0, Math.min(index - Math.floor(MAX_HISTORY_ENTRIES / 2), kept.length - MAX_HISTORY_ENTRIES))
  const entries = kept.slice(start, start + MAX_HISTORY_ENTRIES)
  return { entries, index: index - start }
}

/** Recently closed tabs for this session only (never written to disk), newest first. */
export class ClosedTabs {
  private items: ClosedTab[] = []

  constructor(private readonly limit = 25, private readonly makeId: () => string = randomUUID) {}

  /** Remembers a closing tab. Private tabs and tabs without a web page are not kept. */
  remember(tab: ClosingTab): ClosedTab | null {
    if (tab.isPrivate || !httpUrl(tab.url)) return null
    const history = boundedHistory(tab.history)
    const entry: ClosedTab = {
      id: this.makeId(),
      url: tab.url,
      title: tab.title.slice(0, 300),
      favicon: tab.favicon.length <= 80_000 ? tab.favicon : '',
      ...(history ? { history } : {}),
    }
    this.items.unshift(entry)
    if (this.items.length > this.limit) this.items.length = this.limit
    return entry
  }

  /** Takes the newest closed tab, or the one with this id, out of the list. */
  take(id?: string): ClosedTab | null {
    const index = id === undefined ? 0 : this.items.findIndex((item) => item.id === id)
    if (index < 0 || index >= this.items.length) return null
    const [entry] = this.items.splice(index, 1)
    return entry ?? null
  }

  list(): ClosedTabSnapshot[] {
    return this.items.map(({ id, url, title, favicon }) => ({ id, url, title, favicon }))
  }

  get size(): number {
    return this.items.length
  }

  clear(): void {
    this.items = []
  }
}
