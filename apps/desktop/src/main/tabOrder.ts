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

/**
 * Folders in the tab sidebar. Only unpinned tabs go in folders; folders nest (up to MAX_FOLDER_DEPTH
 * levels). The tab order always matches what the sidebar shows: pinned tabs, then each folder's
 * tabs in folder order (depth first), then the tabs in no folder. A tab moves within its own
 * folder; moving it among another folder's tabs moves it into that folder.
 */
/** `storyId`: the world story the folder was made for (Group by story), which its hover highlights. */
export type TabFolder = { id: string; name: string; parentId: string | null; collapsed?: boolean; storyId?: string }
export type FolderedTab = OrderedTab & { folderId?: string }
export const MAX_FOLDER_DEPTH = 6
export const MAX_FOLDERS = 60

/** How deep a folder sits (1 at the top), or 0 when it is not there. */
export function folderDepth(folders: readonly TabFolder[], id: string): number {
  let depth = 0
  let current = folders.find((folder) => folder.id === id)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    depth += 1
    current = current.parentId ? folders.find((folder) => folder.id === current!.parentId) : undefined
  }
  return depth
}

/** Every folder inside this one (not including it). */
export function descendantIds(folders: readonly TabFolder[], id: string): Set<string> {
  const found = new Set<string>()
  const visit = (parent: string): void => {
    for (const folder of folders) {
      if (folder.parentId === parent && !found.has(folder.id)) {
        found.add(folder.id)
        visit(folder.id)
      }
    }
  }
  visit(id)
  return found
}

/** Whether a folder may go inside `parentId` (never inside itself, never deeper than allowed). */
export function canNest(folders: readonly TabFolder[], id: string, parentId: string | null): boolean {
  if (parentId === null) return true
  if (parentId === id || descendantIds(folders, id).has(parentId) || !folders.some((folder) => folder.id === parentId)) return false
  const below = (folderId: string): number => 1 + Math.max(0, ...folders.filter((folder) => folder.parentId === folderId).map((folder) => below(folder.id)))
  return folderDepth(folders, parentId) + below(id) <= MAX_FOLDER_DEPTH
}

/** Folder ids depth first, each level in its saved order. */
export function folderTreeOrder(folders: readonly TabFolder[]): string[] {
  const order: string[] = []
  const visit = (parent: string | null): void => {
    for (const folder of folders) {
      if (folder.parentId === parent && !order.includes(folder.id)) {
        order.push(folder.id)
        visit(folder.id)
      }
    }
  }
  visit(null)
  return order
}

/** Pinned tabs, then each folder's tabs in tree order, then the rest; each group keeps its order. Tabs in a missing folder join the rest. */
export function folderedOrder<T extends FolderedTab>(tabs: readonly T[], folders: readonly TabFolder[]): T[] {
  const tree = folderTreeOrder(folders)
  const known = new Set(tree)
  const loose = (tab: T): boolean => !tab.folderId || !known.has(tab.folderId)
  return [
    ...tabs.filter((tab) => tab.pinned),
    ...tree.flatMap((folderId) => tabs.filter((tab) => !tab.pinned && tab.folderId === folderId)),
    ...tabs.filter((tab) => !tab.pinned && loose(tab)),
  ]
}

/**
 * Move a tab among foldered tabs: to `toIndex` in the whole order. Dropped among another folder's
 * tabs (or among tabs in no folder), it joins that group. Mutates; false when nothing changed.
 */
export function moveFolderedTab<T extends FolderedTab>(tabs: T[], folders: readonly TabFolder[], id: string, toIndex: number): boolean {
  const from = tabs.findIndex((tab) => tab.id === id)
  if (from < 0) return false
  const tab = tabs[from]!
  if (tab.pinned) return moveTab(tabs, id, toIndex)
  const to = Math.min(tabs.length - 1, Math.max(0, Math.round(toIndex)))
  const target = tabs[to]
  const before = tab.folderId
  if (target && target !== tab && !target.pinned) {
    if (target.folderId) tab.folderId = target.folderId
    else delete tab.folderId
  }
  const reordered = [...tabs]
  reordered.splice(from, 1)
  reordered.splice(Math.max(tabs.filter((item) => item.pinned).length, to), 0, tab)
  const next = folderedOrder(reordered, folders)
  const changed = before !== tab.folderId || next.some((item, index) => item !== tabs[index])
  tabs.splice(0, tabs.length, ...next)
  return changed
}

/** Opens a folder and every folder it is in, so its tabs show in the sidebar. Mutates; true when one was collapsed. */
export function revealFolder(folders: TabFolder[], id: string): boolean {
  let changed = false
  const seen = new Set<string>()
  for (let folder = folders.find((item) => item.id === id); folder && !seen.has(folder.id); folder = folders.find((item) => item.id === folder!.parentId)) {
    seen.add(folder.id)
    if (folder.collapsed) {
      delete folder.collapsed
      changed = true
    }
  }
  return changed
}

/** Puts a tab in a folder (or none), at the end of it. Pinned tabs stay out of folders. */
export function setTabFolder<T extends FolderedTab>(tabs: T[], folders: readonly TabFolder[], id: string, folderId: string | null): boolean {
  const tab = tabs.find((item) => item.id === id)
  if (!tab || tab.pinned || (folderId !== null && !folders.some((folder) => folder.id === folderId))) return false
  if ((tab.folderId ?? null) === folderId) return false
  if (folderId) tab.folderId = folderId
  else delete tab.folderId
  // Last in its new folder.
  const rest = tabs.filter((item) => item !== tab)
  const next = folderedOrder([...rest, tab], folders)
  tabs.splice(0, tabs.length, ...next)
  return true
}

/** Deletes a folder: its folders move up a level and its tabs into its parent (or out of folders). */
export function deleteFolder<T extends FolderedTab>(tabs: T[], folders: TabFolder[], id: string): boolean {
  const folder = folders.find((item) => item.id === id)
  if (!folder) return false
  for (const child of folders) if (child.parentId === id) child.parentId = folder.parentId
  for (const tab of tabs) {
    if (tab.folderId !== id) continue
    if (folder.parentId) tab.folderId = folder.parentId
    else delete tab.folderId
  }
  folders.splice(folders.indexOf(folder), 1)
  tabs.splice(0, tabs.length, ...folderedOrder(tabs, folders))
  return true
}
