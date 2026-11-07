import { describe, expect, it, vi } from 'vitest'
import type { PasswordFillMessage } from '../../shared/passwordPage'
import { CLIPBOARD_CLEAR_MS, HELD_OFFER_MS, PasswordService, type PasswordPage } from './service'
import { PasswordVault, type VaultCrypto } from './vault'

const crypto: VaultCrypto = {
  available: async () => true,
  encrypt: async (text) => Buffer.from(text).reverse(),
  decrypt: async (data) => ({ result: Buffer.from(data).reverse().toString(), shouldReEncrypt: false }),
}

const signedIn = { type: 'settled', passwordForm: false } as const

function setup(authorized = true, clock: () => number = Date.now) {
  let stored: Buffer | null = null
  const vault = new PasswordVault(crypto, { read: () => stored, write: (data) => { stored = data } })
  const changed: Array<number | null> = []
  const clipboard = { text: '', read: () => clipboard.text, write: (text: string) => { clipboard.text = text }, clear: () => { clipboard.text = '' } }
  const timers: Array<() => void> = []
  const service = new PasswordService(vault, {
    changed: (id) => changed.push(id),
    authorize: async () => authorized,
    clipboard,
    setTimer: (run, ms) => { expect(ms).toBe(CLIPBOARD_CLEAR_MS); timers.push(run) },
  }, clock)
  return { vault, service, changed, clipboard, timers }
}

function page(url: string, options: { id?: number; isPrivate?: boolean } = {}): PasswordPage & { url: string; fills: PasswordFillMessage[] } {
  const fills: PasswordFillMessage[] = []
  const result = {
    id: options.id ?? 1,
    url,
    fills,
    isPrivate: options.isPrivate ?? false,
    workspaceId: null,
    origin: () => {
      try {
        const parsed = new URL(result.url)
        return parsed.protocol === 'https:' || parsed.hostname === 'localhost' ? parsed.origin : null
      } catch {
        return null
      }
    },
    fill: (message: PasswordFillMessage) => { fills.push(message) },
  }
  return result
}

