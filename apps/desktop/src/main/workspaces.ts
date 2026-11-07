import { randomUUID } from 'node:crypto'
import {
  MAX_FAVOURITES,
  MAX_WORKSPACES,
  WORKSPACE_ACCENTS,
  WORKSPACE_ICONS,
  isWorkspaceAccent,
  isWorkspaceIcon,
  workspaceAnchor,
  workspaceName,
  type FavouriteSnapshot,
  type WorkspaceAccent,
  type WorkspaceAnchor,
  type WorkspaceIcon,
  type WorkspacesState,
} from '@intoponet/browser-api'
import { MAX_FOLDERS, type TabFolder } from './tabOrder'
import { isWorkspaceIdentityId } from './workspaceIdentity'

/**
 * Workspaces, kept apart from Electron so they can be tested. The workspace being shown keeps its
 * tabs and folders where the rest of the browser already looks for them (index.ts: openTabs,
 * tabFolders); every other workspace is "parked" here, its tabs untouched (a sleeping tab stays
 * asleep, a loaded one stays loaded). Switching swaps the two, which costs no page loads at all.
 * Private tabs never enter a workspace: they stay with the window whichever workspace is shown.
 */

export type Workspace = { id: string; name: string; icon: WorkspaceIcon; accent: WorkspaceAccent; anchor?: WorkspaceAnchor; separateSignIns?: boolean }
export type Favourite = FavouriteSnapshot
export type ParkedWorkspace<T> = { tabs: T[]; folders: TabFolder[]; activeTabId: string | null }
export type RemovedWorkspace<T> = { workspace: Workspace; index: number; parked: ParkedWorkspace<T>; favourites: Favourite[] }

/** The workspace everyone starts with, and the one tabs saved before workspaces existed move into. */
export const MAIN_WORKSPACE: Workspace = { id: 'main', name: 'Main', icon: 'globe', accent: 'teal' }

/** A name, icon and accent for a new workspace: "Workspace N", and the first icon and colour not yet used. */
export function nextWorkspaceLook(existing: readonly Workspace[]): Omit<Workspace, 'id'> {
  const names = new Set(existing.map((workspace) => workspace.name.toLowerCase()))
  let n = existing.length + 1
  while (names.has(`workspace ${n}`)) n += 1
  const unused = <V extends string>(all: readonly V[], used: V[]): V => all.find((value) => !used.includes(value)) ?? all[existing.length % all.length]!
  return {
    name: `Workspace ${n}`,
    icon: unused(WORKSPACE_ICONS.filter((icon) => icon !== 'globe'), existing.map((workspace) => workspace.icon)),
    accent: unused(WORKSPACE_ACCENTS, existing.map((workspace) => workspace.accent)),
  }
}

export class WorkspaceSet<T extends { id: string }> {
  workspaces: Workspace[]
  activeId: string
  favourites: Favourite[]
  private readonly parked = new Map<string, ParkedWorkspace<T>>()

  constructor(workspaces: Workspace[] = [{ ...MAIN_WORKSPACE }], activeId?: string, favourites: Favourite[] = []) {
    this.workspaces = workspaces.length ? workspaces.slice(0, MAX_WORKSPACES) : [{ ...MAIN_WORKSPACE }]
    this.activeId = this.workspaces.some((workspace) => workspace.id === activeId) ? activeId! : this.workspaces[0]!.id
    const known = new Set(this.workspaces.map((workspace) => workspace.id))
    this.favourites = favourites.filter((favourite) => favourite.workspaceId === null || known.has(favourite.workspaceId)).slice(0, MAX_FAVOURITES)
    for (const workspace of this.workspaces) if (workspace.id !== this.activeId) this.parked.set(workspace.id, { tabs: [], folders: [], activeTabId: null })
  }

  get(id: string): Workspace | undefined {
    return this.workspaces.find((workspace) => workspace.id === id)
  }

  active(): Workspace {
    return this.get(this.activeId)!
  }

  /** What a workspace that is not shown holds (undefined for the one shown). */
  parkedOf(id: string): ParkedWorkspace<T> | undefined {
    return this.parked.get(id)
  }

