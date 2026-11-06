import { describe, expect, it } from 'vitest'
import { emptyPrivateLibrary } from '@intoponet/local-knowledge'
import { mergeImportedLibrary } from './mergeImport'

const payload = JSON.stringify({
  schema: 'intoponet.private-library.v1',
  bookmarks: [
    { url: 'https://a.example/', title: 'A', topic: 'From Arc', savedAt: '2026-01-01T00:00:00Z' },
    { url: 'https://b.example/', title: 'B', topic: 'From Arc', savedAt: '2026-01-01T00:00:00Z' },
  ],
  collections: [
    { id: 'x1', label: 'Work', createdAt: '2026-01-01T00:00:00Z', memberUrls: ['https://a.example/', 'https://b.example/'] },
    { id: 'x2', label: 'Work › Reading', createdAt: '2026-01-01T00:00:00Z', memberUrls: ['https://b.example/'] },
  ],
  recents: [{ url: 'https://ignored.example/', title: 'R', visitedAt: '2026-01-01T00:00:00Z' }],
  absorbed: [],
})

describe('mergeImportedLibrary', () => {
  it('adds pages and collections, keeping folder names', () => {
    const merged = mergeImportedLibrary(emptyPrivateLibrary(), payload)!
    expect(merged.added).toEqual({ bookmarks: 2, collections: 2, filed: 3 })
    expect(merged.library.collections.map((collection) => collection.label)).toEqual(['Work', 'Work › Reading'])
    // Only bookmarks and collections come over.
    expect(merged.library.recents).toEqual([])
  })

  it('adds nothing the second time (by address, and by address within a collection)', () => {
    const once = mergeImportedLibrary(emptyPrivateLibrary(), payload)!
    const twice = mergeImportedLibrary(once.library, payload.replace('"x1"', '"y1"').replace('"x2"', '"y2"'))!
    expect(twice.added).toEqual({ bookmarks: 0, collections: 0, filed: 0 })
    expect(twice.library).toEqual(once.library)
  })

  it('files new pages into an existing collection of the same name', () => {
    const library = { ...emptyPrivateLibrary(), bookmarks: [{ url: 'https://a.example/', title: 'Mine', topic: 'Work', savedAt: '2025-01-01T00:00:00Z' }], collections: [{ id: 'mine', label: 'work', createdAt: '2025-01-01T00:00:00Z', memberUrls: ['https://a.example/'] }] }
    const merged = mergeImportedLibrary(library, payload)!
    expect(merged.added).toEqual({ bookmarks: 1, collections: 1, filed: 2 })
    expect(merged.library.bookmarks.find((bookmark) => bookmark.url === 'https://a.example/')!.title).toBe('Mine')
    expect(merged.library.collections.find((collection) => collection.id === 'mine')!.memberUrls).toEqual(['https://a.example/', 'https://b.example/'])
  })

  it('refuses something that is not a library document', () => {
    expect(mergeImportedLibrary(emptyPrivateLibrary(), '{"schema":"other"}')).toBeNull()
  })
})
