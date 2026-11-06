import { mergePrivateLibraries, parsePrivateLibrary, type PrivateLibraryDocument } from '@intoponet/local-knowledge'

export type LibraryImportCounts = {
  /** Pages new to the library. */
  bookmarks: number
  /** Collections made for folders and spaces. */
  collections: number
  /** Pages newly filed in a collection (new or existing). */
  filed: number
}

/**
 * Merge bookmarks from another browser into the library the same way an exported Intoponet
 * library is imported: pages match by address and collections by name, so nothing is lost and
 * importing again adds nothing. Returns null when the payload is not a library document.
 */
export function mergeImportedLibrary(current: PrivateLibraryDocument, payload: string): { library: PrivateLibraryDocument; added: LibraryImportCounts } | null {
  const incoming = parsePrivateLibrary(payload)
  if (!incoming) return null
  const { library, added } = mergePrivateLibraries(current, { ...incoming, recents: [], absorbed: [] })
  const before = new Map(current.collections.map((collection) => [collection.id, new Set(collection.memberUrls)]))
  let filed = 0
  for (const collection of library.collections) {
    const had = before.get(collection.id)
    filed += had ? collection.memberUrls.filter((url) => !had.has(url)).length : collection.memberUrls.length
  }
  return { library, added: { bookmarks: added.bookmarks, collections: added.collections, filed } }
}
