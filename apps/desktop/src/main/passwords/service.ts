import { randomUUID } from 'node:crypto'
import type { PasswordOffer, PasswordPageState, PasswordVaultStatus, SavedLogin } from '../../shared/passwords'
import type { PasswordFillMessage, PasswordPageMessage } from '../../shared/passwordPage'
import { sameLoginSite } from './origin'
import type { PasswordVault } from './vault'

/** A web page as the password service needs it. Its origin is read from the page itself, never from a message. */
export type PasswordPage = {
  id: number
  /** The top frame's password origin now, or null when passwords are not offered there. */
  origin(): string | null
  isPrivate: boolean
  /** The workspace whose own sign-ins the page uses; null for the shared ones. Only that scope's logins are offered. */
  workspaceId: string | null
  fill(message: PasswordFillMessage): void
}

export type PasswordServiceDeps = {
  /** Something about this page changed (null: the saved list changed). */
  changed(pageId: number | null): void
  /** Touch ID or a confirmation before a password is shown or copied. */
  authorize(origin: string): Promise<boolean>
  clipboard: { read(): string | Promise<string>; write(text: string): void; clear(): void }
  setTimer?: (run: () => void, ms: number) => void
}

type PendingOffer = PasswordOffer & { password: string; workspaceId: string | null }

type PageRecord = {
  offer: PendingOffer | null
  /** A sign-in that was sent but has not yet worked: offered only once the page moves past its sign-in form. */
  held: { offer: PendingOffer; at: number } | null
  filled: string | null
  choiceDismissed: boolean
  /** Username sent on the first page of a two-step sign-in. */
  identifier: { origin: string; username: string; at: number } | null
}

export const CLIPBOARD_CLEAR_MS = 30_000
const IDENTIFIER_MS = 10 * 60_000
/** How long a sent sign-in waits for the page to show it worked. */
export const HELD_OFFER_MS = 2 * 60_000

export class PasswordService {
  private readonly pages = new Map<number, PageRecord>()

  constructor(private readonly vault: PasswordVault, private readonly deps: PasswordServiceDeps, private readonly clock: () => number = Date.now) {}

  private record(id: number): PageRecord {
    let record = this.pages.get(id)
    if (!record) {
      record = { offer: null, held: null, filled: null, choiceDismissed: false, identifier: null }
      this.pages.set(id, record)
    }
    return record
  }

  /** A message from the page's sign-in helper. Private pages and other origins are ignored. */
  async report(page: PasswordPage, message: PasswordPageMessage): Promise<void> {
    if (page.isPrivate) return
    if (message.type === 'settled') {
      // Checked before the origin: a sign-in may land on another site or page kind.
      const record = this.pages.get(page.id)
      const held = record?.held
      if (!record || !held) return
      record.held = null
      // The sign-in form is back (wrong password, a captcha): nothing to save.
      if (message.passwordForm || this.clock() - held.at > HELD_OFFER_MS) return
      record.offer = held.offer
      this.deps.changed(page.id)
      return
    }
    const origin = page.origin()
    if (!origin) return
    const record = this.record(page.id)
    if (message.type === 'identifier') {
      record.identifier = { origin, username: message.username, at: this.clock() }
      return
    }
    if (message.type === 'login-form') {
      const accounts = await this.vault.forSite(origin, page.workspaceId)
      if (accounts.length === 1 && page.origin() === origin) {
        const [only] = accounts
        page.fill({ origin, username: only!.username, password: only!.password, overwrite: false })
        record.filled = only!.id
      }
      this.deps.changed(page.id)
      return
    }
    const remembered = record.identifier && sameLoginSite(record.identifier.origin, origin) && this.clock() - record.identifier.at < IDENTIFIER_MS ? record.identifier.username : ''
    const username = message.username || remembered
    if (await this.vault.isNever(origin)) return
    const existing = await this.vault.find(origin, username, page.workspaceId)
    if (existing && existing.password === message.password) {
      await this.vault.markUsed(existing.id).catch(() => undefined)
      return
    }
    record.held = { offer: { id: randomUUID(), origin: existing?.origin ?? origin, username, password: message.password, kind: existing ? 'update' : 'save', workspaceId: page.workspaceId }, at: this.clock() }
  }

  /** A new document in the page: what was filled no longer applies. Offers stay (sign-ins redirect). */
  navigated(pageId: number): void {
    const record = this.pages.get(pageId)
    if (!record) return
    record.filled = null
    record.choiceDismissed = false
  }

