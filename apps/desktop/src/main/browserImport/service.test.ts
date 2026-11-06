import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseBrowserImportCommand } from '../../shared/browserImport'
import { HistoryStore } from '../historyStore'
import { passwordOrigin } from '../passwords/origin'
import { PasswordVault, type VaultFile } from '../passwords/vault'
import { safeStorageSecret } from './keychain'
import type { ImportedTab } from './plan'
import { BrowserImportService } from './service'
import { BROWSER_SOURCES, detectProfiles, importRoot } from './sources'
import { buildFixtureRoot, FIXTURE_PASSWORD, FIXTURE_TEST_KEY } from './testFixtures'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'intoponet-import-root-'))
  folders.push(root)
  buildFixtureRoot(root)
  const crypto = {
    available: async () => true,
    encrypt: async (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
    decrypt: async (data: Buffer) => ({ result: Buffer.from(data.toString().slice(7), 'base64').toString(), shouldReEncrypt: false }),
  }
  const file: VaultFile & { data: Buffer | null; fail: boolean } = { data: null, fail: false, read: () => file.data, write: (data) => { if (file.fail) throw new Error('disk full'); file.data = data } }
  const vault = new PasswordVault(crypto, file)
  const history = new HistoryStore({ excludedSites: () => [] })
  const open: ImportedTab[] = [{ url: 'https://already.example/', title: 'Already', pinned: false }]
  const tabs = { urls: () => open.map((tab) => tab.url), room: () => 12 - open.length, limit: 12, add: vi.fn((list: ImportedTab[]) => { open.push(...list) }) }
  const env = { INTOPONET_IMPORT_ROOT: root, INTOPONET_IMPORT_TEST_KEY: FIXTURE_TEST_KEY }
  const runSecurity = vi.fn(async () => 'never asked')
  const service = new BrowserImportService({
    root: () => importRoot(env),
    tabs,
    history: () => history,
    passwords: () => ({ importLogins: (rows) => vault.importMany(rows) }),
    toOrigin: passwordOrigin,
    env,
    runSecurity,
    now: () => new Date('2026-11-06T00:00:00Z'),
  })
  return { root, service, vault, file, history, open, tabs, runSecurity }
}

describe('import root', () => {
  it('is Application Support unless a test points it inside the temporary folder', () => {
    expect(importRoot({})).toEqual({ root: join(homedir(), 'Library', 'Application Support'), testing: false })
    const inside = mkdtempSync(join(tmpdir(), 'intoponet-import-root-'))
    folders.push(inside)
    expect(importRoot({ INTOPONET_IMPORT_ROOT: inside }).testing).toBe(true)
    expect(() => importRoot({ INTOPONET_IMPORT_ROOT: join(homedir(), 'Library') })).toThrow()
    expect(() => importRoot({ INTOPONET_IMPORT_ROOT: tmpdir() })).toThrow()
    expect(() => importRoot({ INTOPONET_IMPORT_ROOT: join(inside, '..', '..') })).toThrow()
  })

  it('does not follow a link out of the temporary folder', () => {
    const inside = mkdtempSync(join(tmpdir(), 'intoponet-import-root-'))
    folders.push(inside)
    symlinkSync(homedir(), join(inside, 'home'))
    expect(() => importRoot({ INTOPONET_IMPORT_ROOT: join(inside, 'home') })).toThrow()
  })

  it('uses the test key only with fixture profiles', async () => {
    const source = BROWSER_SOURCES.find((item) => item.key === 'chrome')!
    const run = vi.fn(async () => 'secret\n')
    expect(await safeStorageSecret(source, true, { INTOPONET_IMPORT_TEST_KEY: 'k' }, run)).toEqual({ ok: true, secret: 'k' })
    expect(run).not.toHaveBeenCalled()
    if (process.platform === 'darwin') {
      expect(await safeStorageSecret(source, false, { INTOPONET_IMPORT_TEST_KEY: 'k' }, run)).toEqual({ ok: true, secret: 'secret' })
      expect(run).toHaveBeenCalledWith(['find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'])
      const denied = await safeStorageSecret(source, false, {}, async () => { throw new Error('denied') })
      expect(denied).toMatchObject({ ok: false })
    }
  })
})

