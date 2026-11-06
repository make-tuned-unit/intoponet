import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArcFormatError, parseArcSidebar, sidebarForProfile } from './arcSidebar'
import { chromiumTime, parseChromiumBookmarks } from './chromiumBookmarks'
import { countHistory, readHistory } from './chromiumHistory'
import { chromiumKey, countLogins, decryptChromiumPassword, encryptChromiumPassword, readLogins } from './chromiumLogins'
import { withDatabaseCopy } from './sqliteCopy'
import { arcSidebar, chromeBookmarks, FIXTURE_PASSWORD, FIXTURE_TEST_KEY, toChromiumTime, writeHistory, writeLogins } from './testFixtures'

const folders: string[] = []
const temp = (): string => {
  const folder = mkdtempSync(join(tmpdir(), 'intoponet-import-test-'))
  folders.push(folder)
  return folder
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('Chromium bookmarks', () => {
  it('keeps folder names, nesting as a path, and roots for loose pages', () => {
    const { folders: parsed, skipped } = parseChromiumBookmarks(chromeBookmarks())
    expect(parsed.map((folder) => [folder.label, folder.pages.map((page) => page.url)])).toEqual([
      ['Bookmarks bar', ['https://en.wikipedia.org/wiki/Main_Page']],
      ['Travel', ['https://en.wikipedia.org/wiki/Fiji']],
      ['Travel › Japan', ['https://en.wikipedia.org/wiki/Kyoto', 'https://en.wikipedia.org/wiki/Fiji']],
      ['Other bookmarks', ['https://www.rnz.co.nz/pacific']],
    ])
    expect(skipped).toBe(1)
    expect(parsed[0]!.pages[0]!.addedAt).toBe('2025-01-02T00:00:00.000Z')
  })

  it('refuses a file that is not a bookmarks file', () => {
    expect(() => parseChromiumBookmarks('{"nope":1}')).toThrow()
    expect(() => parseChromiumBookmarks('not json')).toThrow()
  })

  it('reads Chromium times', () => {
    expect(chromiumTime(String(toChromiumTime(Date.UTC(2024, 5, 1))))).toBe(Date.UTC(2024, 5, 1))
    expect(chromiumTime('0')).toBeNull()
    expect(chromiumTime('abc')).toBeNull()
  })
})

describe('Arc sidebar', () => {
  it('reads spaces, pinned tabs, nested folders, open tabs and favourites', () => {
    const sidebar = parseArcSidebar(arcSidebar())
    expect(sidebar.spaces.map((space) => space.title)).toEqual(['Work', 'Home', 'Other profile'])
    const [work, home] = sidebar.spaces
    // Order follows childrenIds; a custom title wins over the page title.
    expect(work!.pinned).toEqual([{ url: 'https://docs.example.com/', title: 'Docs' }, { url: 'https://chat.example.com/team', title: 'Team chat' }])
    expect(work!.folders.map((folder) => [folder.label, folder.pages.map((page) => page.url)])).toEqual([
      ['Work › Reading › Later', ['https://en.wikipedia.org/wiki/Samoa']],
      ['Work › Reading', ['https://en.wikipedia.org/wiki/Tonga']],
    ])
    expect(work!.open.map((tab) => tab.url)).toEqual(['https://news.example.com/today'])
    // The older containerIDs layout.
    expect(home!.pinned.map((tab) => tab.url)).toEqual(['https://recipes.example.com/'])
    expect(sidebar.favourites.map((tab) => tab.url)).toEqual(['https://mail.example.com/'])
    expect(sidebar.skipped).toBe(1)
  })

  it('splits spaces by profile; favourites belong to the default profile', () => {
    const sidebar = parseArcSidebar(arcSidebar())
    expect(sidebarForProfile(sidebar, 'Default').spaces.map((space) => space.title)).toEqual(['Work', 'Home'])
    const other = sidebarForProfile(sidebar, 'Profile 1')
    expect(other.spaces.map((space) => space.title)).toEqual(['Other profile'])
    expect(other.favourites).toEqual([])
  })

  it('fails closed on anything unexpected', () => {
    for (const raw of ['', 'null', '[]', '{"sidebar":{}}', '{"sidebar":{"containers":[{"global":{}}]}}', '{"sidebar":{"containers":"x"}}']) {
      expect(() => parseArcSidebar(raw)).toThrow(ArcFormatError)
    }
  })

  it('does not loop on items that are their own parent', () => {
    const raw = JSON.stringify({ sidebar: { containers: [{ spaces: [{ id: 'S', title: 'Loop', newContainerIDs: [{ pinned: {} }, 'P'] }], items: [{ id: 'P', parentID: 'F', data: {} }, { id: 'F', parentID: 'P', title: 'Folder', data: { list: {} } }] }] } })
    expect(parseArcSidebar(raw).spaces[0]!.pinned).toEqual([])
  })

  it('leaves out addresses that are not web pages', () => {
    const raw = JSON.stringify({ sidebar: { containers: [{ spaces: [{ id: 'S', title: 'S', newContainerIDs: [{ pinned: {} }, 'P'] }], items: [{ id: 'P', parentID: null, data: {} }, { id: 'T', parentID: 'P', data: { tab: { savedURL: 'file:///etc/passwd' } } }] }] } })
    const sidebar = parseArcSidebar(raw)
    expect(sidebar.spaces[0]!.pinned).toEqual([])
    expect(sidebar.skipped).toBe(1)
  })
})

describe('Chromium history', () => {
  it('reads the newest web pages from a copy, with their last visit', () => {
    const folder = temp()
    const path = join(folder, 'History')
    const now = Date.UTC(2026, 10, 1)
    writeHistory(path, [
      { url: 'https://example.org/old', title: 'Old', at: now - 86_400_000 },
      { url: 'https://example.org/new', title: 'New', at: now },
      { url: 'chrome://settings', title: 'Settings', at: now },
      { url: 'https://example.org/hidden', title: 'Hidden', at: now, hidden: true },
    ])
    const read = withDatabaseCopy(path, (db) => readHistory(db, 1))
    expect(read.total).toBe(2)
    expect(read.visits).toEqual([{ url: 'https://example.org/new', title: 'New', visitedAt: now }])
    expect(withDatabaseCopy(path, countHistory)).toBe(2)
  })

  it('refuses a database that is not a history file', () => {
    const folder = temp()
    const path = join(folder, 'History')
    writeLogins(path, 'k', [])
    expect(() => withDatabaseCopy(path, countHistory)).toThrow(/not a Chromium history/)
  })

  it('deletes its copy afterwards and never writes to the original', () => {
    const folder = temp()
    const path = join(folder, 'History')
    writeHistory(path, [{ url: 'https://example.org/', title: 'x', at: Date.now() }])
    let copy = ''
    withDatabaseCopy(path, (db) => {
      copy = (db.prepare('PRAGMA database_list').get() as { file: string }).file
      expect(() => db.exec('DELETE FROM urls')).toThrow()
    })
    expect(copy).not.toBe(path)
    expect(() => withDatabaseCopy(copy, countHistory)).toThrow()
    expect(withDatabaseCopy(path, countHistory)).toBe(1)
  })

  it('refuses a missing file or a link', () => {
    expect(() => withDatabaseCopy(join(temp(), 'nothing'), countHistory)).toThrow()
  })
})

describe('Chromium passwords', () => {
  it('decrypts v10 passwords with the Safe Storage key', () => {
    const key = chromiumKey(FIXTURE_TEST_KEY)
    expect(key.length).toBe(16)
    expect(decryptChromiumPassword(encryptChromiumPassword(FIXTURE_PASSWORD, key), key)).toBe(FIXTURE_PASSWORD)
  })

  it('follows the documented scheme: PBKDF2-SHA1, "saltysalt", 1003 rounds, AES-128-CBC with an IV of 16 spaces, "v10" first', () => {
    const key = pbkdf2Sync('secret', 'saltysalt', 1003, 16, 'sha1')
    expect(chromiumKey('secret').equals(key)).toBe(true)
    const sealed = encryptChromiumPassword('hunter2', key)
    expect(sealed.subarray(0, 3).toString()).toBe('v10')
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.from(' '.repeat(16)))
    expect(Buffer.concat([decipher.update(sealed.subarray(3)), decipher.final()]).toString()).toBe('hunter2')
  })

  it('gives null for a wrong key or an unknown format, and "" for none', () => {
    const key = chromiumKey(FIXTURE_TEST_KEY)
    const sealed = encryptChromiumPassword(FIXTURE_PASSWORD, key)
    expect(decryptChromiumPassword(sealed, chromiumKey('wrong'))).toBeNull()
    expect(decryptChromiumPassword(Buffer.from('v11xxxxxxxxxxxxxxxxxxx'), key)).toBeNull()
    expect(decryptChromiumPassword(new Uint8Array(0), key)).toBe('')
  })

  it('reads sign-ins from Login Data, leaving out sites marked never', () => {
    const folder = temp()
    const path = join(folder, 'Login Data')
    writeLogins(path, FIXTURE_TEST_KEY, [
      { origin: 'https://a.example.com/', username: 'me', password: 'secret-1' },
      { origin: 'https://b.example.com/', username: '', password: '', never: true },
    ])
    expect(withDatabaseCopy(path, countLogins)).toBe(1)
    const rows = withDatabaseCopy(path, (db) => readLogins(db))
    expect(rows.map((row) => [row.origin, row.username])).toEqual([['https://a.example.com/', 'me']])
    expect(decryptChromiumPassword(rows[0]!.encrypted, chromiumKey(FIXTURE_TEST_KEY))).toBe('secret-1')
  })

  it('refuses a database that is not a passwords file', () => {
    const path = join(temp(), 'Login Data')
    writeFileSync(path, '')
    writeHistory(path, [])
    expect(() => withDatabaseCopy(path, countLogins)).toThrow(/not a Chromium passwords/)
  })
})