  forget(pageId: number): void {
    this.pages.delete(pageId)
  }

  async pageState(page: PasswordPage): Promise<PasswordPageState | null> {
    if (page.isPrivate) return null
    const origin = page.origin()
    const record = this.pages.get(page.id)
    const offer = record?.offer ? { id: record.offer.id, origin: record.offer.origin, username: record.offer.username, kind: record.offer.kind } : null
    if (!origin && !offer) return null
    const accounts = origin ? (await this.vault.forSite(origin, page.workspaceId)).map(({ id, username }) => ({ id, username })) : []
    const filled = record?.filled && accounts.some((account) => account.id === record.filled) ? record.filled : null
    return { origin: origin ?? '', offer, accounts, filled, choose: accounts.length > 1 && !filled && !record?.choiceDismissed }
  }

  async decide(offerId: string, decision: 'save' | 'never' | 'dismiss'): Promise<void> {
    const entry = [...this.pages.entries()].find(([, record]) => record.offer?.id === offerId)
    if (!entry) return
    const [pageId, record] = entry
    const offer = record.offer!
    if (decision === 'save') {
      const saved = await this.vault.save(offer.origin, offer.username, offer.password, offer.workspaceId)
      record.filled = saved.id
    }
    if (decision === 'never') await this.vault.addNever(offer.origin)
    record.offer = null
    this.deps.changed(pageId)
    if (decision !== 'dismiss') this.deps.changed(null)
  }

  /** Fill a chosen account into the page, only when it belongs to the page's site. */
  async fill(page: PasswordPage, id: string): Promise<void> {
    if (page.isPrivate) throw new Error('Passwords are not filled in private tabs.')
    const login = await this.vault.get(id)
    const origin = page.origin()
    // Another workspace's sign-in (or the shared one, from a separate-sign-in workspace) is not this page's.
    if (!origin || !login || !sameLoginSite(login.origin, origin) || (login.workspaceId ?? null) !== page.workspaceId) throw new Error('That password is not for this site.')
    page.fill({ origin, username: login.username, password: login.password, overwrite: true })
    const record = this.record(page.id)
    record.filled = id
    this.deps.changed(page.id)
  }

  dismissChoice(pageId: number): void {
    this.record(pageId).choiceDismissed = true
    this.deps.changed(pageId)
  }

  async reveal(id: string): Promise<string | null> {
    const login = await this.vault.get(id)
    if (!login) throw new Error('That password is no longer saved.')
    return (await this.deps.authorize(login.origin)) ? login.password : null
  }

  /** Copy a password; it is cleared from the clipboard after 30 s unless something else was copied since. */
  async copy(id: string): Promise<boolean> {
    const login = await this.vault.get(id)
    if (!login) throw new Error('That password is no longer saved.')
    if (!(await this.deps.authorize(login.origin))) return false
    const { clipboard } = this.deps
    clipboard.write(login.password)
    const timer = this.deps.setTimer ?? ((run, ms) => { setTimeout(run, ms).unref?.() })
    timer(() => {
      void Promise.resolve(clipboard.read()).then((text) => { if (text === login.password) clipboard.clear() }, () => undefined)
    }, CLIPBOARD_CLEAR_MS)
    return true
  }

  list(): Promise<SavedLogin[]> {
    return this.vault.list()
  }

  status(): Promise<PasswordVaultStatus> {
    return this.vault.status()
  }

  neverList(): Promise<string[]> {
    return this.vault.neverList()
  }

  /** Sign-ins from another browser (Settings › Import), sealed in one write. */
  async importLogins(rows: ReadonlyArray<{ origin: string; username: string; password: string }>): Promise<{ added: number; existing: number; invalid: number }> {
    const result = await this.vault.importMany(rows)
    if (result.added) this.deps.changed(null)
    return result
  }

  async remove(id: string): Promise<void> {
    await this.vault.remove(id)
    this.deps.changed(null)
  }

  /** A workspace's own sign-ins are deleted with its site data. */
  async forgetWorkspace(workspaceId: string): Promise<void> {
    await this.vault.removeWorkspace(workspaceId)
    this.deps.changed(null)
  }

  async removeNever(origin: string): Promise<void> {
    await this.vault.removeNever(origin)
    this.deps.changed(null)
  }
}
