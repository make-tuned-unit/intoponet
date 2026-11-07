import { randomUUID } from 'node:crypto'
import type { PasswordVaultStatus, SavedLogin } from '../../shared/passwords'
import { PASSWORD_LIMIT, USERNAME_LIMIT } from '../../shared/passwordPage'
import { passwordOrigin, sameLoginSite } from './origin'
import { isWorkspaceIdentityId } from '../workspaceIdentity'

/**
 * Saved passwords, sealed in one file with a key macOS keeps in the login Keychain
 * (Electron safeStorage). Decrypted only in the main process; never written in plaintext.
 */

export type VaultCrypto = {
  available(): Promise<boolean>
  encrypt(text: string): Promise<Buffer>
  decrypt(data: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export type VaultFile = {
  /** null when there is no file yet. */
  read(): Buffer | null
  /** Replace the file in one step. */
  write(data: Buffer): void
}

export type StoredLogin = SavedLogin & { password: string }

type VaultData = { schema: 'intoponet.passwords.v1'; logins: StoredLogin[]; never: string[] }

const SCHEMA = 'intoponet.passwords.v1'
const MAX_LOGINS = 5_000
const MAX_NEVER = 1_000
/** After the file could not be opened (Keychain denied or locked), wait this long before asking again. */
export const VAULT_RETRY_MS = 30_000

const emptyData = (): VaultData => ({ schema: SCHEMA, logins: [], never: [] })

const isDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))

function readLogin(value: unknown): StoredLogin | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const { id, origin, username, password, createdAt, updatedAt, lastUsedAt, workspaceId } = input
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) return null
  if (typeof origin !== 'string' || passwordOrigin(origin) !== origin) return null
  if (typeof username !== 'string' || username.length > USERNAME_LIMIT) return null
  if (typeof password !== 'string' || !password || password.length > PASSWORD_LIMIT) return null
  if (!isDate(createdAt) || !isDate(updatedAt)) return null
  // An absent workspace means the shared sign-ins (every file before workspaces had separate sign-ins).
  if (workspaceId !== undefined && !isWorkspaceIdentityId(workspaceId)) return null
  return {
    id, origin, username, password, createdAt, updatedAt, lastUsedAt: isDate(lastUsedAt) ? lastUsedAt : null,
    ...(typeof workspaceId === 'string' ? { workspaceId } : {}),
  }
}

/** Parse a decrypted vault, dropping anything malformed. */
export function parseVaultData(text: string): VaultData {
  const raw = JSON.parse(text) as Record<string, unknown>
  if (!raw || raw['schema'] !== SCHEMA) throw new Error('Unknown password file.')
  const logins = (Array.isArray(raw['logins']) ? raw['logins'] : []).map(readLogin).filter((login): login is StoredLogin => !!login).slice(0, MAX_LOGINS)
  const never = (Array.isArray(raw['never']) ? raw['never'] : [])
    .filter((origin): origin is string => typeof origin === 'string' && passwordOrigin(origin) === origin)
    .slice(0, MAX_NEVER)
  return { schema: SCHEMA, logins, never: [...new Set(never)] }
}

const summary = ({ password: _password, ...login }: StoredLogin): SavedLogin => login

export class PasswordVault {
  private data: VaultData | null = null
  private unreadable = false
  private loading: Promise<void> | null = null
  private failedAt: number | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly crypto: VaultCrypto,
    private readonly file: VaultFile,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Open the file once. A file that cannot be decrypted is left untouched and nothing new is saved.
   * Opening is tried again (at most every VAULT_RETRY_MS) so allowing Keychain access later
   * works without restarting.
   */
  load(): Promise<void> {
    const retry = this.failedAt !== null && this.now().getTime() - this.failedAt >= VAULT_RETRY_MS
    if (this.loading && !retry) return this.loading
    this.failedAt = null
    this.loading = (async () => {
      try {
        const sealed = this.file.read()
        // No file, or one of zero bytes (it holds nothing, e.g. left by a crash): nothing saved yet.
        if (!sealed || sealed.length === 0) {
          this.data = emptyData()
          this.unreadable = false
          return
        }
        if (!(await this.crypto.available())) throw new Error('unavailable')
        const { result, shouldReEncrypt } = await this.crypto.decrypt(sealed)
        this.data = parseVaultData(result)
        this.unreadable = false
        if (shouldReEncrypt) await this.write(this.data).catch(() => undefined)
      } catch {
        this.unreadable = true
        this.data = null
        this.failedAt = this.now().getTime()
      }
    })()
    return this.loading
  }

  async status(): Promise<PasswordVaultStatus> {
    await this.load()
    return { available: await this.crypto.available(), unreadable: this.unreadable, count: this.data?.logins.length ?? 0 }
  }

