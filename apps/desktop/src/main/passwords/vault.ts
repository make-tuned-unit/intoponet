import { randomUUID } from 'node:crypto'
import type { PasswordVaultStatus, SavedLogin } from '../../shared/passwords'
import { PASSWORD_LIMIT, USERNAME_LIMIT } from '../../shared/passwordPage'
import { passwordOrigin, sameLoginSite } from './origin'

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

const emptyData = (): VaultData => ({ schema: SCHEMA, logins: [], never: [] })

const isDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))

function readLogin(value: unknown): StoredLogin | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const { id, origin, username, password, createdAt, updatedAt, lastUsedAt } = input
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) return null
  if (typeof origin !== 'string' || passwordOrigin(origin) !== origin) return null
  if (typeof username !== 'string' || username.length > USERNAME_LIMIT) return null
  if (typeof password !== 'string' || !password || password.length > PASSWORD_LIMIT) return null
  if (!isDate(createdAt) || !isDate(updatedAt)) return null
  return { id, origin, username, password, createdAt, updatedAt, lastUsedAt: isDate(lastUsedAt) ? lastUsedAt : null }
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
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly crypto: VaultCrypto,
    private readonly file: VaultFile,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Open the file once. A file that cannot be decrypted is left untouched and nothing new is saved. */
  load(): Promise<void> {
    this.loading ??= (async () => {
      const sealed = this.file.read()
      if (!sealed) {
        this.data = emptyData()
        return
      }
      try {
        if (!(await this.crypto.available())) throw new Error('unavailable')
        const { result, shouldReEncrypt } = await this.crypto.decrypt(sealed)
        this.data = parseVaultData(result)
        if (shouldReEncrypt) await this.write(this.data).catch(() => undefined)
      } catch {
        this.unreadable = true
        this.data = null
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

  /** Saved sign-ins for this site (www. and the bare domain count as one), exact origin first. */
  async forSite(origin: string): Promise<StoredLogin[]> {
    await this.load()
    return (this.data?.logins ?? [])
      .filter((login) => sameLoginSite(login.origin, origin))
      .sort((a, b) => Number(b.origin === origin) - Number(a.origin === origin) || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.username.localeCompare(b.username))
  }

  async get(id: string): Promise<StoredLogin | null> {
    await this.load()
    return this.data?.logins.find((login) => login.id === id) ?? null
  }

  /** The saved entry for this site and username, if there is one. */
  async find(origin: string, username: string): Promise<StoredLogin | null> {
    return (await this.forSite(origin)).find((login) => login.username === username) ?? null
  }

  /** Save a new sign-in, or a new password for one already saved. */
  save(origin: string, username: string, password: string): Promise<SavedLogin> {
    if (passwordOrigin(origin) !== origin) return Promise.reject(new Error('Passwords are saved only for secure sites.'))
    if (!password || password.length > PASSWORD_LIMIT || username.length > USERNAME_LIMIT) return Promise.reject(new Error('Invalid sign-in.'))
    return this.mutate((data) => {
      const stamp = this.now().toISOString()
      const existing = data.logins.find((login) => login.origin === origin && login.username === username)
        ?? data.logins.find((login) => sameLoginSite(login.origin, origin) && login.username === username)
      if (existing) {
        existing.password = password
        existing.updatedAt = stamp
        existing.lastUsedAt = stamp
        return summary(existing)
      }
      if (data.logins.length >= MAX_LOGINS) throw new Error('Too many saved passwords.')
      const login: StoredLogin = { id: randomUUID(), origin, username, password, createdAt: stamp, updatedAt: stamp, lastUsedAt: stamp }
      data.logins.push(login)
      data.never = data.never.filter((item) => !sameLoginSite(item, origin))
      return summary(login)
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

  /** Apply a change to a copy, seal it, and keep it only once it is on disk. One change at a time. */
  private mutate<T>(change: (data: VaultData) => T): Promise<T> {
    const run = this.queue.then(async () => {
      await this.load()
      if (!this.data) throw new Error('Saved passwords could not be opened on this Mac.')
      const next = structuredClone(this.data)
      const result = change(next)
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
