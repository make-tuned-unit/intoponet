import type { TabFolder } from './tabOrder'

/**
 * Grouping loose tabs into folders (Group by story, and accepted Tidy suggestions), and undoing
 * the last grouping. Pure: the caller applies the result to its own tab and folder state.
 * Pinned and private tabs are never moved.
 */

export type GroupRequest = { name: string; tabIds: string[]; storyId?: string }

export type GroupableTab = { id: string; pinned?: boolean | undefined; isPrivate?: boolean | undefined; folderId?: string | undefined }

/** What the grouping changed, enough to take it back. */
export type GroupingSnapshot = {
  /** Tab ids in their order before the grouping. */
  order: string[]
  /** Each open tab's folder before the grouping. */
  folderOf: Array<[string, string | undefined]>
  /** Each folder's story before the grouping (reused folders may have gained one). */
  storyOf: Array<[string, string | undefined]>
  /** Folders the grouping made, removed again on undo. */
  created: string[]
}

export const UNDO_GROUPING_MS = 120_000

export type GroupingPlan = {
  folders: TabFolder[]
  /** The folder each moved tab goes to. */
  folderOf: Map<string, string>
  created: string[]
}

/** The folder a group goes in: the one for its story, else one with the same name, else a new one (never past maxFolders). */
export function planGrouping(input: {
  tabs: readonly GroupableTab[]
  folders: readonly TabFolder[]
  groups: readonly GroupRequest[]
  maxFolders: number
  newId: () => string
}): GroupingPlan {
  const folders = input.folders.map((folder) => ({ ...folder }))
  const tabs = new Map(input.tabs.map((tab) => [tab.id, tab]))
  const folderOf = new Map<string, string>()
  const created: string[] = []
  for (const group of input.groups) {
    const movable = group.tabIds
      .map((id) => tabs.get(id))
      .filter((tab): tab is GroupableTab => !!tab && !tab.pinned && !tab.isPrivate)
    if (!movable.length) continue
    let folder = group.storyId ? folders.find((item) => item.storyId === group.storyId) : undefined
    folder ??= folders.find((item) => item.name === group.name && (!item.storyId || item.storyId === group.storyId))
    if (!folder) {
      if (folders.length >= input.maxFolders) continue
      folder = { id: input.newId(), name: group.name, parentId: null, ...(group.storyId ? { storyId: group.storyId } : {}) }
      folders.push(folder)
      created.push(folder.id)
    } else if (group.storyId && !folder.storyId) {
      folder.storyId = group.storyId
    }
    for (const tab of movable) folderOf.set(tab.id, folder.id)
  }
  return { folders, folderOf, created }
}

/** The state a grouping is about to change, to restore with undoGrouping. */
export function snapshotGrouping(tabs: readonly GroupableTab[], folders: readonly TabFolder[], created: string[]): GroupingSnapshot {
  return {
    order: tabs.map((tab) => tab.id),
    folderOf: tabs.map((tab) => [tab.id, tab.folderId]),
    storyOf: folders.map((folder) => [folder.id, folder.storyId]),
    created,
  }
}

/**
 * Put the tabs and folders back as the snapshot has them: the folders the grouping made are
 * removed (their subfolders move to the top), folder stories and each tab's folder are restored,
 * and the tab order is restored. Mutates both arrays. Tabs opened since the grouping keep their
 * place at the end.
 */
export function undoGrouping<T extends GroupableTab>(tabs: T[], folders: TabFolder[], snapshot: GroupingSnapshot): void {
  const removed = new Set(snapshot.created)
  for (let index = folders.length - 1; index >= 0; index -= 1) if (removed.has(folders[index]!.id)) folders.splice(index, 1)
  for (const folder of folders) if (folder.parentId && removed.has(folder.parentId)) folder.parentId = null
  for (const [id, story] of snapshot.storyOf) {
    const folder = folders.find((item) => item.id === id)
    if (!folder) continue
    if (story === undefined) delete folder.storyId
    else folder.storyId = story
  }
  const saved = new Map(snapshot.folderOf)
  for (const tab of tabs) {
    if (saved.has(tab.id)) {
      const folderId = saved.get(tab.id)
      if (folderId === undefined) delete tab.folderId
      else tab.folderId = folderId
    }
    if (tab.folderId && (removed.has(tab.folderId) || !folders.some((folder) => folder.id === tab.folderId))) delete tab.folderId
  }
  const position = new Map(snapshot.order.map((id, index) => [id, index]))
  const rank = (id: string): number => position.get(id) ?? Number.MAX_SAFE_INTEGER
  const sorted = tabs.map((tab, index) => ({ tab, index })).sort((a, b) => rank(a.tab.id) - rank(b.tab.id) || a.index - b.index).map(({ tab }) => tab)
  tabs.splice(0, tabs.length, ...sorted)
}
