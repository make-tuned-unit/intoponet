import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromiumKey, encryptChromiumPassword } from './chromiumLogins'

/**
 * Fixture browser profiles for tests, built in a temporary folder (never the real ~/Library).
 * experiments/e2e/checks.mjs builds the same profiles for the end-to-end check.
 */

export const FIXTURE_TEST_KEY = 'fixture-safe-storage-secret'
export const FIXTURE_PASSWORD = 'Imported-Pa55word!'

/** Microseconds since 1601, as Chromium stores times. */
export const toChromiumTime = (ms: number): bigint => (BigInt(Math.round(ms)) + 11_644_473_600_000n) * 1000n

export const chromeBookmarks = (added = toChromiumTime(Date.UTC(2025, 0, 2))): string => JSON.stringify({
  checksum: 'x',
  version: 1,
  roots: {
    bookmark_bar: {
      type: 'folder', name: 'Bookmarks bar', children: [
        { type: 'url', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page', date_added: String(added) },
        { type: 'url', name: 'Bookmarklet', url: 'javascript:alert(1)' },
        { type: 'folder', name: 'Travel', children: [
          { type: 'url', name: 'Fiji', url: 'https://en.wikipedia.org/wiki/Fiji' },
          { type: 'folder', name: 'Japan', children: [
            { type: 'url', name: 'Kyoto', url: 'https://en.wikipedia.org/wiki/Kyoto' },
            { type: 'url', name: 'Fiji again', url: 'https://en.wikipedia.org/wiki/Fiji' },
          ] },
        ] },
      ],
    },
    other: { type: 'folder', name: 'Other bookmarks', children: [{ type: 'url', name: 'RNZ', url: 'https://www.rnz.co.nz/pacific' }] },
    synced: { type: 'folder', name: 'Mobile bookmarks', children: [] },
  },
})

export function writeHistory(path: string, pages: Array<{ url: string; title: string; at: number; hidden?: boolean }>): void {
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);
    CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER NOT NULL, visit_time INTEGER NOT NULL, from_visit INTEGER, transition INTEGER DEFAULT 0 NOT NULL);`)
  const addUrl = db.prepare('INSERT INTO urls(url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, 1, ?, ?)')
  const addVisit = db.prepare('INSERT INTO visits(url, visit_time) VALUES (?, ?)')
  for (const page of pages) {
    const { lastInsertRowid } = addUrl.run(page.url, page.title, toChromiumTime(page.at - 60_000), page.hidden ? 1 : 0)
    addVisit.run(lastInsertRowid, toChromiumTime(page.at))
  }
  db.close()
}

export function writeLogins(path: string, secret: string, logins: Array<{ origin: string; username: string; password: string; never?: boolean }>): void {
  const key = chromiumKey(secret)
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE logins(origin_url VARCHAR NOT NULL, action_url VARCHAR, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL DEFAULT 0, blacklisted_by_user INTEGER NOT NULL DEFAULT 0)`)
  const add = db.prepare('INSERT INTO logins(origin_url, username_value, password_value, signon_realm, blacklisted_by_user) VALUES (?, ?, ?, ?, ?)')
  for (const login of logins) add.run(login.origin, login.username, login.password ? encryptChromiumPassword(login.password, key) : Buffer.alloc(0), login.origin, login.never ? 1 : 0)
  db.close()
}

