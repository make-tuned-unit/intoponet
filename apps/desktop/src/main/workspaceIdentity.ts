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