describe('BrowserImportService', () => {
  it('finds Chrome and Arc profiles, and nothing else', () => {
    const { service, root } = fixture()
    expect(service.detect()).toEqual([
      { id: 'arc:Default', browser: 'arc', browserName: 'Arc', folder: 'Default', name: '' },
      { id: 'chrome:Default', browser: 'chrome', browserName: 'Google Chrome', folder: 'Default', name: 'Person 1' },
    ])
    expect(detectProfiles(join(root, 'nowhere'))).toEqual([])
  })

  it('previews counts per category before writing anything', () => {
    const { service, file, history, tabs } = fixture()
    const chrome = service.preview('chrome:Default')
    expect(chrome.counts.bookmarks.count).toBe(4)
    expect(chrome.folders).toBe(4)
    expect(chrome.counts.pinned.count).toBeNull()
    expect(chrome.counts.open.note).toMatch(/session files/)
    expect(chrome.counts.history.count).toBe(2)
    expect(chrome.counts.passwords.count).toBe(2)
    expect(chrome.counts.passwords.note).toMatch(/Chrome Safe Storage/)
    const arc = service.preview('arc:Default')
    expect(arc.counts.pinned.count).toBe(4)
    expect(arc.counts.open.count).toBe(2)
    expect(arc.counts.bookmarks.count).toBe(2)
    expect(file.data).toBeNull()
    expect(history.size).toBe(0)
    expect(tabs.add).not.toHaveBeenCalled()
  })

  it('imports only what was ticked, and a second run adds nothing', async () => {
    const { service, vault, history, open, runSecurity } = fixture()
    const first = await service.run('chrome:Default', ['bookmarks', 'history', 'passwords'])
    expect(first.added).toEqual({ pinned: 0, open: 0, history: 2, passwords: 1 })
    expect(first.skipped).toEqual(expect.arrayContaining([
      { category: 'bookmarks', count: 1, reason: expect.stringMatching(/not web addresses/) },
      { category: 'passwords', count: 1, reason: expect.stringMatching(/secure/) },
    ]))
    expect(runSecurity).not.toHaveBeenCalled()
    const library = JSON.parse(first.library!)
    expect(library.collections.map((collection: { label: string }) => collection.label)).toEqual(['Bookmarks bar', 'Travel', 'Travel › Japan', 'Other bookmarks'])
    expect(library.bookmarks).toHaveLength(4)
    expect(JSON.stringify(first)).not.toContain(FIXTURE_PASSWORD)
    expect((await vault.find('https://accounts.example.com', 'tester@example.com'))!.password).toBe(FIXTURE_PASSWORD)
    expect(history.search('').total).toBe(2)
    expect(open).toHaveLength(1)

    const second = await service.run('chrome:Default', ['bookmarks', 'history', 'passwords'])
    expect(second.added).toEqual({ pinned: 0, open: 0, history: 0, passwords: 0 })
    expect(second.skipped).toEqual(expect.arrayContaining([
      { category: 'history', count: 2, reason: 'already in your history' },
      { category: 'passwords', count: 1, reason: 'already saved for that site and username' },
    ]))
    expect((await vault.list())).toHaveLength(1)
  })

  it('opens Arc pinned tabs (with their home) and open tabs, once', async () => {
    const { service, open, tabs } = fixture()
    const first = await service.run('arc:Default', ['bookmarks', 'pinned', 'open'])
    expect(first.added).toEqual({ pinned: 4, open: 2, history: 0, passwords: 0 })
    expect(tabs.add).toHaveBeenCalledTimes(1)
    expect(open.filter((tab) => tab.pinned).map((tab) => tab.url)).toEqual(['https://mail.example.com/', 'https://docs.example.com/', 'https://chat.example.com/team', 'https://recipes.example.com/'])
    const labels = JSON.parse(first.library!).collections.map((collection: { label: string }) => collection.label)
    expect(labels).toEqual(['Work › Reading › Later', 'Work › Reading', 'Arc favourites', 'Work', 'Home'])
    const second = await service.run('arc:Default', ['pinned', 'open'])
    expect(second.added).toEqual({ pinned: 0, open: 0, history: 0, passwords: 0 })
    expect(open).toHaveLength(7)
  })

  it('says how many tabs were left out over the limit', async () => {
    const { service, open } = fixture()
    for (let index = 0; index < 9; index += 1) open.push({ url: `https://filler-${index}.example/`, title: '', pinned: false })
    const result = await service.run('arc:Default', ['pinned', 'open'])
    expect(result.added.pinned).toBe(2)
    expect(result.skipped).toEqual(expect.arrayContaining([{ category: 'pinned', count: 2, reason: expect.stringMatching(/12-tab limit/) }, { category: 'open', count: 2, reason: expect.stringMatching(/12-tab limit/) }]))
  })

  it('writes nothing when the sealed password write fails', async () => {
    const { service, file, history, tabs } = fixture()
    file.fail = true
    await expect(service.run('chrome:Default', ['bookmarks', 'history', 'passwords'])).rejects.toThrow()
    expect(history.size).toBe(0)
    expect(tabs.add).not.toHaveBeenCalled()
  })

  it('writes nothing when a source file cannot be read', async () => {
    const { service, root, history } = fixture()
    const historyFile = join(root, 'Google', 'Chrome', 'Default', 'History')
    rmSync(historyFile)
    mkdirSync(historyFile)
    // A folder where the file should be is not a file: the history is simply absent.
    expect((await service.run('chrome:Default', ['history'])).added.history).toBe(0)
    rmSync(historyFile, { recursive: true })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(historyFile, 'not a database')
    await expect(service.run('chrome:Default', ['history', 'bookmarks'])).rejects.toThrow(/could not be read/)
    expect(history.size).toBe(0)
  })

  it('leaves no copies behind and never writes to the source folders', async () => {
    const { service, root } = fixture()
    const profile = join(root, 'Google', 'Chrome', 'Default')
    const before = readdirSync(profile).map((name) => [name, statSync(join(profile, name)).mtimeMs])
    const copies = () => readdirSync(tmpdir()).filter((name) => name.startsWith('intoponet-import-') && !name.startsWith('intoponet-import-root-') && !name.startsWith('intoponet-import-test-'))
    const already = new Set(copies())
    service.preview('chrome:Default')
    await service.run('chrome:Default', ['bookmarks', 'history', 'passwords'])
    expect(copies().filter((name) => !already.has(name))).toEqual([])
    expect(readdirSync(profile).map((name) => [name, statSync(join(profile, name)).mtimeMs])).toEqual(before)
  })

  it('refuses profiles it did not find', async () => {
    const { service } = fixture()
    expect(() => service.preview('chrome:Profile 9')).toThrow(/no longer/)
    await expect(service.run('brave:Default', ['bookmarks'])).rejects.toThrow(/no longer/)
  })
})

describe('import commands', () => {
  it('accept profile ids and known categories only', () => {
    expect(parseBrowserImportCommand({ type: 'run', profileId: 'chrome:Profile 2', categories: ['passwords', 'bookmarks'] })).toEqual({ type: 'run', profileId: 'chrome:Profile 2', categories: ['bookmarks', 'passwords'] })
    expect(() => parseBrowserImportCommand({ type: 'preview', profileId: '../../etc' })).toThrow()
    expect(() => parseBrowserImportCommand({ type: 'preview', profileId: 'chrome:/Users/x' })).toThrow()
    expect(() => parseBrowserImportCommand({ type: 'run', profileId: 'chrome:Default', categories: ['cookies'] })).toThrow()
    expect(() => parseBrowserImportCommand({ type: 'run', profileId: 'chrome:Default', categories: 'bookmarks' })).toThrow()
  })
})