/** Two spaces in Default (Work, Home) and one in Profile 1, with pinned tabs, nested folders, open tabs, a note and a favourite (newer layout: object markers in `newContainerIDs`, `childrenIds` for order). Built by hand, not from a real file. */
export const arcSidebar = (): string => JSON.stringify({
  sidebarSyncState: {},
  sidebar: {
    containers: [
      { global: {} },
      {
        topAppsContainerIDs: [{ default: true }, 'TOP'],
        spaces: [
          'S1', { id: 'S1', title: 'Work', profile: { default: true }, newContainerIDs: [{ pinned: {} }, 'P1', { unpinned: { _0: { shared: {} } } }, 'U1'] },
          'S2', { id: 'S2', title: 'Home', profile: { default: true }, containerIDs: ['pinned', 'P2', 'unpinned', 'U2'] },
          'S3', { id: 'S3', title: 'Other profile', profile: { custom: { _0: { directoryBasename: 'Profile 1' } } }, newContainerIDs: [{ pinned: {} }, 'P3', { unpinned: {} }, 'U3'] },
        ],
        items: [
          'TOP', { id: 'TOP', parentID: null, childrenIds: ['FAV'], data: { itemContainer: { containerType: { topApps: { _0: { default: true } } } } } },
          'FAV', { id: 'FAV', parentID: 'TOP', childrenIds: [], title: null, data: { tab: { savedURL: 'https://mail.example.com/', savedTitle: 'Mail' } } },
          'P1', { id: 'P1', parentID: null, childrenIds: ['T2', 'T1', 'F1', 'N1'], title: null, data: { itemContainer: { containerType: { spaceItems: { _0: 'S1' } } } } },
          'T1', { id: 'T1', parentID: 'P1', childrenIds: [], title: 'Team chat', data: { tab: { savedURL: 'https://chat.example.com/team', savedTitle: 'Chat – Example' } } },
          'T2', { id: 'T2', parentID: 'P1', childrenIds: [], title: null, data: { tab: { savedURL: 'https://docs.example.com/', savedTitle: 'Docs' } } },
          'F1', { id: 'F1', parentID: 'P1', childrenIds: ['T3', 'F2'], title: 'Reading', data: { list: {} } },
          'T3', { id: 'T3', parentID: 'F1', childrenIds: [], title: null, data: { tab: { savedURL: 'https://en.wikipedia.org/wiki/Tonga', savedTitle: 'Tonga' } } },
          'F2', { id: 'F2', parentID: 'F1', childrenIds: ['T4'], title: 'Later', data: { list: {} } },
          'T4', { id: 'T4', parentID: 'F2', childrenIds: [], title: null, data: { tab: { savedURL: 'https://en.wikipedia.org/wiki/Samoa', savedTitle: 'Samoa' } } },
          'N1', { id: 'N1', parentID: 'P1', childrenIds: [], title: 'A note', data: { easel: {} } },
          'U1', { id: 'U1', parentID: null, childrenIds: ['O1'], title: null, data: { itemContainer: {} } },
          'O1', { id: 'O1', parentID: 'U1', childrenIds: [], title: null, data: { tab: { savedURL: 'https://news.example.com/today', savedTitle: 'Today' } } },
          'P2', { id: 'P2', parentID: null, childrenIds: ['T5'], title: null, data: { itemContainer: {} } },
          'T5', { id: 'T5', parentID: 'P2', childrenIds: [], title: null, data: { tab: { savedURL: 'https://recipes.example.com/', savedTitle: 'Recipes' } } },
          'U2', { id: 'U2', parentID: null, childrenIds: ['O2'], title: null, data: { itemContainer: {} } },
          'O2', { id: 'O2', parentID: 'U2', childrenIds: [], title: null, data: { tab: { savedURL: 'https://weather.example.com/', savedTitle: 'Weather' } } },
          'P3', { id: 'P3', parentID: null, childrenIds: ['T6'], title: null, data: { itemContainer: {} } },
          'T6', { id: 'T6', parentID: 'P3', childrenIds: [], title: null, data: { tab: { savedURL: 'https://elsewhere.example.com/', savedTitle: 'Elsewhere' } } },
          'U3', { id: 'U3', parentID: null, childrenIds: [], title: null, data: { itemContainer: {} } },
        ],
      },
    ],
  },
})

/**
 * The sidebar file in an older layout: spaces name their containers with plain strings
 * (`containerIDs: ["pinned", id, "unpinned", id]`), items carry no `childrenIds` (their order is
 * the order of the list), spaces have no `profile`, and favourites sit in a plain id list. Fields
 * the importer does not know (`customInfo`, `createdAt`, `isUnread`…) are sprinkled through.
 *
 * Like arcSidebar() above, this is NOT a copy of a real file: both are built by hand from the
 * structure community exporters publicly document, with made-up spaces and example addresses.
 */
