/** A blank page view getting a tab's back/forward list back (a sleeping tab waking, a crashed page loading again). */
export interface HistoryRestore {
  /** Restores the list and loads its current entry (Electron's `navigationHistory.restore`); may throw before it starts. */
  restore(): Promise<unknown>
  /** Whether the view is gone or a page has arrived in it since the restore began (a click, an address typed, an error page). */
  navigatedSince(): boolean
  /** Loads the tab's own address instead. */
  load(): Promise<unknown>
}

/**
 * Restores the list, falling back to the tab's address only when the list could not be restored at
 * all and nothing has navigated since. Electron's restore also fails when a newer navigation fails (an
 * address typed while the old page was still coming back): that page's error, or any page that
 * arrived meanwhile, is never replaced by the old address.
 */
export async function restoreHistoryOrLoad(target: HistoryRestore): Promise<'restored' | 'kept' | 'loaded'> {
  try {
    await target.restore()
    return 'restored'
  } catch {
    if (target.navigatedSince()) return 'kept'
    await target.load().catch(() => undefined)
    return 'loaded'
  }
}
