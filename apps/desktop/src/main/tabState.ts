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
