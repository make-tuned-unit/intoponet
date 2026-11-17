import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { mergePrivateLibraries, parsePrivateLibrary, type PrivateLibraryDocument } from '@intoponet/local-knowledge'
import { workspaceName } from '@intoponet/browser-api'
import type { ImportCategory, ImportRunResult } from '../../shared/browserImport'
import { HistoryStore } from '../historyStore'
import { passwordOrigin } from '../passwords/origin'
import { PasswordVault, type VaultFile } from '../passwords/vault'
import { heldAddresses, planTabs, planWorkspaces, type ImportedTab, type WorkspaceImportPlan } from './plan'
import { BrowserImportService } from './service'
import { importRoot } from './sources'
import { FIXTURE_TEST_KEY, toChromiumTime, writeLogins } from './testFixtures'

/**
 * Switching in: what someone arriving from another browser may really have. Fixture profiles that are
 * empty, huge, damaged, duplicated, named in other scripts, or carrying addresses that are not web pages.
 * Each asserts the same things: nothing throws that should not, nothing unsafe arrives, the summary's
 * counts equal what arrived, and a second import adds nothing.
 */

const TAB_LIMIT = 12
const made: string[] = []
afterEach(() => {
  for (const folder of made.splice(0)) {
    try { chmodSync(folder, 0o700) } catch { /* gone */ }
    rmSync(folder, { recursive: true, force: true })
  }
})

type Bookmark = { type: 'url'; name: string; url: string; date_added?: string } | { type: 'folder'; name: string; children: Bookmark[] }
const bookmarksFile = (bar: Bookmark[], other: Bookmark[] = []): string => JSON.stringify({ version: 1, roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: bar }, other: { type: 'folder', name: 'Other bookmarks', children: other }, synced: { type: 'folder', name: 'Mobile bookmarks', children: [] } } })
const url = (name: string, address: string): Bookmark => ({ type: 'url', name, url: address, date_added: String(toChromiumTime(Date.UTC(2025, 5, 1))) })
const folder = (name: string, children: Bookmark[]): Bookmark => ({ type: 'folder', name, children })

type Item = { id: string; parentID: string | null; childrenIds: string[]; title: string | null; data: Record<string, unknown> }
/** A sidebar file in the newer layout, from a plain description of its spaces. */
type Node = { tab: string; title?: string } | { folder: string; children: Node[] } | { split: Node[] } | { note: string }
function sidebarFile(spaces: Array<{ title: string; pinned: Node[]; open: Node[] }>, favourites: Node[] = []): string {
  const items: Item[] = []
  let next = 0
  const add = (parentID: string, node: Node): string => {
    const id = `I${(next += 1)}`
    if ('tab' in node) items.push({ id, parentID, childrenIds: [], title: null, data: { tab: { savedURL: node.tab, savedTitle: node.title ?? node.tab } } })
    else if ('note' in node) items.push({ id, parentID, childrenIds: [], title: node.note, data: { easel: {} } })
    else {
      const item: Item = { id, parentID, childrenIds: [], title: 'folder' in node ? node.folder : null, data: 'folder' in node ? { list: {} } : { splitView: {} } }
      items.push(item)
      item.childrenIds = ('folder' in node ? node.children : node.split).map((child) => add(id, child))
    }
    return id
  }
  const container = (id: string, nodes: Node[]): void => {
    const item: Item = { id, parentID: null, childrenIds: [], title: null, data: { itemContainer: {} } }
    items.push(item)
    item.childrenIds = nodes.map((node) => add(id, node))
  }
  container('TOP', favourites)
  const list: unknown[] = []
  spaces.forEach((space, index) => {
    container(`P${index}`, space.pinned)
    container(`U${index}`, space.open)
    list.push(`S${index}`, { id: `S${index}`, title: space.title, profile: { default: true }, newContainerIDs: [{ pinned: {} }, `P${index}`, { unpinned: {} }, `U${index}`] })
  })
  return JSON.stringify({ sidebar: { containers: [{ global: {} }, { topAppsContainerIDs: [{ default: true }, 'TOP'], spaces: list, items: items.flatMap((item) => [item.id, item]) }] } })
}

type Held = { url: string; pinned: boolean; folder: string | null }
type Model = { workspaces: Array<{ id: string; name: string; tabs: Held[]; folders: string[] }>; favourites: string[] }

