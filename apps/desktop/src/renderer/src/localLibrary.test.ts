import { beforeEach, describe, expect, it } from 'vitest'
import {
  parseStoredPrivateLibrary,
  rememberRecent,
  renameCollection,
  readBookmarks,
  bookmarkKey,
  upsertBookmark,
  type SavedBookmark,
  type RecentPage,
} from './localLibrary'

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    },
  })
})

describe('rememberRecent', () => {
  it('moves a revisited page to the front and caps the list', () => {
    const seed: RecentPage[] = Array.from({ length: 40 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: `Page ${index}`,
      visitedAt: '2026-01-01T00:00:00.000Z',
    }))

    const next = rememberRecent(seed, {
      url: 'https://example.com/2',
      title: 'Updated',
      visitedAt: '2026-01-02T00:00:00.000Z',
    })

    expect(next[0]).toMatchObject({ url: 'https://example.com/2', title: 'Updated' })
    expect(next).toHaveLength(40)
    expect(next.filter((page) => page.url === 'https://example.com/2')).toHaveLength(1)
  })
})

describe('renameCollection', () => {
  it('renames a matching collection and ignores blank labels', () => {
    const collections = [
      { id: 'a', label: 'Old', createdAt: '2026-01-01T00:00:00.000Z', memberUrls: [] },
    ]
    expect(renameCollection(collections, 'a', '  Civic  ')[0]?.label).toBe('Civic')
    expect(renameCollection(collections, 'a', '   ')).toEqual(collections)
  })
})

describe('bookmark field anchors', () => {
  it('reads legacy bookmarks and preserves valid optional explicit field anchors', () => {
    memory.set(bookmarkKey, JSON.stringify([
      { url: 'https://legacy.example/', title: 'Legacy', topic: 'History', savedAt: '2026-01-01' },
      {
        url: 'https://anchored.example/', title: 'Anchored', topic: 'History', savedAt: '2026-01-02',
        fieldAnchor: { lat: 64.1466, lon: -21.9426, label: ' Reykjavík ' },
      },
    ]))
    expect(readBookmarks()).toEqual([
      { url: 'https://legacy.example/', title: 'Legacy', topic: 'History', savedAt: '2026-01-01' },
      {
        url: 'https://anchored.example/', title: 'Anchored', topic: 'History', savedAt: '2026-01-02',
        fieldAnchor: { lat: 64.1466, lon: -21.9426, label: 'Reykjavík' },
      },
    ])
  })

  it('rejects malformed optional anchors without discarding valid unanchored bookmarks', () => {
    const invalid = [
      { lat: Number.NaN, lon: 0, label: 'NaN' },
      { lat: 91, lon: 0, label: 'Out of range' },
      { lat: 0, lon: -181, label: 'Out of range' },
      { lat: 0, lon: 0, label: 'x'.repeat(161) },
      null,
    ]
    memory.set(bookmarkKey, JSON.stringify([
      { url: 'https://valid.example/', title: 'Valid', topic: 'History', savedAt: '2026-01-01' },
      ...invalid.map((fieldAnchor, index) => ({
        url: `https://invalid${index}.example/`, title: 'Invalid', topic: 'History', savedAt: '2026-01-01', fieldAnchor,
      })),
    ]))
    expect(readBookmarks()).toEqual([
      { url: 'https://valid.example/', title: 'Valid', topic: 'History', savedAt: '2026-01-01' },
    ])
  })

  it('preserves existing note and anchor when metadata is re-edited without either field', () => {
    const existing: SavedBookmark = {
      url: 'https://example.org/page', title: 'Old title', topic: 'Old topic', savedAt: '2026-01-01',
      note: 'Keep this note', fieldAnchor: { lat: 48.85, lon: 2.35, label: 'Paris' },
    }
    expect(upsertBookmark([existing], {
      url: existing.url, title: 'New title', topic: 'New topic', savedAt: '2026-02-01',
    })).toEqual([{ ...existing, title: 'New title', topic: 'New topic', savedAt: '2026-02-01' }])
    expect(upsertBookmark([existing], {
      url: existing.url, title: 'New title', topic: 'New topic', savedAt: '2026-02-01',
      fieldAnchor: { lat: 35.68, lon: 139.69, label: 'Tokyo' },
    })[0]?.fieldAnchor).toEqual({ lat: 35.68, lon: 139.69, label: 'Tokyo' })
  })
})

describe('parseStoredPrivateLibrary', () => {
  it('distinguishes a missing library from a present but invalid payload', () => {
    expect(parseStoredPrivateLibrary(null)).toEqual({ status: 'empty' })
    expect(parseStoredPrivateLibrary('not-json')).toEqual({ status: 'invalid' })
    expect(parseStoredPrivateLibrary('{"schema":"intoponet.private-library.v0"}')).toEqual({
      status: 'invalid',
    })
  })

  it('accepts a valid stored library payload', () => {
    expect(
      parseStoredPrivateLibrary(
        '{"schema":"intoponet.private-library.v1","bookmarks":[],"collections":[],"recents":[],"absorbed":[]}',
      ),
    ).toEqual({
      status: 'valid',
      library: {
        schema: 'intoponet.private-library.v1',
        bookmarks: [],
        collections: [],
        recents: [],
        absorbed: [],
      },
    })
  })
})

describe('no plain-text library copy', () => {
  it('writers keep nothing in localStorage, and the old copy can be cleared after migration', async () => {
    const { writeBookmarks, writeCollections, writeRecents, hasLegacyLibraryStorage, clearLegacyLibraryStorage } = await import('./localLibrary')
    writeBookmarks([{ url: 'https://a.test/', title: 'A', topic: 't', savedAt: '2026-01-01T00:00:00Z' }])
    writeCollections([])
    writeRecents([{ url: 'https://a.test/', title: 'A', visitedAt: '2026-01-01T00:00:00Z' }])
    rememberRecent([], { url: 'https://b.test/', title: 'B', visitedAt: '2026-01-01T00:00:00Z' })
    expect(hasLegacyLibraryStorage()).toBe(false)
    localStorage.setItem(bookmarkKey, '[]')
    expect(hasLegacyLibraryStorage()).toBe(true)
    clearLegacyLibraryStorage()
    expect(hasLegacyLibraryStorage()).toBe(false)
  })

  it('clears after a write only the old copy that write included, never one that appeared or changed meanwhile', async () => {
    const { legacyLibrarySnapshot, clearLegacyLibraryStorage, hasLegacyLibraryStorage } = await import('./localLibrary')
    expect(legacyLibrarySnapshot()).toBeNull()
    // A write began with no old copy; one appears before it finishes (it was not in that write).
    const none = legacyLibrarySnapshot() ?? undefined
    localStorage.setItem(bookmarkKey, '[{"url":"https://a.test/"}]')
    if (none) clearLegacyLibraryStorage(none)
    expect(hasLegacyLibraryStorage()).toBe(true)
    // A write began with it; the copy changed before the write finished: kept.
    const first = legacyLibrarySnapshot()!
    localStorage.setItem(bookmarkKey, '[{"url":"https://b.test/"}]')
    clearLegacyLibraryStorage(first)
    expect(localStorage.getItem(bookmarkKey)).toBe('[{"url":"https://b.test/"}]')
    // A write that included the copy as it still is: cleared.
    clearLegacyLibraryStorage(legacyLibrarySnapshot()!)
    expect(hasLegacyLibraryStorage()).toBe(false)
  })
})
