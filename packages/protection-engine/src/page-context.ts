import type { BlockingCategory } from './types'

export type PageProtectionCounters = {
  blockedAds: number
  blockedTrackers: number
}

type PageProtectionState = PageProtectionCounters & { url: string }
type PendingNavigation = {
  requestId: number
  url: string
  blockedAds: number
  blockedTrackers: number
}

type PageState = {
  committed: PageProtectionState
  pending: PendingNavigation | null
}

export class ProtectionPageContextStore {
  private readonly pages = new Map<number, PageState>()

  setCommittedUrl(webContentsId: number, url: string): void {
    const page = this.page(webContentsId)
    if (!page.pending) page.committed.url = url
  }

  beginNavigation(webContentsId: number, requestId: number, url: string): void {
    const page = this.page(webContentsId)
    if (page.pending?.requestId === requestId) {
      page.pending.url = url
      return
    }
    page.pending = { requestId, url, blockedAds: 0, blockedTrackers: 0 }
  }

  commitNavigation(webContentsId: number, url: string): void {
    const page = this.page(webContentsId)
    page.committed = page.pending
      ? {
          url,
          blockedAds: page.pending.blockedAds,
          blockedTrackers: page.pending.blockedTrackers,
        }
      : { url, blockedAds: 0, blockedTrackers: 0 }
    page.pending = null
  }

  failNavigation(webContentsId: number, failedUrl: string, committedUrl: string): void {
    const page = this.pages.get(webContentsId)
    if (!page?.pending || !sameNavigationUrl(page.pending.url, failedUrl)) return
    page.pending = null
    if (committedUrl) page.committed.url = committedUrl
  }

  topLevelUrl(webContentsId: number): string | null {
    const page = this.pages.get(webContentsId)
    return page?.pending?.url ?? page?.committed.url ?? null
  }

  recordBlocked(webContentsId: number, category: BlockingCategory): void {
    const page = this.pages.get(webContentsId)
    if (!page) return
    const counters = page.pending ?? page.committed
    if (category === 'tracker') counters.blockedTrackers += 1
    else if (category === 'ad') counters.blockedAds += 1
  }

  counters(webContentsId: number | null): PageProtectionCounters {
    const state = webContentsId === null ? undefined : this.pages.get(webContentsId)
    const counters = state?.pending ?? state?.committed
    return {
      blockedAds: counters?.blockedAds ?? 0,
      blockedTrackers: counters?.blockedTrackers ?? 0,
    }
  }

  remove(webContentsId: number): void {
    this.pages.delete(webContentsId)
  }

  private page(webContentsId: number): PageState {
    let state = this.pages.get(webContentsId)
    if (!state) {
      state = {
        committed: { url: '', blockedAds: 0, blockedTrackers: 0 },
        pending: null,
      }
      this.pages.set(webContentsId, state)
    }
    return state
  }
}

function sameNavigationUrl(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search
  } catch {
    return left === right
  }
}
