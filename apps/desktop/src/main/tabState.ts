/** What a tab's page is doing right now, as the tab strip shows it (see PageTabSnapshot). */
export type LiveTabFlags = { loading?: true; audible?: true; muted?: true; pinned?: true }

/** The page side of a tab: a webContents, or nothing once it has closed. */
export type TabContentsLike = {
  isLoading(): boolean
  isCurrentlyAudible(): boolean
  isAudioMuted(): boolean
}

/**
 * Only the flags that are on, so snapshots of quiet tabs stay as small as before. `mutedUntilShown`: the
 * page is muted only while it loads out of sight (backgroundLoad.ts), not by the person: not shown as muted.
 */
export function liveTabFlags(contents: TabContentsLike | null, tab: { start?: boolean; pinned?: boolean }, mutedUntilShown = false): LiveTabFlags {
  return {
    ...(contents && !tab.start && contents.isLoading() ? { loading: true as const } : {}),
    ...(contents?.isCurrentlyAudible() ? { audible: true as const } : {}),
    ...(contents?.isAudioMuted() && !mutedUntilShown ? { muted: true as const } : {}),
    ...(tab.pinned ? { pinned: true as const } : {}),
  }
}

/**
 * Which address browser-state.v1.json records as the open page. Only tabs that may be saved
 * (never private ones) are candidates, so a private tab's address never reaches the disk even
 * when it is the active tab or the last page shown.
 */
export function persistedActiveUrl(savedTabs: readonly { id: string; url: string }[], activeTabId: string | null, lastKnownUrl: string): string {
  const active = savedTabs.find((tab) => tab.id === activeTabId)
  if (active) return active.url
  return savedTabs.find((tab) => sameAddress(tab.url, lastKnownUrl))?.url ?? savedTabs[0]?.url ?? ''
}

/**
 * The tab shown again after a restart: the one saved as shown (by id, so of two tabs at one address
 * the right one comes back), else the first at the saved address, else the first tab.
 */
export function restoredActiveTab<T extends { id: string; url: string }>(tabs: readonly T[], activeTabId: string | undefined, url: string): T | undefined {
  return tabs.find((tab) => tab.id === activeTabId) ?? tabs.find((tab) => sameAddress(tab.url, url)) ?? tabs[0]
}

/** Longest page address sent to the app window or saved; longer ones lose their query, then their path. */
export const MAX_SNAPSHOT_URL = 8 * 1024
export const MAX_SNAPSHOT_TITLE = 512

export function capUrl(url: string): string {
  if (url.length <= MAX_SNAPSHOT_URL) return url
  try {
    const parsed = new URL(url)
    const withoutQuery = `${parsed.origin}${parsed.pathname}`
    if (withoutQuery.length <= MAX_SNAPSHOT_URL) return withoutQuery
    return parsed.origin.length < MAX_SNAPSHOT_URL ? `${parsed.origin}/` : ''
  } catch {
    return ''
  }
}

export function capTitle(title: string): string {
  return title.length <= MAX_SNAPSHOT_TITLE ? title : title.slice(0, MAX_SNAPSHOT_TITLE)
}

/**
 * Run `send` at most once per `ms`: the first call goes at once, calls during the pause are
 * folded into one more at its end. Pages can fire title, favicon and navigation events as fast
 * as they like; the app window gets at most one update per frame.
 */
export function coalesce(send: () => void, ms = 16, later: (run: () => void, ms: number) => unknown = setTimeout): () => void {
  let waiting = false
  let again = false
  const reopen = (): void => {
    if (!again) {
      waiting = false
      return
    }
    again = false
    send()
    later(reopen, ms)
  }
  return () => {
    if (waiting) {
      again = true
      return
    }
    waiting = true
    send()
    later(reopen, ms)
  }
}

function sameAddress(left: string, right: string): boolean {
  if (!left || !right) return false
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '') && a.search === b.search
  } catch {
    return left === right
  }
}