export const arcSidebarOlderLayout = (): string => JSON.stringify({
  version: 1,
  sidebar: {
    containers: [
      { global: {}, unknownSetting: true },
      {
        topAppsContainerIDs: ['TOP'],
        spaces: [
          'A', { id: 'A', title: 'Travel', containerIDs: ['pinned', 'AP', 'unpinned', 'AU'], customInfo: { iconType: { emoji_v2: '✈️' } }, createdAt: 700000000 },
          'B', { id: 'B', title: '', containerIDs: ['pinned', 'BP', 'unpinned', 'BU'] },
        ],
        items: [
          'TOP', { id: 'TOP', parentID: null, data: { itemContainer: {} } },
          { id: 'FAV1', parentID: 'TOP', data: { tab: { savedURL: 'https://maps.example.com/', savedTitle: 'Maps' } }, isUnread: false },
          { id: 'FAV2', parentID: 'TOP', data: { tab: { savedURL: 'https://calendar.example.com/', savedTitle: 'Calendar' } } },
          { id: 'AP', parentID: null, data: { itemContainer: {} } },
          { id: 'AT1', parentID: 'AP', title: 'Flights', data: { tab: { savedURL: 'https://flights.example.com/', savedTitle: 'Flights – search' } } },
          { id: 'AF1', parentID: 'AP', title: 'Japan', data: { list: { color: 3 } } },
          { id: 'AT2', parentID: 'AF1', data: { tab: { savedURL: 'https://en.wikipedia.org/wiki/Kyoto', savedTitle: 'Kyoto' } } },
          { id: 'AS1', parentID: 'AF1', data: { splitView: { layout: 'vertical' } } },
          { id: 'AT3', parentID: 'AS1', data: { tab: { savedURL: 'https://en.wikipedia.org/wiki/Osaka', savedTitle: 'Osaka' } } },
          { id: 'AT4', parentID: 'AS1', data: { tab: { savedURL: 'https://en.wikipedia.org/wiki/Nara', savedTitle: 'Nara' } } },
          { id: 'AU', parentID: null, data: { itemContainer: {} } },
          { id: 'AO1', parentID: 'AU', data: { tab: { savedURL: 'https://hotels.example.com/', savedTitle: 'Hotels' }, someFutureField: 1 } },
          { id: 'BP', parentID: null, data: { itemContainer: {} } },
          { id: 'BT1', parentID: 'BP', data: { tab: { savedURL: 'https://music.example.com/', savedTitle: 'Music' } } },
          { id: 'BU', parentID: null, data: { itemContainer: {} } },
        ],
      },
    ],
  },
})

/** Chrome (Default, with a name in Local State) and Arc (Default) under `root`. */
export function buildFixtureRoot(root: string, now = Date.now()): void {
  const chrome = join(root, 'Google', 'Chrome')
  const chromeDefault = join(chrome, 'Default')
  mkdirSync(chromeDefault, { recursive: true })
  writeFileSync(join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Person 1' } } } }))
  writeFileSync(join(chromeDefault, 'Bookmarks'), chromeBookmarks())
  writeHistory(join(chromeDefault, 'History'), [
    { url: 'https://example.org/one', title: 'One', at: now - 3_600_000 },
    { url: 'https://example.org/two', title: 'Two', at: now - 7_200_000 },
    { url: 'chrome://settings/', title: 'Settings', at: now - 1_000 },
    { url: 'https://example.org/hidden', title: 'Hidden', at: now - 1_000, hidden: true },
  ])
  writeLogins(join(chromeDefault, 'Login Data'), FIXTURE_TEST_KEY, [
    { origin: 'https://accounts.example.com/', username: 'tester@example.com', password: FIXTURE_PASSWORD },
    { origin: 'http://plain.example.com/', username: 'old', password: 'insecure' },
    { origin: 'https://never.example.com/', username: '', password: '', never: true },
  ])
  // Something the importer must never read.
  writeFileSync(join(chromeDefault, 'Cookies'), 'not for the importer')
  mkdirSync(join(chrome, 'System Profile'), { recursive: true })

  const arcDefault = join(root, 'Arc', 'User Data', 'Default')
  mkdirSync(arcDefault, { recursive: true })
  writeFileSync(join(arcDefault, 'Bookmarks'), JSON.stringify({ version: 1, roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [] }, other: { type: 'folder', name: 'Other', children: [] } } }))
  writeFileSync(join(root, 'Arc', 'StorableSidebar.json'), arcSidebar())
}
