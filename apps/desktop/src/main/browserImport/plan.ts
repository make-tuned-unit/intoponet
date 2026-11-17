import { randomUUID } from 'node:crypto'
import type { ImportedFolder } from './chromiumBookmarks'

/**
 * Staging: everything an import will write is worked out here first, from what was read and
 * what Intoponet already has. Nothing in this file writes anything.
 */

export type ImportedTab = { url: string; title: string; pinned: boolean }

/** The address as Intoponet compares tabs (parsed and written back the same way). */
export function sameAddress(url: string): string {
  try {
    return new URL(url).toString()
  } catch {
    return url
  }
}

/**
 * Tabs to open: pinned first, then open ones, each address once and none already open, within
 * the room left under the tab limit. Existing tabs are never closed to make room.
 */
export function planTabs(pinned: Array<{ url: string; title: string }>, open: Array<{ url: string; title: string }>, existing: readonly string[], room: number): { add: ImportedTab[]; duplicates: number; leftOut: { pinned: number; open: number } } {
  const seen = new Set(existing.map(sameAddress))
  const add: ImportedTab[] = []
  let duplicates = 0
  const leftOut = { pinned: 0, open: 0 }
  const take = (tabs: Array<{ url: string; title: string }>, isPinned: boolean): void => {
    for (const tab of tabs) {
      const key = sameAddress(tab.url)
      if (seen.has(key)) {
        duplicates += 1
        continue
      }
      seen.add(key)
      if (add.length >= Math.max(0, room)) {
        leftOut[isPinned ? 'pinned' : 'open'] += 1
        continue
      }
      add.push({ url: key, title: tab.title.slice(0, 180), pinned: isPinned })
    }
  }
  take(pinned, true)
  take(open, false)
  return { add, duplicates, leftOut }
}

// ---- A sidebar's spaces, recreated as workspaces ------------------------------------------------

type Page = { url: string; title: string }
type TreeNode = { kind: 'tab'; url: string; title: string } | { kind: 'folder'; name: string; children: TreeNode[] }

/** A folder to make in a workspace, with its tabs and the folders inside it. */
export type FolderPlan = { name: string; tabs: Page[]; children: FolderPlan[] }

export type WorkspacePlan = {
  name: string
  /** The workspace of the same name that is already here (it is added to), or null for a new one. */
  existingId: string | null
  pinned: Page[]
  folders: FolderPlan[]
  open: Page[]
}

export type WorkspaceImportPlan = {
  workspaces: WorkspacePlan[]
  /** For the favourites row (shared by every workspace). */
  favourites: Page[]
  counts: { workspaces: number; pinned: number; foldered: number; open: number; favourites: number }
  skipped: { duplicates: number; overLimit: number; spaces: number }
  /**
   * Pinned tabs, tabs in folders and favourites that found no room (a full workspace, or a space over
   * the limit of workspaces), by the space they were in: kept as a collection, so none is lost.
   */
  keep: Array<{ space: string; pages: Page[] }>
}

export type ExistingWorkspace = { id: string; name: string; urls: string[]; room: number }

/** The collection that keeps favourites which found no room in the favourites row or a workspace. */
export const FAVOURITES_KEPT = 'Imported favourites'

/** Every page in a folder plan, depth first. */
export function folderPages(folders: readonly FolderPlan[]): Page[] {
  return folders.flatMap((folder) => [...folder.tabs, ...folderPages(folder.children)])
}

/**
 * Works out the workspaces an import makes: each space becomes a workspace of the same name (or
 * adds to the one already here with that name), keeping its pinned tabs, its folders as they nest
 * (folders deeper than Intoponet allows keep their tabs in the deepest folder that fits) and its
 * open tabs, each address once per workspace and within each workspace's tab limit. Favourites go
 * to the favourites row while it has room; the rest become pinned tabs in the first workspace.
 * Running it again with the same spaces plans nothing.
 */