/** An app to import into: a library, a history, a password vault, and workspaces kept as main keeps them. */
function arrive(write: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'intoponet-import-root-'))
  made.push(root)
  write(root)
  const crypto = {
    available: async () => true,
    encrypt: async (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
    decrypt: async (data: Buffer) => ({ result: Buffer.from(data.toString().slice(7), 'base64').toString(), shouldReEncrypt: false }),
  }
  const file: VaultFile & { data: Buffer | null } = { data: null, read: () => file.data, write: (data) => { file.data = data } }
  const vault = new PasswordVault(crypto, file)
  const history = new HistoryStore({ excludedSites: () => [] })
  const model: Model = { workspaces: [{ id: 'main', name: 'Main', tabs: [], folders: [] }], favourites: [] }
  const shown = model.workspaces[0]!
  const env = { INTOPONET_IMPORT_ROOT: root, INTOPONET_IMPORT_TEST_KEY: FIXTURE_TEST_KEY }
  const service = new BrowserImportService({
    root: () => importRoot(env),
    tabs: { urls: () => shown.tabs.map((tab) => tab.url), room: () => TAB_LIMIT - shown.tabs.length, limit: TAB_LIMIT, add: (tabs: ImportedTab[]) => { shown.tabs.push(...tabs.map((tab) => ({ url: tab.url, pinned: tab.pinned, folder: null }))) } },
    history: () => history,
    passwords: () => ({ importLogins: (rows) => vault.importMany(rows) }),
    toOrigin: passwordOrigin,
    workspaces: {
      existing: () => model.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, urls: workspace.tabs.map((tab) => tab.url), room: TAB_LIMIT - workspace.tabs.length })),
      favouriteUrls: () => model.favourites,
      freeWorkspaces: () => 9 - model.workspaces.length,
      favouriteRoom: () => 12 - model.favourites.length,
      tabLimit: TAB_LIMIT,
      maxFolderDepth: 6,
      apply: (plan: WorkspaceImportPlan) => {
        for (const planned of plan.workspaces) {
          let workspace = model.workspaces.find((item) => item.id === planned.existingId)
          if (!workspace) model.workspaces.push(workspace = { id: `w${model.workspaces.length}`, name: planned.name, tabs: [], folders: [] })
          const walk = (folders: typeof planned.folders, path: string): void => {
            for (const item of folders) {
              const name = `${path}${item.name}`
              if (!workspace!.folders.includes(name)) workspace!.folders.push(name)
              workspace!.tabs.push(...item.tabs.map((page) => ({ url: page.url, pinned: false, folder: name })))
              walk(item.children, `${name}/`)
            }
          }
          workspace.tabs.push(...planned.pinned.map((page) => ({ url: page.url, pinned: true, folder: null })))
          walk(planned.folders, '')
          workspace.tabs.push(...planned.open.map((page) => ({ url: page.url, pinned: false, folder: null })))
          // A plan never asks for more than a workspace may hold.
          expect(workspace.tabs.length).toBeLessThanOrEqual(TAB_LIMIT)
        }
        model.favourites.push(...plan.favourites.map((page) => page.url))
      },
    },
    env,
    now: () => new Date('2026-11-16T00:00:00Z'),
  })
  let library: PrivateLibraryDocument = { schema: 'intoponet.private-library.v1', bookmarks: [], collections: [], recents: [], absorbed: [] }
  /** Import, then merge the library document the way the shell does; what the summary says and what is there. */
  const run = async (id: string, categories: ImportCategory[]): Promise<{ result: ImportRunResult; library: { bookmarks: number; collections: number } }> => {
    const result = await service.run(id, categories)
    const added = { bookmarks: 0, collections: 0 }
    if (result.library) {
      const incoming = parsePrivateLibrary(result.library)
      expect(incoming).not.toBeNull()
      const merged = mergePrivateLibraries(library, incoming!)
      library = merged.library
      added.bookmarks = merged.added.bookmarks
      added.collections = merged.added.collections
    }
    return { result, library: added }
  }
  return { root, service, run, model, history, vault, library: () => library }
}

