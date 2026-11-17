import { httpUrl, joinLabel, type ImportedFolder } from './chromiumBookmarks'

/**
 * Arc's sidebar, from StorableSidebar.json in its Application Support folder. Arc does not
 * document this file. The shape below is the one community exporters read (arc-export and
 * others), and anything that does not match it is refused as a whole rather than half read:
 *
 *   { "sidebar": { "containers": [ { "global": {} }, { "spaces": [...], "items": [...], "topAppsContainerIDs": [...] } ] } }
 *
 * `spaces` and `items` alternate an id string and its object. A space names its pinned and
 * unpinned containers in `newContainerIDs` ([{ "pinned": {} }, "<id>", { "unpinned": {} }, "<id>"])
 * or, in older files, `containerIDs` (["pinned", "<id>", "unpinned", "<id>"]). An item has an
 * `id`, a `parentID`, an optional `title` (a name the person gave it), optional `childrenIds`
 * (their order), and `data`: `{ tab: { savedURL, savedTitle } }` for a tab, `{ list: {} }` for a
 * folder, `{ splitView: {} }` for tabs side by side. A space belongs to a profile through
 * `profile`: `{ default: true }` or `{ custom: { _0: { directoryBasename: "Profile 1" } } }`.
 */

export type ArcTab = { url: string; title: string }

/** The pinned part of a space as it is laid out: tabs and folders, folders nested as they were. */
export type SidebarNode = { kind: 'tab'; url: string; title: string } | { kind: 'folder'; name: string; children: SidebarNode[] }

export type ArcSpace = {
  title: string
  /** The profile folder the space belongs to (Default, Profile 1). */
  profile: string
  /** Tabs pinned straight in the space. */
  pinned: ArcTab[]
  /** Folders in the pinned part, as collections named "Space › Folder". */
  folders: ImportedFolder[]
  /** The space's unpinned (open) tabs. */
  open: ArcTab[]
  /** The pinned part in order, folders nested (for recreating the space as a workspace). */
  tree: SidebarNode[]
}

export type ArcSidebar = {
  spaces: ArcSpace[]
  /** Favourites (Arc's top apps): global, shown for the default profile. */
  favourites: ArcTab[]
  /** Items that are not tabs or folders (notes, easels) or could not be read. */
  skipped: number
}

export class ArcFormatError extends Error {
  constructor() {
    super('Arc\'s sidebar file is not in a format Intoponet knows, so nothing was read from it.')
  }
}

type Item = { id: string; parentID: string | null; title: string | null; childrenIds: string[] | null; data: Record<string, unknown> }

const MAX_ITEMS = 50_000
/** Folders nested deeper than this keep their tabs in the deepest folder that is named. */
const MAX_DEPTH = 16
/** Nothing is followed deeper than this (a file built to exhaust the stack). */
const MAX_WALK = 1_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const text = (value: unknown, limit = 180): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '')

function readItem(value: unknown): Item | null {
  if (!isRecord(value) || typeof value['id'] !== 'string' || !value['id']) return null
  const parent = value['parentID']
  const children = value['childrenIds']
  return {
    id: value['id'],
    parentID: typeof parent === 'string' ? parent : null,
    title: typeof value['title'] === 'string' ? value['title'] : null,
    childrenIds: Array.isArray(children) ? children.filter((child): child is string => typeof child === 'string') : null,
    data: isRecord(value['data']) ? value['data'] : {},
  }
}

/** The ids a space gives its pinned and unpinned containers, in either known layout. */
function containerIds(space: Record<string, unknown>): { pinned: string | null; unpinned: string | null } {
  const found: { pinned: string | null; unpinned: string | null } = { pinned: null, unpinned: null }
  const list = Array.isArray(space['newContainerIDs']) ? space['newContainerIDs'] : Array.isArray(space['containerIDs']) ? space['containerIDs'] : []
  for (let index = 0; index + 1 < list.length; index += 1) {
    const marker = list[index]
    const id = list[index + 1]
    if (typeof id !== 'string') continue
    const kind = typeof marker === 'string' ? marker : isRecord(marker) ? Object.keys(marker)[0] : null
    if (kind === 'pinned' && !found.pinned) found.pinned = id
    if (kind === 'unpinned' && !found.unpinned) found.unpinned = id
  }
  return found
}

function spaceProfile(space: Record<string, unknown>): string {
  const profile = space['profile']
  if (!isRecord(profile)) return 'Default'
  const custom = profile['custom']
  const inner = isRecord(custom) && isRecord(custom['_0']) ? custom['_0'] : null
  const folder = inner && typeof inner['directoryBasename'] === 'string' ? inner['directoryBasename'] : null
  return folder && /^Profile \d{1,4}$/.test(folder) ? folder : 'Default'
}

