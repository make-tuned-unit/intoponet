import { randomUUID } from 'node:crypto'
import type { ClosedTabSnapshot } from '@intoponet/browser-api'

/** A page's back/forward list, as Electron's navigationHistory gives and restores it. */
export type TabHistory = {
  entries: { url: string; title: string; pageState?: string }[]
  index: number
}

/** Where a tab was when it closed (or was archived): its workspace, and its sidebar folder there. */
export type TabPlace = { workspaceId?: string; folderId?: string }

export type ClosedTab = ClosedTabSnapshot & TabPlace & { history?: TabHistory }

export type ClosingTab = {
  url: string
  title: string
  favicon: string
  /** Private tabs are never remembered. */
  isPrivate: boolean
  history?: TabHistory
  /** The workspace it was in (null or absent for none) and its folder there. */
  workspaceId?: string | null
  folderId?: string
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

/** A workspace or folder id worth keeping with an entry (anything else is left out). */
function placeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
}

/** The workspace and folder of an entry, as far as they are well formed (a folder only with its workspace). */
export function tabPlace(place: { workspaceId?: unknown; folderId?: unknown }): TabPlace {
  if (!placeId(place.workspaceId)) return {}
  return { workspaceId: place.workspaceId, ...(placeId(place.folderId) ? { folderId: place.folderId } : {}) }
}

/**
 * Where a reopened tab (Recently closed, Archived tabs) goes: the workspace it was closed in, and its
 * folder if that is still there. With its workspace gone, or an entry that names none (kept before
 * workspaces were recorded), the workspace shown, outside any folder. `foldersOf` gives a workspace's
 * folders, or null when there is no such workspace.
 */
export function reopenPlace(entry: TabPlace, shownId: string, foldersOf: (workspaceId: string) => readonly { id: string }[] | null): { workspaceId: string; folderId?: string } {
  const folders = entry.workspaceId ? foldersOf(entry.workspaceId) : null
  if (!entry.workspaceId || !folders) return { workspaceId: shownId }
  return { workspaceId: entry.workspaceId, ...(entry.folderId && folders.some((folder) => folder.id === entry.folderId) ? { folderId: entry.folderId } : {}) }
}

/** Only web entries, at most the 50 around the current one; the index follows them. */
export function boundedHistory(history: TabHistory | undefined): TabHistory | undefined {
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
      ...tabPlace(tab),
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
