import type { SavedBookmark, SavedCollection } from './localLibrary'

/**
 * Bookmark groups in the side pane are the private Collections (PRD MEM-004),
 * so groups export, import and delete with the rest of the library. A bookmark
 * that belongs to no collection is listed under "Unsorted".
 */
export const UNSORTED_GROUP_ID = 'unsorted'

export type BookmarkGroupView = {
  id: string
  label: string
  bookmarks: SavedBookmark[]
  /** Unsorted is a derived view; it cannot be renamed or deleted. */
  editable: boolean
}

export function bookmarkHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function matches(bookmark: SavedBookmark, query: string): boolean {
  if (!query) return true
  const haystack = `${bookmark.title} ${bookmark.url} ${bookmark.topic}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term))
}

/** Groups in collection order, then Unsorted. Items sorted by title. */
export function groupBookmarks(
  bookmarks: SavedBookmark[],
  collections: SavedCollection[],
  query = '',
): BookmarkGroupView[] {
  const byUrl = new Map(bookmarks.map((bookmark) => [bookmark.url, bookmark]))
  const grouped = new Set<string>()
  const sortByTitle = (a: SavedBookmark, b: SavedBookmark) =>
    (a.title || a.url).localeCompare(b.title || b.url, undefined, { sensitivity: 'base' })
  const views: BookmarkGroupView[] = collections.map((collection) => {
    const members = collection.memberUrls
      .map((url) => byUrl.get(url))
      .filter((bookmark): bookmark is SavedBookmark => bookmark !== undefined)
    members.forEach((bookmark) => grouped.add(bookmark.url))
    return {
      id: collection.id,
      label: collection.label,
      bookmarks: members.filter((bookmark) => matches(bookmark, query.trim())).sort(sortByTitle),
      editable: true,
    }
  })
  const unsorted = bookmarks
    .filter((bookmark) => !grouped.has(bookmark.url) && matches(bookmark, query.trim()))
    .sort(sortByTitle)
  if (unsorted.length > 0 || collections.length === 0) {
    views.push({ id: UNSORTED_GROUP_ID, label: 'Unsorted', bookmarks: unsorted, editable: false })
  }
  return views
}

/**
 * Move a bookmark between groups. Moving from a group removes it from that
 * group only; moving to Unsorted removes it from every group.
 */
export function moveBookmarkToGroup(
  collections: SavedCollection[],
  url: string,
  fromGroupId: string,
  toGroupId: string,
): SavedCollection[] {
  if (fromGroupId === toGroupId) return collections
  return collections.map((collection) => {
    let memberUrls = collection.memberUrls
    if (toGroupId === UNSORTED_GROUP_ID || collection.id === fromGroupId) {
      memberUrls = memberUrls.filter((member) => member !== url)
    }
    if (collection.id === toGroupId && !memberUrls.includes(url)) {
      memberUrls = [...memberUrls, url]
    }
    return memberUrls === collection.memberUrls ? collection : { ...collection, memberUrls }
  })
}

/** The first group (collection order) containing the URL, or Unsorted. */
export function groupOf(collections: SavedCollection[], url: string): string {
  return collections.find((collection) => collection.memberUrls.includes(url))?.id ?? UNSORTED_GROUP_ID
}

const secondLevelLabels = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'])

/**
 * The site's main name, for monogram tiles: en.wikipedia.org → wikipedia,
 * bbc.co.uk → bbc, x.com → x. A heuristic, not a public-suffix lookup.
 */
export function siteLabel(url: string): string {
  const labels = bookmarkHost(url).split('.').filter(Boolean)
  if (labels.length <= 1) return labels[0] ?? ''
  labels.pop()
  if (labels.length > 1 && secondLevelLabels.has(labels[labels.length - 1] ?? '')) labels.pop()
  return labels[labels.length - 1] ?? ''
}

/** A stable hue per host for private monogram tiles (no favicon fetches). */
export function hostHue(host: string): number {
  let hash = 0
  for (let index = 0; index < host.length; index += 1) hash = (hash * 31 + host.charCodeAt(index)) | 0
  return Math.abs(hash) % 360
}

export type CaptureLike = { id: string; title: string; sourceUrl: string; createdAt: string; groupId: string | null }

/**
 * Captures for each group view, newest first. A capture whose group no
 * longer exists (or has none) is Unsorted, so deleting a group never deletes
 * captures. Adds an Unsorted view when only captures need it.
 */
export function attachCaptures<T extends CaptureLike>(
  groups: BookmarkGroupView[],
  captures: T[],
  query = '',
): Array<BookmarkGroupView & { captures: T[] }> {
  const known = new Set(groups.filter((group) => group.editable).map((group) => group.id))
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visible = captures
    .filter((capture) => {
      const haystack = `${capture.title} ${capture.sourceUrl}`.toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const byGroup = new Map<string, T[]>()
  for (const capture of visible) {
    const id = capture.groupId && known.has(capture.groupId) ? capture.groupId : UNSORTED_GROUP_ID
    byGroup.set(id, [...(byGroup.get(id) ?? []), capture])
  }
  const result = groups.map((group) => ({ ...group, captures: byGroup.get(group.id) ?? [] }))
  if (!result.some((group) => group.id === UNSORTED_GROUP_ID) && byGroup.has(UNSORTED_GROUP_ID)) {
    result.push({ id: UNSORTED_GROUP_ID, label: 'Unsorted', bookmarks: [], editable: false, captures: byGroup.get(UNSORTED_GROUP_ID) ?? [] })
  }
  return result
}

/** "0:07", "12:30" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
