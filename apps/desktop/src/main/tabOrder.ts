/**
 * Tab order rules, kept apart from Electron so they can be tested: pinned tabs always sit first,
 * a tab only moves within its own group, and "close others / to the right" never take pinned tabs.
 */
export type OrderedTab = { id: string; pinned?: boolean }

/** Pinned tabs first, each group keeping its order. */
export function pinnedFirst<T extends OrderedTab>(tabs: readonly T[]): T[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)]
}

/** Where a tab may go: pinned tabs within the pinned group, the others after it. */
export function allowedRange(tabs: readonly OrderedTab[], pinned: boolean): { min: number; max: number } {
  const pinnedCount = tabs.filter((tab) => tab.pinned).length
  return pinned ? { min: 0, max: Math.max(0, pinnedCount - 1) } : { min: pinnedCount, max: Math.max(pinnedCount, tabs.length - 1) }
}

/**
 * Move one tab to `toIndex` (its index after the move), clamped to its group.
 * Mutates and returns the array; returns false when nothing moved.
 */
export function moveTab<T extends OrderedTab>(tabs: T[], id: string, toIndex: number): boolean {
  const from = tabs.findIndex((tab) => tab.id === id)
  if (from < 0) return false
  const tab = tabs[from]!
  const { min, max } = allowedRange(tabs, tab.pinned === true)
  const to = Math.min(max, Math.max(min, Math.round(toIndex)))
  if (to === from) return false
  tabs.splice(from, 1)
  tabs.splice(to, 0, tab)
  return true
}

/**
 * Pin or unpin a tab. A newly pinned tab goes to the end of the pinned group; an unpinned tab
 * goes to the start of the others (next to where it was). Mutates; false when nothing changed.
 */
export function setPinned<T extends OrderedTab>(tabs: T[], id: string, pinned: boolean): boolean {
  const from = tabs.findIndex((tab) => tab.id === id)
  if (from < 0) return false
  const tab = tabs[from]!
  if ((tab.pinned === true) === pinned) return false
  tabs.splice(from, 1)
  const pinnedCount = tabs.filter((item) => item.pinned).length
  if (pinned) tab.pinned = true
  else delete tab.pinned
  tabs.splice(pinnedCount, 0, tab)
  return true
}

/** Tabs "Close Other Tabs" closes: every tab but this one, except pinned tabs. */
export function otherTabIds(tabs: readonly OrderedTab[], keepId: string): string[] {
  return tabs.filter((tab) => tab.id !== keepId && !tab.pinned).map((tab) => tab.id)
}

/** Tabs "Close Tabs to the Right" closes (pinned tabs stay). */
export function tabIdsToRight(tabs: readonly OrderedTab[], id: string): string[] {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return []
  return tabs.slice(index + 1).filter((tab) => !tab.pinned).map((tab) => tab.id)
}

/** Where a duplicate goes: right after its source (a duplicate of a pinned tab starts unpinned, first among the others). */
export function duplicateIndex(tabs: readonly OrderedTab[], sourceId: string): number {
  const index = tabs.findIndex((tab) => tab.id === sourceId)
  if (index < 0) return tabs.length
  const source = tabs[index]!
  return source.pinned ? tabs.filter((tab) => tab.pinned).length : index + 1
}
