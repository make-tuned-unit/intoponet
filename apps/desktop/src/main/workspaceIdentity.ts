/**
 * Separate sign-ins per workspace, as pure rules: which Electron session ("partition") a page
 * uses, and the names of the files and scopes that go with it. A workspace that opts in keeps its
 * own cookies, site storage, saved passwords and permissions; the others share the default one.
 * Private tabs always use their own partition, whichever workspace is shown.
 */

/** The shared partition every ordinary workspace uses. */
export const DEFAULT_PARTITION = 'persist:intoponet-default'
/** Private tabs: memory only, never a workspace. */
export const PRIVATE_PARTITION = 'intoponet-private'
/** The first workspace, which never has separate sign-ins (it is the shared identity). */
export const MAIN_WORKSPACE_ID = 'main'

const WORKSPACE_PARTITION_PREFIX = 'persist:intoponet-ws-'
const WORKSPACE_ID = /^[A-Za-z0-9-]{1,80}$/

export type IdentityWorkspace = { id: string; separateSignIns?: boolean }

/** A workspace id that can be part of a partition or file name. */
export function isWorkspaceIdentityId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_ID.test(value)
}

/** Whether a workspace keeps its own sign-ins (Main never does). */
export function hasSeparateSignIns(workspace: IdentityWorkspace | null | undefined): boolean {
  return !!workspace && workspace.separateSignIns === true && workspace.id !== MAIN_WORKSPACE_ID
}

/** The partition of a workspace's own sign-ins. Throws for an id that cannot name one: never shared by accident. */
export function workspacePartition(id: string): string {
  if (!isWorkspaceIdentityId(id)) throw new Error('Invalid workspace identity.')
  return `${WORKSPACE_PARTITION_PREFIX}${id}`
}

/**
 * The partition a page in a tab uses: private tabs get the private one; a workspace with separate
 * sign-ins gets its own; everything else the shared default. `workspace` null means no workspace
 * (quick windows): the shared default.
 */
export function pagePartition(workspace: IdentityWorkspace | null | undefined, isPrivate: boolean): string {
  if (isPrivate) return PRIVATE_PARTITION
  return hasSeparateSignIns(workspace) ? workspacePartition(workspace!.id) : DEFAULT_PARTITION
}

/** The workspace whose own partition this is (null for the shared, private and any other partition). */
export function partitionWorkspaceId(partition: string): string | null {
  if (!partition.startsWith(WORKSPACE_PARTITION_PREFIX)) return null
  const id = partition.slice(WORKSPACE_PARTITION_PREFIX.length)
  return isWorkspaceIdentityId(id) ? id : null
}

/**
 * The scope permissions and saved logins are kept under: 'private', 'default' (the shared identity)
 * or `ws:<id>` for a workspace's own sign-ins.
 */
export type IdentityScope = 'private' | 'default' | `ws:${string}`

export function identityScope(partition: string): IdentityScope {
  if (partition === PRIVATE_PARTITION) return 'private'
  const id = partitionWorkspaceId(partition)
  return id ? `ws:${id}` : 'default'
}

/** The workspace a scope names (null for the shared and private scopes). */
export function scopeWorkspaceId(scope: string): string | null {
  return scope.startsWith('ws:') ? scope.slice(3) : null
}

/** Where a workspace's own site permissions are kept (inside userData). */
export function workspacePermissionsFile(id: string): string {
  if (!isWorkspaceIdentityId(id)) throw new Error('Invalid workspace identity.')
  return `site-permissions.ws-${id}.json`
}

/** Whether moving a tab between two workspaces changes the sign-ins it runs with. */
export function signInsChange(from: IdentityWorkspace | null | undefined, to: IdentityWorkspace | null | undefined): boolean {
  return pagePartition(from, false) !== pagePartition(to, false)
}

/**
 * The folder (in userData/Partitions) a workspace's partition is kept in. Electron names it after
 * the partition, lowercased; workspace ids need no escaping.
 */
export function workspacePartitionFolder(id: string): string {
  if (!isWorkspaceIdentityId(id)) throw new Error('Invalid workspace identity.')
  return `intoponet-ws-${id.toLowerCase()}`
}

const PARTITION_FOLDER = /^intoponet-ws-([A-Za-z0-9-]{1,80})$/
const PERMISSIONS_FILE = /^site-permissions\.ws-([A-Za-z0-9-]{1,80})\.json$/

/** The workspaces named by partition folders (in userData/Partitions) and permission files (in userData). */
export function identitiesOnDisk(partitionFolders: readonly string[], profileFiles: readonly string[]): string[] {
  const ids: string[] = []
  for (const name of partitionFolders) {
    const id = PARTITION_FOLDER.exec(name)?.[1]
    if (id) ids.push(id.toLowerCase())
  }
  for (const name of profileFiles) {
    const id = PERMISSIONS_FILE.exec(name)?.[1]
    if (id) ids.push(id)
  }
  return ids
}

/**
 * Of the workspace ids found (partition folders, permission files, saved logins), those no workspace
 * keeps its own sign-ins under any more: it was deleted, or its separate sign-ins were turned off.
 * Partition folders are lowercased, so a workspace keeps whatever matches its id in any case.
 */
export function leftoverIdentities(workspaces: readonly IdentityWorkspace[], found: readonly string[]): string[] {
  const kept = new Set(workspaces.filter((workspace) => hasSeparateSignIns(workspace)).map((workspace) => workspace.id.toLowerCase()))
  const leftover: string[] = []
  for (const id of found) if (isWorkspaceIdentityId(id) && !kept.has(id.toLowerCase()) && !leftover.includes(id)) leftover.push(id)
  return leftover
}

export type LeftoverIdentitySweep = {
  /** Every workspace now (one deleted but still in its Undo window too). Asked again before each removal. */
  workspaces: () => readonly IdentityWorkspace[]
  /** Whether this run opened the workspace's partition: its data is then cleared through its session, never deleted under it. */
  partitionInUse: (id: string) => boolean
  /** Names in userData/Partitions, and in userData itself ([] when there is no such folder). */
  partitionFolders: () => readonly string[]
  profileFiles: () => readonly string[]
  /** The workspace ids saved logins carry ([] when the saved passwords cannot be opened). */
  loginWorkspaceIds: () => Promise<readonly string[]>
  /** Removes one workspace's own sign-ins and site data, its permission answers and its saved logins. */
  forget: (id: string) => Promise<void>
}

/**
 * At startup: what a workspace left on disk when the app stopped before clearing it (a crash or a
 * force-quit inside a deletion's Undo window, say). Only once the saved workspaces have loaded: with
 * the state file missing, unreadable or set aside, the workspaces the app knows are not the person's,
 * so nothing is listed or removed. Returns the ids whose data was removed.
 */
export async function sweepLeftoverIdentities(savedWorkspacesLoaded: boolean, sweep: LeftoverIdentitySweep): Promise<string[]> {
  if (!savedWorkspacesLoaded) return []
  const onDisk = identitiesOnDisk(sweep.partitionFolders(), sweep.profileFiles())
  const logins = await sweep.loginWorkspaceIds()
  const forgotten: string[] = []
  for (const id of leftoverIdentities(sweep.workspaces(), [...onDisk, ...logins])) {
    // The person may have acted while saved passwords were opening: checked again just before.
    if (!leftoverIdentities(sweep.workspaces(), [id]).length || sweep.partitionInUse(id)) continue
    try {
      await sweep.forget(id)
      forgotten.push(id)
    } catch {
      // Kept for the next launch.
    }
  }
  return forgotten
}