  /** Every tab in the workspaces not shown. */
  parkedTabs(): T[] {
    return [...this.parked.values()].flatMap((parked) => parked.tabs)
  }

  /** The parked workspace a tab is in, if any. */
  workspaceOfParkedTab(tabId: string): string | null {
    for (const [id, parked] of this.parked) if (parked.tabs.some((tab) => tab.id === tabId)) return id
    return null
  }

  /** Takes a tab out of whichever parked workspace holds it. */
  takeParkedTab(tabId: string): T | null {
    for (const parked of this.parked.values()) {
      const index = parked.tabs.findIndex((tab) => tab.id === tabId)
      if (index < 0) continue
      const [tab] = parked.tabs.splice(index, 1)
      if (parked.activeTabId === tabId) parked.activeTabId = null
      return tab ?? null
    }
    return null
  }

  /** Fills a parked workspace (used when restoring a saved session). */
  park(id: string, contents: ParkedWorkspace<T>): void {
    if (id === this.activeId || !this.get(id)) return
    this.parked.set(id, contents)
  }

  /** A new workspace, after the others (not shown yet). Null at the limit. */
  create(look: Partial<Omit<Workspace, 'id'>> = {}): Workspace | null {
    if (this.workspaces.length >= MAX_WORKSPACES) return null
    const workspace: Workspace = { id: randomUUID(), ...nextWorkspaceLook(this.workspaces), ...look }
    this.workspaces.push(workspace)
    this.parked.set(workspace.id, { tabs: [], folders: [], activeTabId: null })
    return workspace
  }

  update(id: string, changes: Partial<Omit<Workspace, 'id' | 'anchor'>> & { anchor?: WorkspaceAnchor | null }): boolean {
    const workspace = this.get(id)
    if (!workspace) return false
    let changed = false
    for (const key of ['name', 'icon', 'accent'] as const) {
      const value = changes[key]
      if (value !== undefined && workspace[key] !== value) {
        ;(workspace as Record<typeof key, string>)[key] = value
        changed = true
      }
    }
    // null removes the anchor; a new one replaces it (a place the person chose, never the device's location).
    if (changes.anchor === null && workspace.anchor) {
      delete workspace.anchor
      changed = true
    } else if (changes.anchor && !sameAnchor(workspace.anchor, changes.anchor)) {
      workspace.anchor = { ...changes.anchor }
      changed = true
    }
    if (changes.separateSignIns !== undefined && workspace.separateSignIns !== changes.separateSignIns) {
      workspace.separateSignIns = changes.separateSignIns
      changed = true
    }
    return changed
  }

  /** Reorder: the workspace goes to `toIndex` (⌃1–9 follow the new order). */
  move(id: string, toIndex: number): boolean {
    const from = this.workspaces.findIndex((workspace) => workspace.id === id)
    if (from < 0) return false
    const to = Math.max(0, Math.min(this.workspaces.length - 1, Math.round(toIndex)))
    if (to === from) return false
    const [workspace] = this.workspaces.splice(from, 1)
    this.workspaces.splice(to, 0, workspace!)
    return true
  }

  /** The workspace that ⌃N (index N-1) or a step from the shown one names. */
  resolve(target: { id: string } | { index: number } | { step: 1 | -1 }): Workspace | null {
    if ('id' in target) return this.get(target.id) ?? null
    if ('index' in target) return this.workspaces[target.index] ?? null
    if (this.workspaces.length < 2) return null
    const at = this.workspaces.findIndex((workspace) => workspace.id === this.activeId)
    return this.workspaces[(at + target.step + this.workspaces.length) % this.workspaces.length] ?? null
  }

  /**
   * Shows another workspace: `current` is what the shown one holds now (it is parked, as it is);
   * the target's parked contents come back to be shown. Null when there is nothing to switch to.
   */
  switchTo(id: string, current: ParkedWorkspace<T>): ParkedWorkspace<T> | null {
    if (id === this.activeId || !this.get(id)) return null
    const next = this.parked.get(id) ?? { tabs: [], folders: [], activeTabId: null }
    this.parked.delete(id)
    this.parked.set(this.activeId, current)
    this.activeId = id
    return next
  }