describe('PasswordService', () => {
  it('offers to save after a sign-in and saves on "Save"', async () => {
    const { service, vault } = setup()
    const tab = page('https://example.com/login')
    await service.report(tab, { type: 'submitted', username: 'ada', password: 'pw1' })
    // Nothing is offered until the sign-in is seen to work.
    expect((await service.pageState(tab))?.offer).toBeNull()
    tab.url = 'https://example.com/home'
    service.navigated(tab.id)
    await service.report(tab, signedIn)
    const state = await service.pageState(tab)
    expect(state?.offer).toMatchObject({ origin: 'https://example.com', username: 'ada', kind: 'save' })
    expect(JSON.stringify(state)).not.toContain('pw1')
    await service.decide(state!.offer!.id, 'save')
    expect((await vault.forSite('https://example.com'))[0]).toMatchObject({ username: 'ada', password: 'pw1' })
    expect((await service.pageState(tab))?.offer).toBeNull()
  })

  it('offers nothing when the sign-in form comes back, or when the page never settles', async () => {
    let now = 1_000
    const { service } = setup(true, () => now)
    const tab = page('https://example.com/login')
    await service.report(tab, { type: 'submitted', username: 'ada', password: 'wrong' })
    service.navigated(tab.id)
    await service.report(tab, { type: 'settled', passwordForm: true })
    expect((await service.pageState(tab))?.offer).toBeNull()
    // The verdict is used once: a later page without a form does not bring the old attempt back.
    await service.report(tab, signedIn)
    expect((await service.pageState(tab))?.offer).toBeNull()

    await service.report(tab, { type: 'submitted', username: 'ada', password: 'slow' })
    now += HELD_OFFER_MS + 1
    await service.report(tab, signedIn)
    expect((await service.pageState(tab))?.offer).toBeNull()

    await service.report(tab, { type: 'submitted', username: 'ada', password: 'right' })
    await service.report(tab, signedIn)
    expect((await service.pageState(tab))?.offer).toMatchObject({ username: 'ada', kind: 'save' })
  })

  it('offers an update when the username is saved with another password, and nothing when unchanged', async () => {
    const { service, vault } = setup()
    await vault.save('https://example.com', 'ada', 'old')
    const tab = page('https://www.example.com/login')
    await service.report(tab, { type: 'submitted', username: 'ada', password: 'old' })
    expect((await service.pageState(tab))?.offer).toBeNull()
    await service.report(tab, { type: 'submitted', username: 'ada', password: 'new' })
    await service.report(tab, signedIn)
    expect((await service.pageState(tab))?.offer).toMatchObject({ kind: 'update', origin: 'https://example.com' })
  })

  it('never offers in private tabs, on unsafe pages, or for sites marked never', async () => {
    const { service } = setup()
    const privateTab = page('https://example.com/login', { isPrivate: true })
    await service.report(privateTab, { type: 'submitted', username: 'ada', password: 'pw' })
    await service.report(privateTab, signedIn)
    expect(await service.pageState(privateTab)).toBeNull()
    const plain = page('http://example.com/login', { id: 2 })
    await service.report(plain, { type: 'submitted', username: 'ada', password: 'pw' })
    await service.report(plain, signedIn)
    expect(await service.pageState(plain)).toBeNull()
    const tab = page('https://example.com/login', { id: 3 })
    await service.report(tab, { type: 'submitted', username: 'ada', password: 'pw' })
    await service.report(tab, signedIn)
    await service.decide((await service.pageState(tab))!.offer!.id, 'never')
    await service.report(tab, { type: 'submitted', username: 'bob', password: 'pw' })
    await service.report(tab, signedIn)
    expect((await service.pageState(tab))?.offer).toBeNull()
  })

  it('uses the username from the first step of a two-step sign-in', async () => {
    const { service } = setup()
    const tab = page('https://example.com/identifier')
    await service.report(tab, { type: 'identifier', username: 'ada@example.com' })
    tab.url = 'https://example.com/challenge'
    await service.report(tab, { type: 'submitted', username: '', password: 'pw' })
    await service.report(tab, signedIn)
    expect((await service.pageState(tab))?.offer?.username).toBe('ada@example.com')
  })

  it('fills one saved account on its own, and asks which when there are several', async () => {
    const { service, vault } = setup()
    const ada = await vault.save('https://example.com', 'ada', 'pw-a')
    const tab = page('https://www.example.com/login')
    await service.report(tab, { type: 'login-form' })
    expect(tab.fills).toEqual([{ origin: 'https://www.example.com', username: 'ada', password: 'pw-a', overwrite: false }])
    expect(await service.pageState(tab)).toMatchObject({ filled: ada.id, choose: false })

    const bob = await vault.save('https://example.com', 'bob', 'pw-b')
    const other = page('https://example.com/login', { id: 2 })
    await service.report(other, { type: 'login-form' })
    expect(other.fills).toEqual([])
    expect(await service.pageState(other)).toMatchObject({ choose: true, filled: null })
    await service.fill(other, bob.id)
    expect(other.fills).toEqual([{ origin: 'https://example.com', username: 'bob', password: 'pw-b', overwrite: true }])
    expect(await service.pageState(other)).toMatchObject({ choose: false, filled: bob.id })
  })

  it('refuses to fill another site\'s password or into a private tab', async () => {
    const { service, vault } = setup()
    const login = await vault.save('https://example.com', 'ada', 'pw')
    await expect(service.fill(page('https://evil.example.net/'), login.id)).rejects.toThrow()
    await expect(service.fill(page('https://example.com/', { isPrivate: true }), login.id)).rejects.toThrow()
    const tab = page('https://example.com/', { isPrivate: true })
    await service.report(tab, { type: 'login-form' })
    expect(tab.fills).toEqual([])
  })

  it('reveals and copies only when authorized, and clears the clipboard after 30 s if unchanged', async () => {
    const allowed = setup(true)
    const login = await allowed.vault.save('https://example.com', 'ada', 'secret')
    expect(await allowed.service.reveal(login.id)).toBe('secret')
    expect(await allowed.service.copy(login.id)).toBe(true)
    expect(allowed.clipboard.text).toBe('secret')
    allowed.timers[0]!()
    await vi.waitFor(() => expect(allowed.clipboard.text).toBe(''))

    await allowed.service.copy(login.id)
    allowed.clipboard.text = 'something else'
    allowed.timers[1]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(allowed.clipboard.text).toBe('something else')

    const refused = setup(false)
    const other = await refused.vault.save('https://example.com', 'ada', 'secret')
    expect(await refused.service.reveal(other.id)).toBeNull()
    expect(await refused.service.copy(other.id)).toBe(false)
    expect(refused.clipboard.text).toBe('')
  })
})

describe('password service and workspaces', () => {
  const inWork = (url: string, options: { id?: number } = {}) => ({ ...page(url, options), workspaceId: 'work' })

  it('offers a workspace only its own sign-ins, and never the shared ones', async () => {
    const { service, vault } = setup()
    await vault.save('https://example.com', 'ada', 'shared-pw')
    const work = await vault.save('https://example.com', 'bob', 'work-pw', 'work')
    const tab = inWork('https://example.com/login')
    await service.report(tab, { type: 'login-form' })
    expect(tab.fills).toEqual([{ origin: 'https://example.com', username: 'bob', password: 'work-pw', overwrite: false }])
    expect(await service.pageState(tab)).toMatchObject({ accounts: [{ id: work.id, username: 'bob' }], choose: false })
    const shared = page('https://example.com/login', { id: 2 })
    await service.report(shared, { type: 'login-form' })
    expect(shared.fills).toEqual([{ origin: 'https://example.com', username: 'ada', password: 'shared-pw', overwrite: false }])
  })

  it('will not fill another scope\'s password into a page', async () => {
    const { service, vault } = setup()
    const shared = await vault.save('https://example.com', 'ada', 'shared-pw')
    const tab = inWork('https://example.com/login')
    await expect(service.fill(tab, shared.id)).rejects.toThrow(/not for this site/)
    expect(tab.fills).toEqual([])
  })

  it('saves a sign-in captured in a workspace into that workspace', async () => {
    const { service, vault } = setup()
    const tab = inWork('https://example.com/login')
    await service.report(tab, { type: 'submitted', username: 'ada', password: 'pw-work' })
    await service.report(tab, signedIn)
    const offer = (await service.pageState(tab))?.offer
    expect(offer).toMatchObject({ username: 'ada', kind: 'save' })
    await service.decide(offer!.id, 'save')
    expect(await vault.forSite('https://example.com')).toEqual([])
    expect(await vault.forSite('https://example.com', 'work')).toMatchObject([{ username: 'ada', workspaceId: 'work' }])
  })
})