const chromeProfile = (root: string): string => {
  const profile = join(root, 'Google', 'Chrome', 'Default')
  mkdirSync(profile, { recursive: true })
  return profile
}
const arcProfile = (root: string, sidebar: string | null): string => {
  const profile = join(root, 'Arc', 'User Data', 'Default')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'Bookmarks'), bookmarksFile([]))
  if (sidebar !== null) writeFileSync(join(root, 'Arc', 'StorableSidebar.json'), sidebar)
  return profile
}
const skippedOf = (result: ImportRunResult, category: ImportCategory): number => result.skipped.filter((item) => item.category === category).reduce((sum, item) => sum + item.count, 0)
const everyUrl = (model: Model): string[] => [...model.workspaces.flatMap((workspace) => workspace.tabs.map((tab) => tab.url)), ...model.favourites]
const pinnedAddresses = (nodes: Node[]): string[] => nodes.flatMap((node) => ('tab' in node ? [node.tab] : 'folder' in node ? pinnedAddresses(node.children) : 'split' in node ? pinnedAddresses(node.split) : []))
const onlyWeb = (urls: string[]): boolean => urls.every((address) => /^https?:\/\//.test(address))

/** A History file with these pages (one transaction: thousands of rows quickly). `wal`: as a running browser leaves it, the pages still in the write-ahead log. */
function historyFile(path: string, pages: Array<{ url: string; title: string; at: number }>, wal = false): void {
  const db = new DatabaseSync(path)
  if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;')
  db.exec('CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)')
  db.exec('BEGIN')
  const add = db.prepare('INSERT INTO urls(url, title, last_visit_time) VALUES (?, ?, ?)')
  for (const page of pages) add.run(page.url, page.title, toChromiumTime(page.at))
  db.exec('COMMIT')
  if (wal) {
    copyFileSync(path, `${path}.kept`)
    copyFileSync(`${path}-wal`, `${path}.kept-wal`)
    db.close()
    rmSync(path)
    rmSync(`${path}-wal`, { force: true })
    renameSync(`${path}.kept`, path)
    renameSync(`${path}.kept-wal`, `${path}-wal`)
  } else db.close()
}
const tabs = (count: number, host: string): Node[] => Array.from({ length: count }, (_, index) => ({ tab: `https://${host}.example/${index}`, title: `${host} ${index}` }))
const LONG = 30_000

describe('switching in from Chrome', () => {
  it('brings nothing from an empty profile, and says so without failing', async () => {
    const app = arrive((root) => { writeFileSync(join(chromeProfile(root), 'Bookmarks'), bookmarksFile([])) })
    const preview = app.service.preview('chrome:Default')
    expect([preview.counts.bookmarks.count, preview.counts.history.count, preview.counts.passwords.count, preview.folders]).toEqual([0, 0, 0, 0])
    const { result } = await app.run('chrome:Default', ['bookmarks', 'history', 'passwords'])
    expect(result).toEqual({ library: null, added: { pinned: 0, open: 0, history: 0, passwords: 0 }, skipped: [] })
  }, LONG)

  it.each([
    ['an empty file', ''],
    ['a file cut off part way', bookmarksFile([url('A', 'https://a.example/')]).slice(0, 60)],
    ['a list', '[]'],
    ['null', 'null'],
  ])('reads nothing from a bookmarks file that is %s, and imports nothing', async (_name, text) => {
    const app = arrive((root) => {
      const profile = chromeProfile(root)
      writeFileSync(join(profile, 'Bookmarks'), text)
      historyFile(join(profile, 'History'), [{ url: 'https://seen.example/', title: 'Seen', at: Date.UTC(2026, 10, 1) }])
    })
    expect(app.service.preview('chrome:Default').counts.bookmarks).toEqual({ count: 0, note: 'Google Chrome\'s bookmarks file could not be read.' })
    await expect(app.run('chrome:Default', ['bookmarks', 'history'])).rejects.toThrow(/could not be read\. Nothing was imported/)
    expect(app.history.size).toBe(0)
    // History alone still comes over: the damaged file is only in the way of what was read from it.
    expect((await app.run('chrome:Default', ['history'])).result.added.history).toBe(1)
  }, LONG)

  it('brings 5,000 bookmarks and folders 40 deep: every page arrives, and a second import adds none', async () => {
    const many: Bookmark[] = []
    for (let index = 0; index < 5_000; index += 1) many.push(url(`Page ${index}`, `https://site-${index % 700}.example/page/${index}`))
    let deep: Bookmark = folder('Level 40', [url('Deepest', 'https://deep.example/40')])
    for (let level = 39; level >= 1; level -= 1) deep = folder(`Level ${level}`, [url(`At ${level}`, `https://deep.example/${level}`), deep])
    const app = arrive((root) => { writeFileSync(join(chromeProfile(root), 'Bookmarks'), bookmarksFile([folder('Big', many.slice(0, 3_000)), ...many.slice(3_000, 4_000), deep], many.slice(4_000))) })
    const preview = app.service.preview('chrome:Default')
    expect(preview.counts.bookmarks.count).toBe(5_040)
    const first = await app.run('chrome:Default', ['bookmarks'])
    expect(first.result.skipped).toEqual([])
    expect(first.library.bookmarks).toBe(5_040)
    expect(first.library.collections).toBe(preview.folders)
    expect(app.library().bookmarks).toHaveLength(5_040)
    // Folders nested deeper than a collection's name can say keep their pages: none is dropped.
    expect(app.library().bookmarks.filter((bookmark) => bookmark.url.startsWith('https://deep.example/'))).toHaveLength(40)
    expect(new Set(app.library().collections.flatMap((collection) => collection.memberUrls)).size).toBe(5_040)
    const second = await app.run('chrome:Default', ['bookmarks'])
    expect(second.library).toEqual({ bookmarks: 0, collections: 0 })
    expect(app.library().bookmarks).toHaveLength(5_040)
    expect(app.library().collections).toHaveLength(preview.folders)
  }, LONG)

  it('leaves out every address that is not a web page, and counts them', async () => {
    const unsafe = ['javascript:alert(document.cookie)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<script>alert(1)</script>', 'chrome://settings', 'about:blank', 'blob:https://x.example/1', 'https://user:pw@bank.example/', 'ftp://files.example/', 'view-source:https://a.example/']
    const app = arrive((root) => { writeFileSync(join(chromeProfile(root), 'Bookmarks'), bookmarksFile([...unsafe.map((address, index) => url(`Unsafe ${index}`, address)), url('Fine', 'https://ok.example/')])) })
    expect(app.service.preview('chrome:Default').counts.bookmarks.count).toBe(1)
    const { result, library } = await app.run('chrome:Default', ['bookmarks'])
    expect(library.bookmarks).toBe(1)
    expect(skippedOf(result, 'bookmarks')).toBe(unsafe.length)
    expect(app.library().bookmarks.map((bookmark) => bookmark.url)).toEqual(['https://ok.example/'])
    expect(onlyWeb(app.library().collections.flatMap((collection) => collection.memberUrls))).toBe(true)
  }, LONG)

  it('keeps names in any script, and files a page saved several times once', async () => {
    const long = '旅行 ✈️ 👨‍👩‍👧‍👦'.repeat(12)
    const app = arrive((root) => {
      writeFileSync(join(chromeProfile(root), 'Bookmarks'), bookmarksFile([
        folder('أخبار العالم', [url('الجزيرة', 'https://www.aljazeera.net/'), url('עברית', 'https://he.wikipedia.org/wiki/עברית')]),
        folder(long, [url('日本'.repeat(120), 'https://ja.wikipedia.org/wiki/日本')]),
        folder('Dup', [url('One', 'https://dup.example/'), url('One again', 'https://dup.example/')]),
        folder('Dup', [url('One a third time', 'https://dup.example/')]),
        folder('dup', [url('Other', 'https://dup.example/other')]),
        folder('', [url('', 'https://untitled.example/')]),
      ]))
    })
    const preview = app.service.preview('chrome:Default')
    const first = await app.run('chrome:Default', ['bookmarks'])
    expect(first.library).toEqual({ bookmarks: preview.counts.bookmarks.count, collections: preview.folders })
    expect(first.library).toEqual({ bookmarks: 6, collections: 4 })
    const labels = app.library().collections.map((collection) => collection.label)
    expect(labels).toEqual(['أخبار العالم', long.slice(0, 80), 'Dup', 'Untitled folder'])
    expect(app.library().collections[2]!.memberUrls).toEqual(['https://dup.example/', 'https://dup.example/other'])
    expect(app.library().bookmarks.find((bookmark) => bookmark.url === 'https://www.aljazeera.net/')!.title).toBe('الجزيرة')
    expect(app.library().bookmarks.find((bookmark) => bookmark.url === 'https://untitled.example/')!.title).toBe('https://untitled.example/')
    expect(app.library().bookmarks.every((bookmark) => bookmark.title.length <= 180)).toBe(true)
    expect((await app.run('chrome:Default', ['bookmarks'])).library).toEqual({ bookmarks: 0, collections: 0 })
  }, LONG)

  it('imports nothing when a ticked history or passwords file is damaged or cannot be opened', async () => {
    const app = arrive((root) => {
      const profile = chromeProfile(root)
      writeFileSync(join(profile, 'Bookmarks'), bookmarksFile([url('A', 'https://a.example/')]))
      writeFileSync(join(profile, 'History'), Buffer.alloc(4_096, 7))
      writeLogins(join(profile, 'Login Data'), FIXTURE_TEST_KEY, [{ origin: 'https://a.example/', username: 'u', password: 'p' }])
      chmodSync(join(profile, 'Login Data'), 0o000)
    })
    try {
      const preview = app.service.preview('chrome:Default')
      expect(preview.counts.history).toEqual({ count: null, note: expect.stringMatching(/history file could not be read/) })
      expect(preview.counts.passwords).toEqual({ count: null, note: expect.stringMatching(/passwords file could not be read/) })
      await expect(app.run('chrome:Default', ['bookmarks', 'history'])).rejects.toThrow(/nothing was imported/)
      await expect(app.run('chrome:Default', ['bookmarks', 'passwords'])).rejects.toThrow(/nothing was imported/)
      expect(app.library().bookmarks).toHaveLength(0)
      expect(await app.vault.list()).toHaveLength(0)
      expect((await app.run('chrome:Default', ['bookmarks'])).library.bookmarks).toBe(1)
    } finally {
      chmodSync(join(app.root, 'Google', 'Chrome', 'Default', 'Login Data'), 0o600)
    }
  }, LONG)

  it('brings the newest 5,000 of a long history, web pages only, and says how many were left', async () => {
    const pages: Array<{ url: string; title: string; at: number }> = []
    for (let index = 0; index < 5_200; index += 1) pages.push({ url: `https://h${index % 50}.example/p/${index}`, title: `T${index}`, at: Date.UTC(2026, 10, 1) - index * 60_000 })
    pages.push({ url: 'file:///Users/someone/secret.html', title: 'file', at: Date.UTC(2026, 10, 2) }, { url: 'javascript:1', title: 'js', at: Date.UTC(2026, 10, 2) })
    const app = arrive((root) => { historyFile(join(chromeProfile(root), 'History'), pages) })
    expect(app.service.preview('chrome:Default').counts.history).toEqual({ count: 5_200, note: 'The newest 5,000 pages come over.' })
    const first = await app.run('chrome:Default', ['history'])
    expect(first.result.added.history).toBe(5_000)
    expect(app.history.search('').total).toBe(5_000)
    expect(skippedOf(first.result, 'history')).toBe(200)
    expect(app.history.search('secret').total + app.history.search('javascript').total).toBe(0)
    const second = await app.run('chrome:Default', ['history'])
    expect(second.result.added.history).toBe(0)
    expect(app.history.search('').total).toBe(5_000)
  }, LONG)

  it('reads a history the browser is still writing (its newest pages in the write-ahead log)', async () => {
    const app = arrive((root) => { historyFile(join(chromeProfile(root), 'History'), [{ url: 'https://wal.example/', title: 'Wal', at: Date.UTC(2026, 10, 1) }], true) })
    expect(app.service.preview('chrome:Default').counts.history.count).toBe(1)
    expect((await app.run('chrome:Default', ['history'])).result.added.history).toBe(1)
  }, LONG)
})

describe('switching in from Arc', () => {
  it('makes nothing from a sidebar with no spaces, and a workspace from each empty space', async () => {
    const none = arrive((root) => { arcProfile(root, sidebarFile([])) })
    expect(none.service.preview('arc:Default').counts.workspaces.count).toBe(0)
    expect((await none.run('arc:Default', ['workspaces', 'pinned', 'open'])).result).toMatchObject({ library: null, added: { workspaces: 0, pinned: 0, open: 0 }, skipped: [] })
    expect(none.model.workspaces).toHaveLength(1)
    const empty = arrive((root) => { arcProfile(root, sidebarFile([{ title: '', pinned: [], open: [] }, { title: 'Empty', pinned: [], open: [] }])) })
    expect((await empty.run('arc:Default', ['workspaces'])).result.added.workspaces).toBe(2)
    expect(empty.model.workspaces.map((workspace) => workspace.name)).toEqual(['Main', 'Space 1', 'Empty'])
    expect((await empty.run('arc:Default', ['workspaces'])).result.added.workspaces).toBe(0)
    expect(empty.model.workspaces).toHaveLength(3)
  }, LONG)

  it.each([
    ['cut off part way', sidebarFile([{ title: 'W', pinned: tabs(2, 'a'), open: [] }]).slice(0, 200)],
    ['empty', ''],
    ['in a shape it does not know', '{"sidebar":{"containers":[]}}'],
  ])('reads nothing from a sidebar file that is %s, and makes no workspace', async (_name, text) => {
    const app = arrive((root) => { arcProfile(root, text) })
    expect(app.service.preview('arc:Default').counts.workspaces).toEqual({ count: null, note: expect.stringMatching(/not in a format Intoponet knows/) })
    await expect(app.run('arc:Default', ['workspaces', 'pinned', 'open'])).rejects.toThrow(/Nothing was imported/)
    expect(app.model.workspaces).toHaveLength(1)
    expect(app.model.favourites).toHaveLength(0)
  }, LONG)

  it('says the sidebar file is missing instead of failing', () => {
    const app = arrive((root) => { historyFile(join(arcProfile(root, null), 'History'), []) })
    expect(app.service.preview('arc:Default').counts.workspaces).toEqual({ count: null, note: expect.stringMatching(/was not found/) })
  }, LONG)

  it('brings a huge sidebar within every limit, says what was left out, and keeps what found no room in collections', async () => {
    let deep: Node = { folder: 'L20', children: [{ tab: 'https://deep.example/20' }] }
    for (let level = 19; level >= 1; level -= 1) deep = { folder: `L${level}`, children: [{ tab: `https://deep.example/${level}` }, deep] }
    const spaces = [
      { title: 'Work', pinned: [...tabs(30, 'pin'), { folder: 'Big', children: tabs(40, 'big') }, deep], open: tabs(130, 'open') },
      ...Array.from({ length: 11 }, (_, index) => ({ title: `Space ${index}`, pinned: tabs(2, `s${index}p`), open: tabs(2, `s${index}o`) })),
    ]
    const app = arrive((root) => { arcProfile(root, sidebarFile(spaces, tabs(20, 'fav'))) })
    const preview = app.service.preview('arc:Default')
    expect(preview.counts.workspaces.count).toBe(12)
    expect(preview.spaces![0]).toEqual({ name: 'Work', pinned: 30, folders: 21, foldered: 60, open: 130 })
    const first = await app.run('arc:Default', ['workspaces', 'pinned', 'open'])
    // The summary's counts are what arrived.
    const held = app.model.workspaces.slice(1)
    expect(first.result.added).toMatchObject({
      workspaces: held.length,
      pinned: held.reduce((sum, workspace) => sum + workspace.tabs.filter((tab) => tab.pinned).length, 0),
      foldered: held.reduce((sum, workspace) => sum + workspace.tabs.filter((tab) => tab.folder).length, 0),
      open: held.reduce((sum, workspace) => sum + workspace.tabs.filter((tab) => !tab.pinned && !tab.folder).length, 0),
      favourites: app.model.favourites.length,
    })
    expect(first.result.added).toMatchObject({ workspaces: 8, pinned: 26, foldered: 0, open: 14, favourites: 12 })
    expect(held.every((workspace) => workspace.tabs.length <= TAB_LIMIT)).toBe(true)
    // Pinned tabs, tabs in folders, open tabs and favourites that found no room are in collections named after their spaces.
    const kept = new Map(app.library().collections.map((collection) => [collection.label, collection.memberUrls]))
    expect(kept.get('Work')).toHaveLength(18 + 60 + 130)
    expect(kept.get('Work')!.filter((address) => address.startsWith('https://open.example/'))).toHaveLength(130)
    expect(kept.get('Work')!.filter((address) => address.startsWith('https://deep.example/'))).toHaveLength(20)
    expect(kept.get('Imported favourites')).toHaveLength(8)
    expect(kept.get('Space 7')).toEqual(['https://s7p.example/0', 'https://s7p.example/1', 'https://s7o.example/0', 'https://s7o.example/1'])
    expect(kept.get('Space 10')).toHaveLength(4)
    expect(first.result.skipped).toEqual(expect.arrayContaining([
      { category: 'workspaces', count: 4, reason: 'spaces over the limit of workspaces (their pinned tabs, the tabs in their folders and their open tabs are kept in collections named after them)' },
      { category: 'workspaces', count: 18 + 60 + 130 + 8, reason: 'tabs over the 12-tab limit of a workspace (they are kept in collections named after their spaces)' },
    ]))
    // Every pinned tab, foldered tab and favourite is either in a workspace, in the favourites row, or in a collection.
    const everywhere = new Set([...everyUrl(app.model), ...app.library().bookmarks.map((bookmark) => bookmark.url)])
    for (const space of spaces) for (const address of pinnedAddresses(space.pinned)) expect(everywhere.has(address)).toBe(true)
    for (let index = 0; index < 20; index += 1) expect(everywhere.has(`https://fav.example/${index}`)).toBe(true)
    // And every open tab: over the limit of its workspace, or in a space that got no workspace, it is kept, not only counted.
    for (const space of spaces) for (const address of pinnedAddresses(space.open)) expect(everywhere.has(address)).toBe(true)
    // Again: nothing more arrives, in the workspaces or the library.
    const second = await app.run('arc:Default', ['workspaces', 'pinned', 'open'])
    expect(second.result.added).toMatchObject({ workspaces: 0, pinned: 0, foldered: 0, open: 0, favourites: 0 })
    expect(second.library).toEqual({ bookmarks: 0, collections: 0 })
    expect(app.model.workspaces.slice(1).map((workspace) => workspace.tabs.length)).toEqual([12, 4, 4, 4, 4, 4, 4, 4])
  }, LONG)

  it('leaves out addresses that are not web pages, keeps names in any script, and makes one workspace for a name used twice', async () => {
    const app = arrive((root) => {
      arcProfile(root, sidebarFile([
        { title: 'مساحة العمل 👩‍💻 with a very long name that goes on and on and on', pinned: [{ tab: 'javascript:alert(1)' }, { tab: 'file:///etc/passwd' }, { tab: 'data:text/html,hi' }, { tab: 'arc://settings' }, { tab: 'https://u:p@x.example/' }, { tab: 'https://ok.example/', title: 'تجربة' }, { folder: '📚'.repeat(50), children: [{ tab: 'https://ok.example/' }, { tab: 'https://two.example/' }, { tab: 'javascript:void(0)' }] }, { split: [{ tab: 'https://split-a.example/' }, { tab: 'chrome://newtab' }] }, { note: 'A note' }], open: [{ tab: 'https://ok.example/' }, { tab: 'https://open.example/' }, { tab: 'about:blank' }] },
        { title: 'מרחב', pinned: [{ tab: 'https://ok.example/' }], open: [] },
        { title: 'מרחב', pinned: [{ tab: 'https://second.example/' }], open: [] },
      ], [{ tab: 'https://fav.example/' }, { tab: 'https://fav.example/' }, { tab: 'javascript:alert(2)' }]))
    })
    const first = await app.run('arc:Default', ['workspaces', 'pinned', 'open'])
    expect(onlyWeb(everyUrl(app.model))).toBe(true)
    expect(first.result.added).toMatchObject({ workspaces: 2, pinned: 4, foldered: 1, open: 1, favourites: 1 })
    expect(app.model.favourites).toEqual(['https://fav.example/'])
    const [, work, shared] = app.model.workspaces
    expect(work!.tabs.map((tab) => tab.url)).toEqual(['https://ok.example/', 'https://split-a.example/', 'https://two.example/', 'https://open.example/'])
    expect(shared).toMatchObject({ name: 'מרחב', tabs: [{ url: 'https://ok.example/' }, { url: 'https://second.example/' }] })
    // A workspace's name as the app keeps it: at most 40 characters and no space at its end, so the
    // same space is found again after a restart (when the saved name is read back trimmed).
    expect(work!.name).toBe('مساحة العمل 👩‍💻 with a very long name')
    expect(workspaceName(work!.name)).toBe(work!.name)
    const second = await app.run('arc:Default', ['workspaces', 'pinned', 'open'])
    expect(second.result.added).toMatchObject({ workspaces: 0, pinned: 0, foldered: 0, open: 0, favourites: 0 })
    expect(app.model.workspaces).toHaveLength(3)
    // The tabs that are not web pages are said, with their count, as a browser's bookmarks are: seven pinned
    // or in a folder or split view, a favourite, and one open tab (the note is not a tab).
    expect(first.result.skipped).toEqual(expect.arrayContaining([
      { category: 'pinned', count: 8, reason: 'not web addresses (javascript:, file: or browser pages)' },
      { category: 'open', count: 1, reason: 'not web addresses (javascript:, file: or browser pages)' },
    ]))
  }, LONG)

  it('keeps open tabs over the limit in a collection named after their space, without spaces as workspaces too', async () => {
    const app = arrive((root) => {
      arcProfile(root, sidebarFile([
        { title: 'Work', pinned: tabs(3, 'pin'), open: [...tabs(10, 'work'), { tab: 'arc://boost' }] },
        { title: 'Home', pinned: [], open: tabs(6, 'home') },
      ]))
    })
    const first = await app.run('arc:Default', ['pinned', 'open'])
    // The open workspace holds 12: the 3 pinned tabs and Work's first 9 open tabs.
    expect(first.result.added).toMatchObject({ pinned: 3, open: 9 })
    expect(first.result.skipped).toEqual(expect.arrayContaining([
      { category: 'open', count: 7, reason: 'over the 12-tab limit (they are in the collection named after their space)' },
      { category: 'open', count: 1, reason: 'not web addresses (javascript:, file: or browser pages)' },
    ]))
    const kept = new Map(app.library().collections.map((collection) => [collection.label, collection.memberUrls]))
    expect(kept.get('Work')).toEqual([...tabs(3, 'pin').map((node) => (node as { tab: string }).tab), 'https://work.example/9'])
    expect(kept.get('Home')).toEqual(tabs(6, 'home').map((node) => (node as { tab: string }).tab))
    const everywhere = new Set([...everyUrl(app.model), ...app.library().bookmarks.map((bookmark) => bookmark.url)])
    for (const node of [...tabs(10, 'work'), ...tabs(6, 'home')]) expect(everywhere.has((node as { tab: string }).tab)).toBe(true)
    expect(onlyWeb([...everywhere])).toBe(true)
    // Again: the same tabs find no room, and the library gains nothing.
    const second = await app.run('arc:Default', ['pinned', 'open'])
    expect(second.result.added).toMatchObject({ pinned: 0, open: 0 })
    expect(second.library).toEqual({ bookmarks: 0, collections: 0 })
    expect(app.library().collections.map((collection) => collection.label).sort()).toEqual(['Home', 'Work'])
  }, LONG)

  it('still brings the spaces, tabs and history when the profile\'s bookmarks file is damaged and Bookmarks is ticked, and names the file', async () => {
    const app = arrive((root) => {
      const profile = arcProfile(root, sidebarFile([{ title: 'W', pinned: [{ tab: 'https://pin.example/' }, { folder: 'F', children: tabs(2, 'a') }], open: tabs(1, 'o') }]))
      writeFileSync(join(profile, 'Bookmarks'), '{"roots":')
      historyFile(join(profile, 'History'), [{ url: 'https://visited.example/', title: 'Visited', at: Date.UTC(2026, 10, 1) }])
    })
    expect(app.service.preview('arc:Default').counts.bookmarks.note).toMatch(/bookmarks file could not be read/)
    const first = await app.run('arc:Default', ['bookmarks', 'workspaces', 'pinned', 'open', 'history'])
    expect(first.result.added).toMatchObject({ workspaces: 1, pinned: 1, foldered: 2, open: 1, history: 1 })
    expect(first.result.notes).toEqual(['Arc\'s “Bookmarks” file could not be read, so the bookmarks in it were left out'])
    expect(app.model.workspaces[1]!.tabs.map((tab) => tab.url)).toEqual(['https://pin.example/', 'https://a.example/0', 'https://a.example/1', 'https://o.example/0'])
    expect(app.history.size).toBe(1)
    // The sidebar's folders still become collections, as Bookmarks asks.
    expect(app.library().collections.map((collection) => collection.label)).toEqual(['W › F'])
    // Without spaces as workspaces too.
    const flat = arrive((root) => {
      const profile = arcProfile(root, sidebarFile([{ title: 'W', pinned: [{ tab: 'https://pin.example/' }], open: tabs(1, 'o') }]))
      writeFileSync(join(profile, 'Bookmarks'), '{"roots":')
    })
    const flatRun = await flat.run('arc:Default', ['bookmarks', 'pinned', 'open'])
    expect(flatRun.result.added).toMatchObject({ pinned: 1, open: 1 })
    expect(flatRun.result.notes).toHaveLength(1)
    // With nothing else to bring (no sidebar either), it fails as before and says why.
    const bare = arrive((root) => { writeFileSync(join(arcProfile(root, null), 'Bookmarks'), '{"roots":') })
    await expect(bare.run('arc:Default', ['bookmarks'])).rejects.toThrow(/bookmarks file could not be read\. Nothing was imported/)
    // A browser whose bookmarks are what it has to bring still fails whole.
    const chrome = arrive((root) => { writeFileSync(join(chromeProfile(root), 'Bookmarks'), '{"roots":') })
    await expect(chrome.run('chrome:Default', ['bookmarks'])).rejects.toThrow(/Nothing was imported/)
  }, LONG)
})

describe('the browsers the site names', () => {
  it.each([
    ['Google Chrome', join('Google', 'Chrome'), 'chrome:Default'],
    ['Brave', join('BraveSoftware', 'Brave-Browser'), 'brave:Default'],
    ['Microsoft Edge', 'Microsoft Edge', 'edge:Default'],
    ['Vivaldi', 'Vivaldi', 'vivaldi:Default'],
  ])('finds %s and brings its bookmarks, folders, history and passwords; its tabs are said to be left out', async (name, where, id) => {
    const app = arrive((root) => {
      const profile = join(root, where, 'Default')
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(profile, 'Bookmarks'), bookmarksFile([url('A', 'https://a.example/'), folder('Reading', [url('B', 'https://b.example/')])]))
      historyFile(join(profile, 'History'), [{ url: 'https://seen.example/', title: 'Seen', at: Date.UTC(2026, 10, 1) }])
      writeLogins(join(profile, 'Login Data'), FIXTURE_TEST_KEY, [{ origin: 'https://a.example/', username: 'someone', password: 'kept-secret' }])
    })
    expect(app.service.detect()).toEqual([expect.objectContaining({ id, browserName: name })])
    const preview = app.service.preview(id)
    expect([preview.counts.bookmarks.count, preview.folders, preview.counts.history.count, preview.counts.passwords.count]).toEqual([2, 2, 1, 1])
    // Open and pinned tabs come over from Arc only: for these browsers the preview says so instead of a count.
    expect(preview.counts.pinned).toEqual({ count: null, note: expect.stringMatching(/cannot be read reliably and are left out/) })
    expect(preview.counts.open.count).toBeNull()
    expect(preview.counts.workspaces.count).toBeNull()
    const { result, library } = await app.run(id, ['bookmarks', 'history', 'passwords'])
    expect(library).toEqual({ bookmarks: 2, collections: 2 })
    expect(result.added).toMatchObject({ history: 1, passwords: 1, pinned: 0, open: 0 })
    expect((await app.vault.find('https://a.example', 'someone'))?.password).toBe('kept-secret')
  }, LONG)
})

