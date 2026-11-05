import { cleanTags, parsePrivateLibrary, type PrivateLibraryDocument, type StoredFieldAnchor } from '@intoponet/local-knowledge'

export type SavedBookmark = {
  url: string
  title: string
  topic: string
  savedAt: string
  note?: string
  fieldAnchor?: StoredFieldAnchor
  /** Kept in the library but not drawn on the globe. */
  hiddenOnMap?: boolean
  /** Further tags beyond the main topic. */
  tags?: string[]
  /** The page saved as a PDF on this Mac (Export as PDF into a bookmark group). */
  pdf?: { path: string; savedAt: string }
}

/** "Water, Pacific, climate" → main topic "Water" and tags ["Pacific", "climate"]. */
export function splitTagInput(input: string): { topic: string; tags: string[] } {
  const parts = input.split(',').map((part) => part.trim()).filter(Boolean)
  const topic = (parts[0] ?? '').slice(0, 80) || 'General browsing'
  return { topic, tags: cleanTags(parts.slice(1), topic) }
}

/** All tags of a page, main topic first. */
export const tagsOf = (bookmark: Pick<SavedBookmark, 'topic' | 'tags'>): string[] => [bookmark.topic, ...(bookmark.tags ?? [])]

export type SavedCollection = {
  id: string
  label: string
  createdAt: string
  memberUrls: string[]
}

export type RecentPage = {
  url: string
  title: string
  visitedAt: string
}

export const bookmarkKey = 'intoponet.bookmarks.v1'
export const collectionKey = 'intoponet.collections.v1'
export const recentKey = 'intoponet.recents.v1'
export const topicKey = 'intoponet.active-topic.v1'
const recentLimit = 40

export type StoredPrivateLibraryParse =
  | { status: 'empty' }
  | { status: 'valid'; library: PrivateLibraryDocument }
  | { status: 'invalid' }

export function parseStoredPrivateLibrary(payload: string | null): StoredPrivateLibraryParse {
  if (payload === null) return { status: 'empty' }
  const library = parsePrivateLibrary(payload)
  return library ? { status: 'valid', library } : { status: 'invalid' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as unknown
  } catch {
    return null
  }
}

export function readBookmarks(): SavedBookmark[] {
  const value = readJson(bookmarkKey)
  if (!Array.isArray(value)) return []
  return value.flatMap((item): SavedBookmark[] => {
    if (!isRecord(item)) return []
    if (
      typeof item['url'] !== 'string' ||
      !/^https?:\/\//.test(item['url']) ||
      typeof item['title'] !== 'string' ||
      typeof item['topic'] !== 'string' ||
      typeof item['savedAt'] !== 'string'
    ) {
      return []
    }
    const note = item['note']
    if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
      return []
    }
    const rawFieldAnchor = item['fieldAnchor']
    if (rawFieldAnchor !== undefined) {
      if (!isRecord(rawFieldAnchor)) return []
      const { lat, lon, label } = rawFieldAnchor
      if (
        typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180 ||
        typeof label !== 'string' || label.length > 160 || label.trim().length === 0
      ) return []
    }
    return [
      {
        url: item['url'],
        title: item['title'],
        topic: item['topic'],
        savedAt: item['savedAt'],
        ...(typeof note === 'string' ? { note } : {}),
        ...(isRecord(rawFieldAnchor)
          ? {
              fieldAnchor: {
                lat: rawFieldAnchor['lat'] as number,
                lon: rawFieldAnchor['lon'] as number,
                label: (rawFieldAnchor['label'] as string).trim(),
              },
            }
          : {}),
        ...(item['hiddenOnMap'] === true ? { hiddenOnMap: true } : {}),
        ...(cleanTags(item['tags'], item['topic']).length ? { tags: cleanTags(item['tags'], item['topic']) } : {}),
      },
    ]
  })
}

/**
 * The library is kept only in the encrypted private-library file (written by
 * App's autosave). Earlier versions also kept a plain-text copy in
 * localStorage; these writers are now no-ops, and the read* functions remain
 * only to migrate that old copy once (see clearLegacyLibraryStorage).
 */
export function writeBookmarks(_bookmarks: SavedBookmark[]): void {}

export function readCollections(): SavedCollection[] {
  const value = readJson(collectionKey)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SavedCollection => {
    if (!isRecord(item)) return false
    return (
      typeof item['id'] === 'string' &&
      item['id'].length > 0 &&
      typeof item['label'] === 'string' &&
      item['label'].trim().length > 0 &&
      typeof item['createdAt'] === 'string' &&
      Array.isArray(item['memberUrls']) &&
      item['memberUrls'].every(
        (url): url is string => typeof url === 'string' && /^https?:\/\//.test(url),
      )
    )
  })
}

export function writeCollections(_collections: SavedCollection[]): void {}

export function readRecents(): RecentPage[] {
  const value = readJson(recentKey)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is RecentPage => {
    if (!isRecord(item)) return false
    return (
      typeof item['url'] === 'string' &&
      /^https?:\/\//.test(item['url']) &&
      typeof item['title'] === 'string' &&
      typeof item['visitedAt'] === 'string'
    )
  })
}

export function rememberRecent(recents: RecentPage[], page: RecentPage): RecentPage[] {
  const next = [
    page,
    ...recents.filter((item) => item.url !== page.url),
  ].slice(0, recentLimit)
  return next
}

