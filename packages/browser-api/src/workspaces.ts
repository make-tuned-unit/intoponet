// Workspaces: named sets of pinned tabs, folders and open tabs, one shown at a time, with a short
// favourites row that is shared by every workspace or owned by one. Private browsing is never a
// workspace. What the app shell and the main process say to each other about them.

/** Accents from Intoponet's own palette (brand tokens), by name; the shell maps them to colours. */
export const WORKSPACE_ACCENTS = ['teal', 'cyan', 'mint', 'violet', 'peach', 'coral'] as const
export type WorkspaceAccent = (typeof WORKSPACE_ACCENTS)[number]

/** Icons a workspace can wear (drawn by the shell from its own icon set). */
export const WORKSPACE_ICONS = ['globe', 'briefcase', 'house', 'book', 'newspaper', 'flask', 'code', 'heart', 'star', 'plane', 'music', 'leaf'] as const
export type WorkspaceIcon = (typeof WORKSPACE_ICONS)[number]

/** ⌃1–⌃9 reach them all. */
export const MAX_WORKSPACES = 9
export const MAX_FAVOURITES = 12
export const WORKSPACE_NAME_MAX = 40

export type WorkspaceSnapshot = {
  id: string
  name: string
  icon: WorkspaceIcon
  accent: WorkspaceAccent
  /** Tabs it holds (pinned, in folders and open; never private tabs). */
  tabCount: number
}

/** A site in the favourites row: shared by every workspace (workspaceId null) or owned by one. */
export type FavouriteSnapshot = { id: string; url: string; title: string; workspaceId: string | null }

export type WorkspacesState = {
  workspaces: WorkspaceSnapshot[]
  activeId: string
  favourites: FavouriteSnapshot[]
  /** A workspace deleted moments ago that Undo can still bring back (with its tabs). */
  recentlyDeleted: { id: string; name: string; tabCount: number } | null
}

export type WorkspaceSwitch = { id: string } | { index: number } | { step: 1 | -1 }

export type WorkspaceCommand =
  | { type: 'get-workspaces' }
  | { type: 'create-workspace'; name?: string; icon?: WorkspaceIcon; accent?: WorkspaceAccent }
  | { type: 'update-workspace'; id: string; name?: string; icon?: WorkspaceIcon; accent?: WorkspaceAccent }
  | { type: 'move-workspace'; id: string; toIndex: number }
  | { type: 'delete-workspace'; id: string }
  | { type: 'undo-delete-workspace' }
  | ({ type: 'switch-workspace' } & WorkspaceSwitch)
  | { type: 'move-tab-to-workspace'; tabId: string; workspaceId: string }
  | { type: 'add-favourite'; tabId: string; shared: boolean }
  | { type: 'update-favourite'; id: string; shared: boolean }
  | { type: 'remove-favourite'; id: string }
  | { type: 'open-favourite'; id: string }

export type WorkspaceCommandType = WorkspaceCommand['type']

export const WORKSPACE_COMMAND_TYPES: ReadonlySet<string> = new Set<WorkspaceCommandType>([
  'get-workspaces', 'create-workspace', 'update-workspace', 'move-workspace', 'delete-workspace', 'undo-delete-workspace',
  'switch-workspace', 'move-tab-to-workspace', 'add-favourite', 'update-favourite', 'remove-favourite', 'open-favourite',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shortId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) throw new Error(`Invalid ${what}.`)
  return value
}

/** A workspace's name: one line, trimmed, at most 40 characters. */
export function workspaceName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid workspace name.')
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WORKSPACE_NAME_MAX)
  if (!name) throw new Error('A workspace needs a name.')
  return name
}

export const isWorkspaceIcon = (value: unknown): value is WorkspaceIcon => typeof value === 'string' && (WORKSPACE_ICONS as readonly string[]).includes(value)
export const isWorkspaceAccent = (value: unknown): value is WorkspaceAccent => typeof value === 'string' && (WORKSPACE_ACCENTS as readonly string[]).includes(value)