export function planWorkspaces(input: {
  spaces: ReadonlyArray<{ title: string; tree: readonly TreeNode[]; open: readonly Page[] }>
  favourites: readonly Page[]
  existing: readonly ExistingWorkspace[]
  existingFavourites: readonly string[]
  /** Workspaces that can still be made. */
  freeWorkspaces: number
  /** Tabs a new workspace may hold. */
  tabLimit: number
  favouriteRoom: number
  include: { pinned: boolean; open: boolean }
  maxFolderDepth: number
}): WorkspaceImportPlan {
  const plan: WorkspaceImportPlan = { workspaces: [], favourites: [], counts: { workspaces: 0, pinned: 0, foldered: 0, open: 0, favourites: 0 }, skipped: { duplicates: 0, overLimit: 0, spaces: 0 }, keep: [] }
  let free = Math.max(0, input.freeWorkspaces)
  const planned: Array<{ plan: WorkspacePlan; seen: Set<string>; room: { left: number } }> = []
  const kept = (space: string, page: Page): void => {
    let entry = plan.keep.find((item) => item.space === space)
    if (!entry) plan.keep.push(entry = { space, pages: [] })
    entry.pages.push({ url: sameAddress(page.url), title: page.title.slice(0, 180) })
  }
  /** `keep`: the space whose collection the page joins when the workspace has no room (pinned tabs, tabs in folders, favourites). */
  const take = (page: Page, seen: Set<string>, room: { left: number }, keep: string | null): Page | null => {
    const url = sameAddress(page.url)
    if (seen.has(url)) {
      plan.skipped.duplicates += 1
      return null
    }
    seen.add(url)
    if (room.left <= 0) {
      plan.skipped.overLimit += 1
      if (keep) kept(keep, page)
      return null
    }
    room.left -= 1
    return { url, title: page.title.slice(0, 180) }
  }
  const pagesOf = (nodes: readonly TreeNode[]): Page[] => nodes.flatMap((node) => (node.kind === 'tab' ? [node] : pagesOf(node.children)))
  for (const space of input.spaces) {
    // As a workspace keeps its name (workspaceName): one line, at most 40 characters, no space at either end.
    const name = space.title.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim() || 'Imported'
    // The same name twice in one import: one workspace.
    const again = planned.find((entry) => entry.plan.name.toLowerCase() === name.toLowerCase())
    const existing = input.existing.find((workspace) => workspace.name.trim().toLowerCase() === name.toLowerCase())
    let entry = again
    if (!entry) {
      if (!existing && free <= 0) {
        plan.skipped.spaces += 1
        // No workspace for this space: its pinned tabs and the tabs in its folders are kept as a collection.
        if (input.include.pinned) for (const page of pagesOf(space.tree)) kept(name, page)
        continue
      }
      if (!existing) free -= 1
      entry = {
        plan: { name: existing?.name ?? name, existingId: existing?.id ?? null, pinned: [], folders: [], open: [] },
        seen: new Set((existing?.urls ?? []).map(sameAddress)),
        room: { left: existing ? existing.room : input.tabLimit },
      }
      planned.push(entry)
    }
    const { seen, room } = entry
    const folder = (node: Extract<TreeNode, { kind: 'folder' }>, depth: number, into: FolderPlan | null): FolderPlan | null => {
      const made: FolderPlan = into ?? { name: node.name.slice(0, 80) || 'Untitled folder', tabs: [], children: [] }
      for (const child of node.children) {
        if (child.kind === 'tab') {
          const page = take(child, seen, room, name)
          if (page) made.tabs.push(page)
        } else if (depth >= input.maxFolderDepth) folder(child, depth, made)
        else {
          const inner = folder(child, depth + 1, null)
          if (inner) made.children.push(inner)
        }
      }
      return into || made.tabs.length || made.children.length ? made : null
    }
    if (input.include.pinned) {
      for (const node of space.tree) {
        if (node.kind !== 'tab') continue
        const page = take(node, seen, room, name)
        if (page) entry.plan.pinned.push(page)
      }
      for (const node of space.tree) {
        if (node.kind !== 'folder') continue
        const made = folder(node, 1, null)
        if (made) entry.plan.folders.push(made)
      }
    }
    if (input.include.open) {
      for (const tab of space.open) {
        const page = take(tab, seen, room, null)
        if (page) entry.plan.open.push(page)
      }
    }
  }
  // Favourites: the row while it has room, then pinned tabs in the first workspace.
  const known = new Set(input.existingFavourites.map(sameAddress))
  let favouriteRoom = Math.max(0, input.favouriteRoom)
  for (const favourite of input.favourites) {
    const url = sameAddress(favourite.url)
    if (known.has(url)) {
      plan.skipped.duplicates += 1
      continue
    }
    known.add(url)
    if (favouriteRoom > 0) {
      favouriteRoom -= 1
      plan.favourites.push({ url, title: favourite.title.slice(0, 180) })
      continue
    }
    const first = planned[0]
    const page = first ? take(favourite, first.seen, first.room, FAVOURITES_KEPT) : null
    if (page) first!.plan.pinned.push(page)
    else if (!first) {
      plan.skipped.overLimit += 1
      kept(FAVOURITES_KEPT, favourite)
    }
  }
  // An existing workspace that gains nothing is left alone; a new one is made even when empty (the space existed).
  plan.workspaces = planned.map((entry) => entry.plan).filter((workspace) => workspace.existingId === null || workspace.pinned.length || workspace.folders.length || workspace.open.length)
  for (const workspace of plan.workspaces) {
    if (workspace.existingId === null) plan.counts.workspaces += 1
    plan.counts.pinned += workspace.pinned.length
    plan.counts.foldered += folderPages(workspace.folders).length
    plan.counts.open += workspace.open.length
  }
  plan.counts.favourites = plan.favourites.length
  return plan
}