export function upsertBookmark(
  bookmarks: SavedBookmark[],
  bookmark: SavedBookmark,
): SavedBookmark[] {
  const existing = bookmarks.find((item) => item.url === bookmark.url)
  const next = { ...existing, ...bookmark }
  if (existing && bookmark.note === undefined && existing.note !== undefined) {
    next.note = existing.note
  }
  if (
    existing &&
    bookmark.fieldAnchor === undefined &&
    existing.fieldAnchor !== undefined
  ) {
    next.fieldAnchor = existing.fieldAnchor
  }
  if (existing && bookmark.pdf === undefined && existing.pdf !== undefined) {
    next.pdf = existing.pdf
  }
  return [...bookmarks.filter((item) => item.url !== bookmark.url), next]
}

export function renameCollection(
  collections: SavedCollection[],
  id: string,
  label: string,
): SavedCollection[] {
  const nextLabel = label.trim()
  if (!nextLabel) return collections
  return collections.map((collection) =>
    collection.id === id ? { ...collection, label: nextLabel } : collection,
  )
}

export function createCollection(label: string): SavedCollection {
  return {
    id: crypto.randomUUID(),
    label: label.trim(),
    createdAt: new Date().toISOString(),
    memberUrls: [],
  }
}

export function writeRecents(_recents: RecentPage[]): void {}

/** Whether an old plain-text copy of the library is still in localStorage. */
export function hasLegacyLibraryStorage(): boolean {
  try {
    return [bookmarkKey, collectionKey, recentKey].some((key) => localStorage.getItem(key) !== null)
  } catch {
    return false
  }
}

/** Remove the old plain-text copy; call only after the encrypted library has been written. */
export function clearLegacyLibraryStorage(): void {
  try {
    for (const key of [bookmarkKey, collectionKey, recentKey]) localStorage.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

/** Recent pages younger than the retention window (0 keeps everything). */
export function pruneRecents(recents: RecentPage[], retentionDays: number, now = Date.now()): RecentPage[] {
  if (!retentionDays) return recents
  const cutoff = now - retentionDays * 86_400_000
  return recents.filter((page) => {
    const at = Date.parse(page.visitedAt)
    return Number.isFinite(at) && at >= cutoff
  })
}

/** Move every page of `fromId` into `intoId` (no duplicates) and drop `fromId`. */
export function mergeCollections(collections: SavedCollection[], fromId: string, intoId: string): SavedCollection[] {
  const from = collections.find((collection) => collection.id === fromId)
  const into = collections.find((collection) => collection.id === intoId)
  if (!from || !into || fromId === intoId) return collections
  const merged = [...new Set([...into.memberUrls, ...from.memberUrls])]
  return collections
    .filter((collection) => collection.id !== fromId)
    .map((collection) => (collection.id === intoId ? { ...collection, memberUrls: merged } : collection))
}

export const siteOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Split a collection by site: each site with two or more pages becomes its own
 * collection ("Label · site"); single pages stay in the original. Returns the
 * collections unchanged when there is nothing to split.
 */
export function splitCollectionBySite(collections: SavedCollection[], id: string, now = new Date()): SavedCollection[] {
  const source = collections.find((collection) => collection.id === id)
  if (!source) return collections
  const bySite = new Map<string, string[]>()
  for (const url of source.memberUrls) bySite.set(siteOf(url), [...(bySite.get(siteOf(url)) ?? []), url])
  const groups = [...bySite.entries()].filter(([, urls]) => urls.length >= 2)
  if (bySite.size < 2 || groups.length === 0) return collections
  const moved = new Set(groups.flatMap(([, urls]) => urls))
  const created = groups.map(([site, urls]): SavedCollection => ({
    id: crypto.randomUUID(),
    label: `${source.label} · ${site}`.slice(0, 80),
    createdAt: now.toISOString(),
    memberUrls: urls,
  }))
  const rest = source.memberUrls.filter((url) => !moved.has(url))
  const kept = collections.flatMap((collection) =>
    collection.id !== id ? [collection] : rest.length ? [{ ...collection, memberUrls: rest }] : [],
  )
  return [...kept, ...created]
}

export type CollectionExplanation = {
  pages: number
  sites: Array<{ name: string; count: number }>
  topics: Array<{ name: string; count: number }>
  places: Array<{ name: string; count: number }>
  /** Whether a split by site would change anything. */
  splittable: boolean
}

const tally = (values: string[]): Array<{ name: string; count: number }> => {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** What a collection is made of: its sites, research topics and pinned places, most first. */
export function explainCollection(collection: SavedCollection, bookmarks: SavedBookmark[]): CollectionExplanation {
  const members = bookmarks.filter((bookmark) => collection.memberUrls.includes(bookmark.url))
  const sites = tally(collection.memberUrls.map(siteOf))
  return {
    pages: collection.memberUrls.length,
    sites,
    topics: tally(members.flatMap((bookmark) => tagsOf(bookmark))),
    places: tally(members.flatMap((bookmark) => (bookmark.fieldAnchor ? [bookmark.fieldAnchor.label] : []))),
    splittable: sites.length >= 2 && sites.some((site) => site.count >= 2),
  }
}
