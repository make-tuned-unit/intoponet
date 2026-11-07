import { folderTreeOrder, type TabFolder } from './tabOrder'
import type { TabSplit } from './splitPages'

/**
 * Grouping loose tabs into folders (Group by story, and accepted Tidy suggestions), and undoing
 * the last grouping. Pure: the caller applies the result to its own tab and folder state.
 * Pinned and private tabs are never moved.
 */

export type GroupRequest = { name: string; tabIds: string[]; storyId?: string }

export type GroupableTab = { id: string; pinned?: boolean | undefined; isPrivate?: boolean | undefined; folderId?: string | undefined; split?: TabSplit | undefined }

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
  /** Pairs side by side before the grouping (moving one side into a folder ends a pair; undo brings it back). */
  splitOf?: Array<[string, TabSplit]>
}

export const UNDO_GROUPING_MS = 120_000

export type GroupingPlan = {
  folders: TabFolder[]
  /** The folder each moved tab goes to. */
  folderOf: Map<string, string>
  created: string[]
}

/**
 * The folder a group goes in: the one for its story, else one with the same name, else a new one (never past maxFolders).
 * A tab side by side with another moves only when both sides go into the same folder; otherwise both stay where they
 * are, and a folder that ends up with nothing to hold is neither made nor given a story.
 */
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
  /** Folders given a story by this grouping. */
  const adopted = new Set<string>()
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
      adopted.add(folder.id)
    }
    for (const tab of movable) folderOf.set(tab.id, folder.id)
  }
  // A pair is one row of the sidebar: moving one side alone would end it.
  const destination = (tab: GroupableTab): string | undefined => folderOf.get(tab.id) ?? tab.folderId
  for (const id of [...folderOf.keys()]) {
    const tab = tabs.get(id)!
    const partner = tab.split ? tabs.get(tab.split.partnerId) : undefined
    if (!partner || partner.split?.partnerId !== id) continue
    if (destination(partner) !== destination(tab)) folderOf.delete(id)
  }
  const used = new Set(folderOf.values())
  for (const folder of folders) if (adopted.has(folder.id) && !used.has(folder.id)) delete folder.storyId
  return {
    folders: folders.filter((folder) => used.has(folder.id) || !created.includes(folder.id)),
    folderOf,
    created: created.filter((id) => used.has(id)),
  }
}

/** The state a grouping is about to change, to restore with undoGrouping. */
export function snapshotGrouping(tabs: readonly GroupableTab[], folders: readonly TabFolder[], created: string[]): GroupingSnapshot {
  return {
    order: tabs.map((tab) => tab.id),
    folderOf: tabs.map((tab) => [tab.id, tab.folderId]),
    storyOf: folders.map((folder) => [folder.id, folder.storyId]),
    created,
    splitOf: tabs.flatMap((tab): Array<[string, TabSplit]> => (tab.split ? [[tab.id, { ...tab.split }]] : [])),
  }
}

/**
 * Put the tabs and folders back as the snapshot has them: the folders the grouping made are
 * removed (their subfolders move to the top), folder stories and each tab's folder are restored,
 * pairs the grouping pulled apart are paired again, and the tab order is restored (pinned tabs first,
 * then each folder's tabs, then the rest, as the sidebar shows them). Mutates both arrays. Tabs
 * opened since the grouping go at the end of their group.
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
  // A pair the grouping ended comes back when both sides are still here and neither was paired since.
  const savedSplit = new Map(snapshot.splitOf ?? [])
  for (const [id, split] of savedSplit) {
    const tab = tabs.find((item) => item.id === id)
    const partner = tabs.find((item) => item.id === split.partnerId)
    if (!tab || !partner || tab.split || partner.split || savedSplit.get(partner.id)?.partnerId !== id) continue
    tab.split = { ...split }
    partner.split = { ...savedSplit.get(partner.id)! }
  }
  const position = new Map(snapshot.order.map((id, index) => [id, index]))
  const rank = (id: string): number => position.get(id) ?? Number.MAX_SAFE_INTEGER
  // The sidebar's order (tabOrder.ts folderedOrder): tabs pinned or moved into a folder since stay in their group.
  const tree = folderTreeOrder(folders)
  const group = (tab: T): number => (tab.pinned ? -1 : tab.folderId && tree.includes(tab.folderId) ? tree.indexOf(tab.folderId) : tree.length)
  const sorted = tabs.map((tab, index) => ({ tab, index }))
    .sort((a, b) => group(a.tab) - group(b.tab) || rank(a.tab.id) - rank(b.tab.id) || a.index - b.index)
    .map(({ tab }) => tab)
  tabs.splice(0, tabs.length, ...sorted)
}