export type LibraryBookmark ={ url: string; title: string; topic: string; savedAt: string }
export type LibraryCollection = { id: string; label: string; createdAt: string; memberUrls: string[] }
export type LibraryDocument = { schema: 'intoponet.private-library.v1'; bookmarks: LibraryBookmark[]; collections: LibraryCollection[]; recents: []; absorbed: [] }

/**
 * A private-library document (the same shape an exported library has) that the shell merges
 * into the open library: pages match by address, collections by name, so importing again adds
 * nothing. Folders with the same name become one collection; each address is listed once in it.
 */
export function libraryDocument(folders: ImportedFolder[], topic: string, now: Date): LibraryDocument {
  const stamp = now.toISOString()
  const bookmarks = new Map<string, LibraryBookmark>()
  const collections = new Map<string, LibraryCollection>()
  for (const folder of folders) {
    const label = folder.label.trim().slice(0, 80)
    if (!label) continue
    const key = label.toLowerCase()
    let collection = collections.get(key)
    if (!collection) {
      collection = { id: randomUUID(), label, createdAt: stamp, memberUrls: [] }
      collections.set(key, collection)
    }
    for (const page of folder.pages) {
      if (!bookmarks.has(page.url)) bookmarks.set(page.url, { url: page.url, title: page.title || page.url.slice(0, 180), topic: topic.slice(0, 80), savedAt: page.addedAt ?? stamp })
      if (!collection.memberUrls.includes(page.url)) collection.memberUrls.push(page.url)
    }
  }
  return { schema: 'intoponet.private-library.v1', bookmarks: [...bookmarks.values()], collections: [...collections.values()].filter((collection) => collection.memberUrls.length > 0), recents: [], absorbed: [] }
}

/** Pages and folders a set of folders holds (for the preview). */
export function folderCounts(folders: ImportedFolder[]): { pages: number; folders: number } {
  const urls = new Set(folders.flatMap((folder) => folder.pages.map((page) => page.url)))
  const labels = new Set(folders.map((folder) => folder.label.toLowerCase()))
  return { pages: urls.size, folders: labels.size }
}

export type LoginRow = { origin: string; username: string; password: string }

/**
 * Sign-ins to hand to the vault: secure sites only (the vault's own rule), each site and
 * username once. Rows without a password (sign in with another account) are left out.
 */
export function planLogins(rows: Array<{ origin: string; username: string; password: string | null }>, toOrigin: (url: string) => string | null): { add: LoginRow[]; insecure: number; unreadable: number; empty: number } {
  const add: LoginRow[] = []
  const seen = new Set<string>()
  let insecure = 0
  let unreadable = 0
  let empty = 0
  for (const row of rows) {
    if (row.password === null) {
      unreadable += 1
      continue
    }
    if (!row.password) {
      empty += 1
      continue
    }
    const origin = toOrigin(row.origin)
    if (!origin) {
      insecure += 1
      continue
    }
    const key = `${origin}\n${row.username}`
    if (seen.has(key)) continue
    seen.add(key)
    add.push({ origin, username: row.username, password: row.password })
  }
  return { add, insecure, unreadable, empty }
}