  async list(): Promise<SavedLogin[]> {
    await this.load()
    return (this.data?.logins ?? []).map(summary).sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username))
  }

  /**
   * Saved sign-ins for this site (www. and the bare domain count as one), exact origin first. Only
   * those of the scope asked: the shared ones (workspaceId null) or one workspace's own.
   */
  async forSite(origin: string, workspaceId: string | null = null): Promise<StoredLogin[]> {
    await this.load()
    return (this.data?.logins ?? [])
      .filter((login) => (login.workspaceId ?? null) === workspaceId && sameLoginSite(login.origin, origin))
      .sort((a, b) => Number(b.origin === origin) - Number(a.origin === origin) || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.username.localeCompare(b.username))
  }

  async get(id: string): Promise<StoredLogin | null> {
    await this.load()
    return this.data?.logins.find((login) => login.id === id) ?? null
  }

  /** The saved entry for this site and username, if there is one. */
  async find(origin: string, username: string, workspaceId: string | null = null): Promise<StoredLogin | null> {
    return (await this.forSite(origin, workspaceId)).find((login) => login.username === username) ?? null
  }

  /** Save a new sign-in, or a new password for one already saved in the same scope. */
  save(origin: string, username: string, password: string, workspaceId: string | null = null): Promise<SavedLogin> {
    if (passwordOrigin(origin) !== origin) return Promise.reject(new Error('Passwords are saved only for secure sites.'))
    if (!password || password.length > PASSWORD_LIMIT || username.length > USERNAME_LIMIT) return Promise.reject(new Error('Invalid sign-in.'))
    if (workspaceId !== null && !isWorkspaceIdentityId(workspaceId)) return Promise.reject(new Error('Invalid workspace.'))
    return this.mutate((data) => {
      const stamp = this.now().toISOString()
      const inScope = (login: StoredLogin) => (login.workspaceId ?? null) === workspaceId
      const existing = data.logins.find((login) => inScope(login) && login.origin === origin && login.username === username)
        ?? data.logins.find((login) => inScope(login) && sameLoginSite(login.origin, origin) && login.username === username)
      if (existing) {
        existing.password = password
        existing.updatedAt = stamp
        existing.lastUsedAt = stamp
        return summary(existing)
      }
      if (data.logins.length >= MAX_LOGINS) throw new Error('Too many saved passwords.')
      const login: StoredLogin = { id: randomUUID(), origin, username, password, createdAt: stamp, updatedAt: stamp, lastUsedAt: stamp, ...(workspaceId ? { workspaceId } : {}) }
      data.logins.push(login)
      data.never = data.never.filter((item) => !sameLoginSite(item, origin))
      return summary(login)
    })
  }

  /**
   * Sign-ins brought from another browser, sealed in one write (all or none). One already saved
   * for the same site and username is left as it is, so importing twice adds nothing.
   */
  importMany(rows: ReadonlyArray<{ origin: string; username: string; password: string }>): Promise<{ added: number; existing: number; invalid: number }> {
    return this.mutate((data) => {
      const stamp = this.now().toISOString()
      let added = 0
      let existing = 0
      let invalid = 0
      for (const row of rows) {
        if (passwordOrigin(row.origin) !== row.origin || !row.password || row.password.length > PASSWORD_LIMIT || row.username.length > USERNAME_LIMIT) {
          invalid += 1
          continue
        }
        if (data.logins.some((login) => !login.workspaceId && sameLoginSite(login.origin, row.origin) && login.username === row.username)) {
          existing += 1
          continue
        }
        if (data.logins.length >= MAX_LOGINS) throw new Error('Too many saved passwords.')
        data.logins.push({ id: randomUUID(), origin: row.origin, username: row.username, password: row.password, createdAt: stamp, updatedAt: stamp, lastUsedAt: null })
        added += 1
      }
      return { added, existing, invalid }
    })
  }

  markUsed(id: string): Promise<void> {
    return this.mutate((data) => {
      const login = data.logins.find((item) => item.id === id)
      if (login) login.lastUsedAt = this.now().toISOString()
    })
  }

  remove(id: string): Promise<void> {
    return this.mutate((data) => {
      data.logins = data.logins.filter((login) => login.id !== id)
    })
  }

  /** Forgets every sign-in saved in one workspace's own scope (when its sign-ins are deleted). The file is left alone when it holds none. */
  removeWorkspace(workspaceId: string): Promise<number> {
    return this.mutate((data) => {
      const before = data.logins.length
      data.logins = data.logins.filter((login) => login.workspaceId !== workspaceId)
      return before - data.logins.length
    }, (removed) => removed > 0)
  }

  /** The workspaces with sign-ins saved in their own scope (none when the file cannot be opened). */
  async workspaceIds(): Promise<string[]> {
    await this.load()
    return [...new Set((this.data?.logins ?? []).flatMap((login) => (login.workspaceId ? [login.workspaceId] : [])))]
  }

  async isNever(origin: string): Promise<boolean> {
    await this.load()
    return (this.data?.never ?? []).some((item) => sameLoginSite(item, origin))
  }

  async neverList(): Promise<string[]> {
    await this.load()
    return [...(this.data?.never ?? [])].sort()
  }

  addNever(origin: string): Promise<void> {
    if (passwordOrigin(origin) !== origin) return Promise.reject(new Error('Invalid site.'))
    return this.mutate((data) => {
      if (!data.never.includes(origin) && data.never.length < MAX_NEVER) data.never.push(origin)
    })
  }

  removeNever(origin: string): Promise<void> {
    return this.mutate((data) => {
      data.never = data.never.filter((item) => item !== origin)
    })
  }

  /** Apply a change to a copy, seal it, and keep it only once it is on disk. One change at a time. `changed` false: nothing to write. */
  private mutate<T>(change: (data: VaultData) => T, changed: (result: T) => boolean = () => true): Promise<T> {
    const run = this.queue.then(async () => {
      await this.load()
      if (!this.data) throw new Error('Saved passwords could not be opened on this Mac.')
      const next = structuredClone(this.data)
      const result = change(next)
      if (!changed(result)) return result
      await this.write(next)
      this.data = next
      return result
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async write(data: VaultData): Promise<void> {
    if (!(await this.crypto.available())) throw new Error('On-device encryption is unavailable.')
    this.file.write(await this.crypto.encrypt(JSON.stringify(data)))
  }
}