function look(value: Record<string, unknown>): { name?: string; icon?: WorkspaceIcon; accent?: WorkspaceAccent } {
  if (value['icon'] !== undefined && !isWorkspaceIcon(value['icon'])) throw new Error('Invalid workspace icon.')
  if (value['accent'] !== undefined && !isWorkspaceAccent(value['accent'])) throw new Error('Invalid workspace colour.')
  return {
    ...(value['name'] !== undefined ? { name: workspaceName(value['name']) } : {}),
    ...(value['icon'] !== undefined ? { icon: value['icon'] as WorkspaceIcon } : {}),
    ...(value['accent'] !== undefined ? { accent: value['accent'] as WorkspaceAccent } : {}),
  }
}

/** Validates a workspace command from the app shell (part of browser-host:command). */
export function parseWorkspaceCommand(value: unknown): WorkspaceCommand {
  if (!isRecord(value) || typeof value['type'] !== 'string' || !WORKSPACE_COMMAND_TYPES.has(value['type'])) throw new Error('Unknown workspace command.')
  const type = value['type'] as WorkspaceCommandType
  switch (type) {
    case 'get-workspaces':
    case 'undo-delete-workspace':
      return { type }
    case 'create-workspace':
      return { type, ...look(value) }
    case 'update-workspace':
      return { type, id: shortId(value['id'], 'workspace'), ...look(value) }
    case 'move-workspace': {
      const toIndex = value['toIndex']
      if (typeof toIndex !== 'number' || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= MAX_WORKSPACES) throw new Error('Invalid workspace position.')
      return { type, id: shortId(value['id'], 'workspace'), toIndex }
    }
    case 'delete-workspace':
      return { type, id: shortId(value['id'], 'workspace') }
    case 'switch-workspace': {
      if (value['id'] !== undefined) return { type, id: shortId(value['id'], 'workspace') }
      const index = value['index']
      if (index !== undefined) {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_WORKSPACES) throw new Error('Invalid workspace number.')
        return { type, index }
      }
      if (value['step'] === 1 || value['step'] === -1) return { type, step: value['step'] }
      throw new Error('Invalid workspace switch.')
    }
    case 'move-tab-to-workspace':
      return { type, tabId: shortId(value['tabId'], 'tab'), workspaceId: shortId(value['workspaceId'], 'workspace') }
    case 'add-favourite':
      return { type, tabId: shortId(value['tabId'], 'tab'), shared: value['shared'] !== false }
    case 'update-favourite':
      if (typeof value['shared'] !== 'boolean') throw new Error('Invalid favourite.')
      return { type, id: shortId(value['id'], 'favourite'), shared: value['shared'] }
    case 'remove-favourite':
    case 'open-favourite':
      return { type, id: shortId(value['id'], 'favourite') }
  }
}

export interface WorkspacesApi {
  get(): Promise<WorkspacesState>
  /** A new workspace (named "Workspace N" unless given a name), shown at once. */
  create(look?: { name?: string; icon?: WorkspaceIcon; accent?: WorkspaceAccent }): Promise<WorkspacesState>
  update(id: string, changes: { name?: string; icon?: WorkspaceIcon; accent?: WorkspaceAccent }): Promise<WorkspacesState>
  move(id: string, toIndex: number): Promise<WorkspacesState>
  /** Deletes it and closes its tabs, after a short time in which undoDelete brings it all back. */
  delete(id: string): Promise<WorkspacesState>
  undoDelete(): Promise<WorkspacesState>
  switchTo(target: WorkspaceSwitch): Promise<WorkspacesState>
  moveTab(tabId: string, workspaceId: string): Promise<WorkspacesState>
  addFavourite(tabId: string, shared?: boolean): Promise<WorkspacesState>
  setFavouriteShared(id: string, shared: boolean): Promise<WorkspacesState>
  removeFavourite(id: string): Promise<WorkspacesState>
  openFavourite(id: string): Promise<WorkspacesState>
}