describe('importing again after the imported tabs have been used', () => {
  // A pinned tab came in at its home and has since moved on within the site.
  const pinned = { url: 'https://docs.example.com/drafts/7', home: 'https://docs.example.com/' }
  const open = { url: 'https://news.example.com/today' }

  it('counts a pinned tab as its home too, so it is not imported a second time', () => {
    expect(heldAddresses(pinned)).toEqual(['https://docs.example.com/drafts/7', 'https://docs.example.com/'])
    expect(heldAddresses(open)).toEqual(['https://news.example.com/today'])
    expect(heldAddresses({ url: 'https://a.example/', home: 'https://a.example/' })).toEqual(['https://a.example/'])
    const flat = planTabs([{ url: 'https://docs.example.com/', title: 'Docs' }], [{ url: 'https://news.example.com/today', title: 'Today' }], [pinned, open].flatMap(heldAddresses), 10)
    expect(flat).toMatchObject({ add: [], duplicates: 2 })
    const spaces = planWorkspaces({
      spaces: [{ title: 'Work', tree: [{ kind: 'tab', url: 'https://docs.example.com/', title: 'Docs' }], open: [{ url: 'https://news.example.com/today', title: 'Today' }] }],
      favourites: [], existing: [{ id: 'w1', name: 'Work', urls: [pinned, open].flatMap(heldAddresses), room: 10 }], existingFavourites: [], freeWorkspaces: 8, tabLimit: 12, favouriteRoom: 12, include: { pinned: true, open: true }, maxFolderDepth: 6,
    })
    expect(spaces.workspaces).toEqual([])
    expect(spaces.skipped.duplicates).toBe(2)
    // Without the home it would come in again.
    expect(planTabs([{ url: 'https://docs.example.com/', title: 'Docs' }], [], [pinned.url], 10).add).toHaveLength(1)
  })
})