  /** Removes a workspace that is not shown (switch away first). Its tabs are handed back, for Undo or to close. */
  remove(id: string): RemovedWorkspace<T> | null {
    if (id === this.activeId || this.workspaces.length < 2) return null
    const index = this.workspaces.findIndex((workspace) => workspace.id === id)
    if (index < 0) return null
    const [workspace] = this.workspaces.splice(index, 1)
    const parked = this.parked.get(id) ?? { tabs: [], folders: [], activeTabId: null }
    this.parked.delete(id)
    const favourites = this.favourites.filter((favourite) => favourite.workspaceId === id)
    this.favourites = this.favourites.filter((favourite) => favourite.workspaceId !== id)
    return { workspace: workspace!, index, parked, favourites }
  }

  /** Undo: the removed workspace comes back where it was, with its tabs, folders and favourites. */
  restore(removed: RemovedWorkspace<T>): boolean {
    if (this.workspaces.length >= MAX_WORKSPACES || this.get(removed.workspace.id)) return false
    this.workspaces.splice(Math.min(removed.index, this.workspaces.length), 0, removed.workspace)
    this.parked.set(removed.workspace.id, removed.parked)
    this.favourites = [...this.favourites, ...removed.favourites].slice(0, MAX_FAVOURITES)
    return true
  }

  /** Puts a tab at the end of a parked workspace's tabs (its folder is left behind: folders belong to a workspace). */
  addToParked(workspaceId: string, tab: T): boolean {
    const parked = this.parked.get(workspaceId)
    if (!parked) return false
    parked.tabs.push(tab)
    return true
  }

  // ---- Favourites ----------------------------------------------------------------------------

  /** The favourites row for the shown workspace: the shared ones and its own, in their order. */
  visibleFavourites(): Favourite[] {
    return this.favourites.filter((favourite) => favourite.workspaceId === null || favourite.workspaceId === this.activeId)
  }

  addFavourite(url: string, title: string, shared: boolean): Favourite | null {
    const owner = shared ? null : this.activeId
    const existing = this.visibleFavourites().find((favourite) => sameSiteAddress(favourite.url, url))
    if (existing) return existing
    if (this.favourites.length >= MAX_FAVOURITES) return null
    const favourite: Favourite = { id: randomUUID(), url, title: title.slice(0, 180), workspaceId: owner }
    this.favourites.push(favourite)
    return favourite
  }

  /** Shared by every workspace, or owned by the one shown now. */
  setFavouriteShared(id: string, shared: boolean): boolean {
    const favourite = this.favourites.find((item) => item.id === id)
    if (!favourite) return false
    const owner = shared ? null : favourite.workspaceId ?? this.activeId
    if (favourite.workspaceId === owner) return false
    favourite.workspaceId = owner
    return true
  }

  removeFavourite(id: string): boolean {
    const before = this.favourites.length
    this.favourites = this.favourites.filter((favourite) => favourite.id !== id)
    return this.favourites.length !== before
  }

  /** What the shell sees. `tabCount(id)` counts a workspace's tabs (the shown one's live in index.ts). */
  snapshot(tabCount: (id: string) => number, recentlyDeleted: WorkspacesState['recentlyDeleted'] = null): WorkspacesState {
    return {
      workspaces: this.workspaces.map((workspace) => ({ ...workspace, tabCount: tabCount(workspace.id) })),
      activeId: this.activeId,
      favourites: this.favourites.map((favourite) => ({ ...favourite })),
      recentlyDeleted,
    }
  }
}

function sameAnchor(left: WorkspaceAnchor | undefined, right: WorkspaceAnchor): boolean {
  return !!left && left.lat === right.lat && left.lon === right.lon && left.label === right.label && left.placeId === right.placeId
}

function sameSiteAddress(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '')
  } catch {
    return left === right
  }
}

// ---- Saved with the tabs (browser-state, version 3) -------------------------------------------

/**
 * Version 3 of browser-state keeps every workspace's tabs in one list, each naming its workspace,
 * and every folder likewise; `workspaces` holds the names, icons and accents in order (with each
 * one's last shown tab), `activeWorkspaceId` the one shown, and `favourites` the favourites row.
 * Versions 1 and 2 had no workspaces: everything they saved moves into "Main".
 */
