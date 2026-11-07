import { describe, expect, it } from 'vitest'
import { parseVaultData, PasswordVault, VAULT_RETRY_MS, type VaultCrypto, type VaultFile } from './vault'

/** Reversible stand-in for safeStorage, so the tests can see that the file is not plaintext. */
function fakeCrypto(available = true): VaultCrypto & { setAvailable(on: boolean): void } {
  let on = available
  return {
    setAvailable: (value) => { on = value },
    available: async () => on,
    encrypt: async (text) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
    decrypt: async (data) => {
      const text = data.toString()
      if (!text.startsWith('sealed:')) throw new Error('bad seal')
      return { result: Buffer.from(text.slice(7), 'base64').toString(), shouldReEncrypt: false }
    },
  }
}

function memoryFile(initial: Buffer | null = null): VaultFile & { data: Buffer | null; writes: number } {
  const file = {
    data: initial,
    writes: 0,
    read: () => file.data,
    write: (data: Buffer) => { file.data = data; file.writes += 1 },
  }
  return file
}

describe('PasswordVault', () => {
  it('saves sealed, never plaintext, and reads back after a restart', async () => {
    const crypto = fakeCrypto()
    const file = memoryFile()
    const vault = new PasswordVault(crypto, file)
    const saved = await vault.save('https://example.com', 'ada', 'correct horse')
    expect(file.data!.toString()).not.toContain('correct horse')
    const reopened = new PasswordVault(crypto, file)
    const [login] = await reopened.forSite('https://example.com')
    expect(login).toMatchObject({ id: saved.id, username: 'ada', password: 'correct horse' })
    expect(await reopened.list()).toEqual([expect.not.objectContaining({ password: expect.anything() })])
  })

  it('updates the password for an existing username instead of adding another', async () => {
    let now = new Date('2026-01-01T00:00:00Z')
    const vault = new PasswordVault(fakeCrypto(), memoryFile(), () => now)
    const first = await vault.save('https://example.com', 'ada', 'one')
    now = new Date('2026-02-01T00:00:00Z')
    const second = await vault.save('https://www.example.com', 'ada', 'two')
    expect(second.id).toBe(first.id)
    expect(second.updatedAt).toBe('2026-02-01T00:00:00.000Z')
    expect((await vault.forSite('https://example.com')).map((login) => login.password)).toEqual(['two'])
  })

  it('treats www. and the bare domain as one site, but not other subdomains or schemes', async () => {
    const vault = new PasswordVault(fakeCrypto(), memoryFile())
    await vault.save('https://www.example.com', 'ada', 'pw')
    expect(await vault.forSite('https://example.com')).toHaveLength(1)
    expect(await vault.forSite('https://mail.example.com')).toHaveLength(0)
    expect(await vault.forSite('https://example.com:8443')).toHaveLength(0)
  })

  it('refuses to save without on-device encryption and keeps nothing', async () => {
    const crypto = fakeCrypto(false)
    const file = memoryFile()
    const vault = new PasswordVault(crypto, file)
    await expect(vault.save('https://example.com', 'ada', 'pw')).rejects.toThrow(/encryption/)
    expect(file.data).toBeNull()
    crypto.setAvailable(true)
    expect(await vault.list()).toEqual([])
  })

  it('leaves an unreadable file alone and saves nothing over it', async () => {
    const file = memoryFile(Buffer.from('not ours'))
    const vault = new PasswordVault(fakeCrypto(), file)
    expect(await vault.status()).toMatchObject({ unreadable: true, count: 0 })
    await expect(vault.save('https://example.com', 'ada', 'pw')).rejects.toThrow()
    expect(file.data!.toString()).toBe('not ours')
  })

  it('opens the file once Keychain access is allowed, without a restart, and never saves over it before', async () => {
    const crypto = fakeCrypto()
    const file = memoryFile()
    await new PasswordVault(crypto, file).save('https://example.com', 'ada', 'pw')
    const sealed = file.data
    let denied = true
    let decrypts = 0
    const flaky: VaultCrypto = { ...crypto, decrypt: async (data) => { decrypts += 1; if (denied) throw new Error('User canceled'); return crypto.decrypt(data) } }
    let now = new Date('2026-01-01T00:00:00Z')
    const vault = new PasswordVault(flaky, file, () => now)
    expect(await vault.status()).toMatchObject({ unreadable: true, count: 0 })
    await expect(vault.save('https://example.org', 'bob', 'pw')).rejects.toThrow()
    expect(file.data).toBe(sealed)
    // Not asked again straight away (no prompt storm while browsing)…
    denied = false
    expect(await vault.forSite('https://example.com')).toEqual([])
    expect(decrypts).toBe(1)
    // …but after a short wait the next use opens it.
    now = new Date(now.getTime() + VAULT_RETRY_MS)
    expect(await vault.status()).toMatchObject({ unreadable: false, count: 1 })
    expect(await vault.forSite('https://example.com')).toHaveLength(1)
    expect(decrypts).toBe(2)
  })

  it('only saves https sites and http on localhost', async () => {
    const vault = new PasswordVault(fakeCrypto(), memoryFile())
    await expect(vault.save('http://example.com', 'ada', 'pw')).rejects.toThrow()
    await expect(vault.save('https://example.com/login', 'ada', 'pw')).rejects.toThrow()
    await expect(vault.save('http://localhost:5173', 'ada', 'pw')).resolves.toMatchObject({ origin: 'http://localhost:5173' })
  })

  it('keeps a never-save list, cleared for a site when a password is saved there', async () => {
    const vault = new PasswordVault(fakeCrypto(), memoryFile())
    await vault.addNever('https://example.com')
    expect(await vault.isNever('https://www.example.com')).toBe(true)
    await vault.removeNever('https://example.com')
    expect(await vault.isNever('https://example.com')).toBe(false)
    await vault.addNever('https://example.com')
    await vault.save('https://example.com', 'ada', 'pw')
    expect(await vault.neverList()).toEqual([])
  })

  it('removes one entry and records when one was last used', async () => {
    const vault = new PasswordVault(fakeCrypto(), memoryFile(), () => new Date('2026-03-01T00:00:00Z'))
    const a = await vault.save('https://example.com', 'ada', 'pw')
    const b = await vault.save('https://example.com', 'bob', 'pw')
    await vault.markUsed(b.id)
    await vault.remove(a.id)
    expect((await vault.list()).map((login) => login.username)).toEqual(['bob'])
    expect((await vault.get(b.id))?.lastUsedAt).toBe('2026-03-01T00:00:00.000Z')
  })

  it('runs changes one at a time', async () => {
    const file = memoryFile()
    const vault = new PasswordVault(fakeCrypto(), file)
    await Promise.all(['a', 'b', 'c', 'd'].map((name) => vault.save('https://example.com', name, 'pw')))
    expect((await new PasswordVault(fakeCrypto(), file).list()).map((login) => login.username)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('parseVaultData', () => {
  it('drops malformed entries and unsafe origins', () => {
    const data = parseVaultData(JSON.stringify({
      schema: 'intoponet.passwords.v1',
      logins: [
        { id: '11111111-aaaa', origin: 'https://example.com', username: 'ada', password: 'pw', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', lastUsedAt: null },
        { id: '22222222-bbbb', origin: 'http://example.com', username: 'x', password: 'pw', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'bad id!', origin: 'https://example.com', username: 'x', password: 'pw', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        { id: '33333333-cccc', origin: 'https://example.com', username: 'x', password: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      ],
      never: ['https://a.example', 'javascript:alert(1)', 7],
    }))
    expect(data.logins.map((login) => login.username)).toEqual(['ada'])
    expect(data.never).toEqual(['https://a.example'])
  })

  it('rejects a file of another kind', () => {
    expect(() => parseVaultData('{"schema":"other"}')).toThrow()
  })

  it('imports sign-ins in one sealed write and skips ones already saved for the site and username', async () => {
    const crypto = fakeCrypto()
    const file = memoryFile()
    const vault = new PasswordVault(crypto, file)
    await vault.save('https://example.com', 'ada', 'mine')
    const writes = file.writes
    const rows = [
      { origin: 'https://www.example.com', username: 'ada', password: 'theirs' },
      { origin: 'https://other.example', username: 'bob', password: 'pw' },
      { origin: 'http://insecure.example', username: 'x', password: 'pw' },
    ]
    expect(await vault.importMany(rows)).toEqual({ added: 1, existing: 1, invalid: 1 })
    expect(file.writes).toBe(writes + 1)
    expect((await vault.find('https://example.com', 'ada'))!.password).toBe('mine')
    expect(await vault.importMany(rows)).toEqual({ added: 0, existing: 2, invalid: 1 })
    expect(file.data!.toString()).not.toContain('pw')
  })

  it('writes nothing from an import when the file cannot be sealed', async () => {
    const crypto = fakeCrypto()
    const file = memoryFile()
    const vault = new PasswordVault(crypto, file)
    await vault.load()
    crypto.setAvailable(false)
    await expect(vault.importMany([{ origin: 'https://a.example', username: 'a', password: 'b' }])).rejects.toThrow()
    crypto.setAvailable(true)
    expect(await vault.list()).toEqual([])
  })
})

describe('PasswordVault workspace scope', () => {
  it('keeps a workspace\'s sign-in apart from the shared ones for the same site', async () => {
    const vault = new PasswordVault(fakeCrypto(), memoryFile())
    const shared = await vault.save('https://example.com', 'ada', 'shared-pw')
    const work = await vault.save('https://example.com', 'ada', 'work-pw', 'work')
    expect(work.id).not.toBe(shared.id)
    expect(work).toMatchObject({ workspaceId: 'work' })
    expect((await vault.forSite('https://example.com')).map((login) => login.password)).toEqual(['shared-pw'])
    expect((await vault.forSite('https://example.com', 'work')).map((login) => login.password)).toEqual(['work-pw'])
    expect(await vault.forSite('https://example.com', 'home')).toEqual([])
    expect(await vault.find('https://example.com', 'ada', 'work')).toMatchObject({ password: 'work-pw' })
  })

  it('updates a password within its own scope only', async () => {
    const vault = new PasswordVault(fakeCrypto(), memoryFile())
    await vault.save('https://example.com', 'ada', 'shared-pw')
    await vault.save('https://example.com', 'ada', 'work-old', 'work')
    await vault.save('https://example.com', 'ada', 'work-new', 'work')
    expect(await vault.list()).toHaveLength(2)
    expect((await vault.forSite('https://example.com')).map((login) => login.password)).toEqual(['shared-pw'])
    expect((await vault.forSite('https://example.com', 'work')).map((login) => login.password)).toEqual(['work-new'])
  })

  it('forgets one workspace\'s logins and nothing else', async () => {
    const vault = new PasswordVault(fakeCrypto(), memoryFile())
    await vault.save('https://example.com', 'ada', 'shared-pw')
    await vault.save('https://example.com', 'ada', 'work-pw', 'work')
    await vault.save('https://other.example', 'bob', 'other-pw', 'home')
    expect(await vault.removeWorkspace('work')).toBe(1)
    expect((await vault.list()).map((login) => `${login.origin}:${login.workspaceId ?? 'shared'}`)).toEqual(['https://example.com:shared', 'https://other.example:home'])
  })

  it('reads a file from before workspaces as shared logins, and drops a damaged scope', () => {
    const shared = { id: 'abcdefgh', origin: 'https://example.com', username: 'ada', password: 'pw', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const text = JSON.stringify({ schema: 'intoponet.passwords.v1', logins: [shared, { ...shared, id: 'ijklmnop', workspaceId: 'bad id' }], never: [] })
    const data = parseVaultData(text)
    expect(data.logins.map((login) => login.id)).toEqual(['abcdefgh'])
    expect(data.logins[0]!.workspaceId).toBeUndefined()
  })
})
