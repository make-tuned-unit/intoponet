import { parsePrivateLibrary, type PrivateLibraryDocument, type StoredFieldAnchor } from '@intoponet/local-knowledge'

export type SavedBookmark = {
  url: string
  title: string
  topic: string
  savedAt: string
  note?: string
  fieldAnchor?: StoredFieldAnchor
}

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
      },
    ]
  })
}

export function writeBookmarks(bookmarks: SavedBookmark[]): void {
  localStorage.setItem(bookmarkKey, JSON.stringify(bookmarks))
}

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

export function writeCollections(collections: SavedCollection[]): void {
  localStorage.setItem(collectionKey, JSON.stringify(collections))
}

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
  localStorage.setItem(recentKey, JSON.stringify(next))
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