export type SavedWorkspace = Workspace & { activeTabId?: string }
export type SavedWorkspaces = { workspaces: SavedWorkspace[]; activeId: string; favourites: Favourite[]; migrated: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80

function httpAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8_192) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** The workspaces part of a saved state, from any version; damaged entries are dropped, never the whole file. */
export function parseSavedWorkspaces(state: Record<string, unknown>): SavedWorkspaces {
  const workspaces: SavedWorkspace[] = []
  if (Array.isArray(state['workspaces'])) {
    for (const entry of state['workspaces']) {
      if (workspaces.length >= MAX_WORKSPACES) break
      if (!isRecord(entry) || !isId(entry['id']) || workspaces.some((workspace) => workspace.id === entry['id'])) continue
      let name: string
      try {
        name = workspaceName(entry['name'])
      } catch {
        continue
      }
      let anchor: WorkspaceAnchor | undefined
      if (entry['anchor'] !== undefined && entry['anchor'] !== null) {
        try {
          anchor = workspaceAnchor(entry['anchor'])
        } catch {
          anchor = undefined
        }
      }
      workspaces.push({
        id: entry['id'],
        name,
        icon: isWorkspaceIcon(entry['icon']) ? entry['icon'] : 'globe',
        accent: isWorkspaceAccent(entry['accent']) ? entry['accent'] : WORKSPACE_ACCENTS[workspaces.length % WORKSPACE_ACCENTS.length]!,
        ...(anchor ? { anchor } : {}),
        // An id that cannot name a partition (a hand-edited file) means no separate sign-ins, never an error on restore.
        ...(entry['separateSignIns'] === true && isWorkspaceIdentityId(entry['id']) ? { separateSignIns: true } : {}),
        ...(isId(entry['activeTabId']) ? { activeTabId: entry['activeTabId'] } : {}),
      })
    }
  }
  const migrated = workspaces.length === 0
  if (migrated) workspaces.push({ ...MAIN_WORKSPACE })
  const activeId = isId(state['activeWorkspaceId']) && workspaces.some((workspace) => workspace.id === state['activeWorkspaceId']) ? state['activeWorkspaceId'] : workspaces[0]!.id
  const known = new Set(workspaces.map((workspace) => workspace.id))
  const favourites: Favourite[] = []
  if (Array.isArray(state['favourites'])) {
    for (const entry of state['favourites']) {
      if (favourites.length >= MAX_FAVOURITES) break
      if (!isRecord(entry) || !isId(entry['id']) || !httpAddress(entry['url']) || favourites.some((favourite) => favourite.id === entry['id'])) continue
      const owner = entry['workspaceId']
      if (owner !== null && owner !== undefined && !(isId(owner) && known.has(owner))) continue
      favourites.push({ id: entry['id'], url: entry['url'], title: typeof entry['title'] === 'string' ? entry['title'].slice(0, 180) : '', workspaceId: isId(owner) ? owner : null })
    }
  }
  return { workspaces, activeId, favourites, migrated }
}

/** The workspace a saved tab or folder belongs to: its own when that still exists, otherwise the first (Main, after a migration). */
export function savedWorkspaceOf(record: Record<string, unknown>, workspaces: readonly Workspace[]): string {
  const id = record['workspaceId']
  return isId(id) && workspaces.some((workspace) => workspace.id === id) ? id : workspaces[0]!.id
}

/** Saved folders grouped by workspace, each group within the folder limit. */
export function groupSavedFolders(value: unknown, workspaces: readonly Workspace[]): Map<string, unknown[]> {
  const groups = new Map<string, unknown[]>()
  if (!Array.isArray(value)) return groups
  for (const entry of value.slice(0, MAX_FOLDERS * MAX_WORKSPACES)) {
    if (!isRecord(entry)) continue
    const owner = savedWorkspaceOf(entry, workspaces)
    const group = groups.get(owner) ?? []
    if (group.length < MAX_FOLDERS) group.push(entry)
    groups.set(owner, group)
  }
  return groups
}