/** Parse the sidebar file. Throws ArcFormatError when its shape is not the known one. */
export function parseArcSidebar(raw: string): ArcSidebar {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new ArcFormatError()
  }
  const sidebar = isRecord(json) && isRecord(json['sidebar']) ? json['sidebar'] : null
  const containers = sidebar && Array.isArray(sidebar['containers']) ? sidebar['containers'] : null
  if (!containers) throw new ArcFormatError()
  const main = containers.find((container): container is Record<string, unknown> => isRecord(container) && Array.isArray(container['spaces']) && Array.isArray(container['items']))
  if (!main) throw new ArcFormatError()
  const rawItems = (main['items'] as unknown[]).filter(isRecord)
  const rawSpaces = (main['spaces'] as unknown[]).filter(isRecord)
  if (rawItems.length > MAX_ITEMS) throw new ArcFormatError()

  const items = new Map<string, Item>()
  let skipped = 0
  for (const value of rawItems) {
    const item = readItem(value)
    if (item) items.set(item.id, item)
    else skipped += 1
  }
  const byParent = new Map<string, Item[]>()
  for (const item of items.values()) {
    if (!item.parentID) continue
    const siblings = byParent.get(item.parentID)
    if (siblings) siblings.push(item)
    else byParent.set(item.parentID, [item])
  }
  const childrenOf = (parent: string): Item[] => {
    const children = [...(byParent.get(parent) ?? [])]
    const order = items.get(parent)?.childrenIds
    if (!order) return children
    const rank = new Map(order.map((id, index) => [id, index]))
    return children.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }
  const asTab = (item: Item): ArcTab | null => {
    const tab = item.data['tab']
    if (!isRecord(tab)) return null
    const url = tab['savedURL']
    if (!httpUrl(url)) return null
    return { url, title: text(item.title) || text(tab['savedTitle']) || url.slice(0, 180) }
  }
  const isFolder = (item: Item): boolean => isRecord(item.data['list'])
  const isSplit = (item: Item): boolean => isRecord(item.data['splitView'])

  /** Tabs under a container, split views opened up; folders handed to `onFolder`. */
  const tabsUnder = (parent: string, depth: number, onFolder: ((item: Item) => void) | null, seen: Set<string>): ArcTab[] => {
    if (depth > MAX_WALK) return []
    const tabs: ArcTab[] = []
    for (const child of childrenOf(parent)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      const tab = asTab(child)
      if (tab) tabs.push(tab)
      else if (isSplit(child)) tabs.push(...tabsUnder(child.id, depth + 1, null, seen))
      else if (isFolder(child)) {
        if (onFolder && depth < MAX_DEPTH) onFolder(child)
        else tabs.push(...tabsUnder(child.id, depth + 1, null, seen))
      } else skipped += 1
    }
    return tabs
  }

  /** The pinned part as a tree. Split views open up into their tabs; notes and the like are left out (counted above). */
  const treeUnder = (parent: string, depth: number, seen: Set<string>): SidebarNode[] => {
    if (depth > MAX_WALK) return []
    const nodes: SidebarNode[] = []
    for (const child of childrenOf(parent)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      const tab = asTab(child)
      if (tab) nodes.push({ kind: 'tab', ...tab })
      else if (isSplit(child)) nodes.push(...treeUnder(child.id, depth + 1, seen).filter((node) => node.kind === 'tab'))
      else if (isFolder(child)) nodes.push({ kind: 'folder', name: text(child.title, 60) || 'Untitled folder', children: treeUnder(child.id, depth + 1, seen) })
    }
    return nodes
  }

  const spaces: ArcSpace[] = []
  let untitled = 0
  for (const space of rawSpaces) {
    const { pinned, unpinned } = containerIds(space)
    if (!pinned && !unpinned) {
      skipped += 1
      continue
    }
    const title = text(space['title'], 60) || `Space ${(untitled += 1)}`
    const folders: ImportedFolder[] = []
    const seen = new Set<string>()
    const addFolder = (path: string[], folder: Item, depth: number): void => {
      const name = [...path, text(folder.title, 60) || 'Untitled folder']
      const pages = tabsUnder(folder.id, depth + 1, (inner) => addFolder(name, inner, depth + 1), seen)
      if (pages.length) folders.push({ label: joinLabel(name), pages: pages.map((page) => ({ ...page, addedAt: null })) })
    }
    const pinnedTabs = pinned ? tabsUnder(pinned, 0, (folder) => addFolder([title], folder, 0), seen) : []
    const openTabs = unpinned ? tabsUnder(unpinned, 0, null, seen) : []
    const tree = pinned ? treeUnder(pinned, 0, new Set()) : []
    spaces.push({ title, profile: spaceProfile(space), pinned: pinnedTabs, folders, open: openTabs, tree })
  }

  const favourites: ArcTab[] = []
  const topApps = Array.isArray(main['topAppsContainerIDs']) ? main['topAppsContainerIDs'] : []
  const topId = topApps.find((value): value is string => typeof value === 'string')
  if (topId) favourites.push(...tabsUnder(topId, 0, null, new Set()))
  return { spaces, favourites, skipped }
}

/** The part of the sidebar that belongs to one Arc profile folder. */
export function sidebarForProfile(sidebar: ArcSidebar, folder: string): { spaces: ArcSpace[]; favourites: ArcTab[] } {
  return { spaces: sidebar.spaces.filter((space) => space.profile === folder), favourites: folder === 'Default' ? sidebar.favourites : [] }
}
