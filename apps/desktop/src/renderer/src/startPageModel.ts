import type { NewsDigest } from '../../shared/news/newsDigest'
import type { RecentPage, SavedBookmark } from './localLibrary'

/** What a new tab's start page shows, chosen only from data already on this Mac. */

export type StartTile = { url: string; title: string; host: string }
export type StartStory = { url: string; title: string; publisher: string; detail: string }
export type StartRising = { term: string; url: string | null }
export type StartWikiItem = { story: string; url: string | null; title: string | null }

export const START_LIMITS = { bookmarks: 12, recents: 6, stories: 5, rising: 8, inTheNews: 3 } as const

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The same page whatever its #fragment or trailing slash. */
export function pageKey(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`
  } catch {
    return url
  }
}

const time = (iso: string): number => {
  const at = Date.parse(iso)
  return Number.isFinite(at) ? at : 0
}

/**
 * Bookmarks as tiles: the ones read most recently first (from local recent pages),
 * then the rest by when they were saved, newest first.
 */
export function startBookmarks(bookmarks: SavedBookmark[], recents: RecentPage[], limit: number = START_LIMITS.bookmarks): StartTile[] {
  const lastRead = new Map<string, number>()
  for (const page of recents) {
    const key = pageKey(page.url)
    lastRead.set(key, Math.max(lastRead.get(key) ?? 0, time(page.visitedAt)))
  }
  const seen = new Set<string>()
  return bookmarks
    .filter((bookmark) => /^https?:\/\//.test(bookmark.url))
    .map((bookmark) => ({ bookmark, read: lastRead.get(pageKey(bookmark.url)) ?? 0, saved: time(bookmark.savedAt) }))
    .sort((a, b) => b.read - a.read || b.saved - a.saved)
    .filter(({ bookmark }) => {
      const key = pageKey(bookmark.url)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map(({ bookmark }) => ({ url: bookmark.url, title: bookmark.title.trim() || hostOf(bookmark.url), host: hostOf(bookmark.url) }))
}

const searchPages = [/^https?:\/\/(www\.)?duckduckgo\.com\/?\?/, /^https?:\/\/[a-z]+\.wikipedia\.org\/w\/index\.php\?search=/]

/**
 * Recently read pages, newest first, one per page. Search result pages are not reads.
 * A private tab shows none.
 */
export function startRecents(recents: RecentPage[], { isPrivate = false, limit = START_LIMITS.recents }: { isPrivate?: boolean; limit?: number } = {}): StartTile[] {
  if (isPrivate) return []
  const seen = new Set<string>()
  return [...recents]
    .filter((page) => /^https?:\/\//.test(page.url) && !searchPages.some((pattern) => pattern.test(page.url)))
    .sort((a, b) => time(b.visitedAt) - time(a.visitedAt))
    .filter((page) => {
      const key = pageKey(page.url)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map((page) => ({ url: page.url, title: page.title.trim() || hostOf(page.url), host: hostOf(page.url) }))
}

/** A few of the digest's world stories (or stories spreading between places), rising terms and Wikipedia's In the news. */
export function startNews(digest: NewsDigest | null): { stories: StartStory[]; rising: StartRising[]; inTheNews: StartWikiItem[] } {
  if (!digest) return { stories: [], rising: [], inTheNews: [] }
  const world: StartStory[] = (digest.global ?? []).map((story) => ({
    url: story.url,
    title: story.title,
    publisher: story.publisher,
    detail: story.countries.length > 0
      ? `${story.countries.length} ${story.countries.length === 1 ? 'country' : 'countries'} · ${story.outletCount} outlets`
      : `${story.outletCount} outlets`,
  }))
  const spreading: StartStory[] = (digest.spreading ?? []).map((story) => ({
    url: story.url,
    title: story.title,
    publisher: story.publisher,
    detail: `Spreading from ${story.origin.name} · ${story.outletCount} outlets`,
  }))
  const seen = new Set<string>()
  const stories = [...world, ...spreading]
    .filter((story) => /^https?:\/\//.test(story.url) && story.title.trim())
    .filter((story) => {
      const key = pageKey(story.url)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, START_LIMITS.stories)
  const rising = [...digest.rising]
    .sort((a, b) => b.momentum - a.momentum)
    .slice(0, START_LIMITS.rising)
    .map((term) => ({ term: term.term, url: term.headlines.find((headline) => /^https?:\/\//.test(headline.url))?.url ?? null }))
  const inTheNews = (digest.inTheNews ?? []).slice(0, START_LIMITS.inTheNews).map((item) => {
    const main = item.links.find((link) => link.title === item.mainTitle) ?? item.links[0]
    return { story: item.story, url: main && /^https?:\/\//.test(main.url) ? main.url : null, title: main?.title ?? null }
  })
  return { stories, rising, inTheNews }
}
