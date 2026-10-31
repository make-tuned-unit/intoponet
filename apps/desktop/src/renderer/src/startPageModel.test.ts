import { describe, expect, it } from 'vitest'
import type { NewsDigest } from '../../shared/news/newsDigest'
import type { SavedBookmark } from './localLibrary'
import { pageKey, startBookmarks, startNews, startRecents } from './startPageModel'

const bookmark = (url: string, savedAt: string, title = ''): SavedBookmark => ({ url, title, topic: 'General browsing', savedAt })

describe('start page bookmarks', () => {
  it('puts recently read bookmarks first, then the newest saved', () => {
    const tiles = startBookmarks(
      [
        bookmark('https://old.example/', '2026-01-01T00:00:00Z', 'Old'),
        bookmark('https://new.example/', '2026-10-01T00:00:00Z', 'New'),
        bookmark('https://read.example/a', '2025-06-01T00:00:00Z', 'Read'),
      ],
      [{ url: 'https://read.example/a#section', title: 'Read', visitedAt: '2026-10-30T00:00:00Z' }],
    )
    expect(tiles.map((tile) => tile.title)).toEqual(['Read', 'New', 'Old'])
  })

  it('falls back to the host for an untitled bookmark, drops duplicates and caps the list', () => {
    const tiles = startBookmarks(
      [bookmark('https://www.example.com/', '2026-01-02T00:00:00Z'), bookmark('https://www.example.com', '2026-01-01T00:00:00Z'), bookmark('https://b.example/', '2026-01-01T00:00:00Z')],
      [],
      1,
    )
    expect(tiles).toEqual([{ url: 'https://www.example.com/', title: 'example.com', host: 'example.com' }])
  })
})

describe('start page recent reads', () => {
  const recents = [
    { url: 'https://a.example/one', title: 'One', visitedAt: '2026-10-29T00:00:00Z' },
    { url: 'https://duckduckgo.com/?q=weather', title: 'weather at DuckDuckGo', visitedAt: '2026-10-31T00:00:00Z' },
    { url: 'https://b.example/two', title: '', visitedAt: '2026-10-30T00:00:00Z' },
    { url: 'https://a.example/one#top', title: 'One again', visitedAt: '2026-10-28T00:00:00Z' },
  ]

  it('lists pages newest first, once each, without search result pages', () => {
    expect(startRecents(recents).map((tile) => tile.title)).toEqual(['b.example', 'One'])
  })

  it('shows nothing in a private tab', () => {
    expect(startRecents(recents, { isPrivate: true })).toEqual([])
  })
})

describe('start page news', () => {
  it('is empty before the first digest', () => {
    expect(startNews(null)).toEqual({ stories: [], rising: [], inTheNews: [] })
  })

  it('takes world stories, then spreading ones, the fastest rising terms and In the news', () => {
    const digest = {
      rising: [
        { term: 'slow', momentum: 0.1, headlines: [], recentCountries: [], recentComparableCount: 0, previousCountryCount: 0 },
        { term: 'fast', momentum: 0.9, headlines: [{ title: 'Fast', url: 'https://news.example/fast', publisher: 'P', publishedAt: '' }], recentCountries: [], recentComparableCount: 0, previousCountryCount: 0 },
      ],
      global: [{ id: 'g', title: 'World story', url: 'https://news.example/world', publisher: 'Wire', terms: [], countries: ['FR', 'DE', 'IT'], outletCount: 9, internationalDesks: 1, latestAt: '', headlines: [] }],
      spreading: [
        { id: 's1', title: 'Same story', url: 'https://news.example/world/', publisher: 'Wire', terms: [], origin: { name: 'Lyon' }, pickups: [], outletCount: 4, nationalOutlets: 1, firstAt: '', latestAt: '', headlines: [] },
        { id: 's2', title: 'Local story', url: 'https://local.example/story', publisher: 'Local', terms: [], origin: { name: 'Leeds' }, pickups: [], outletCount: 3, nationalOutlets: 0, firstAt: '', latestAt: '', headlines: [] },
      ],
      inTheNews: [{ date: null, story: 'Something happened.', mainTitle: 'Thing', links: [{ title: 'Other', url: 'https://en.wikipedia.org/wiki/Other' }, { title: 'Thing', url: 'https://en.wikipedia.org/wiki/Thing' }] }],
    } as unknown as NewsDigest
    const news = startNews(digest)
    expect(news.stories.map((story) => story.title)).toEqual(['World story', 'Local story'])
    expect(news.stories[0]?.detail).toBe('3 countries · 9 outlets')
    expect(news.stories[1]?.detail).toBe('Spreading from Leeds · 3 outlets')
    expect(news.rising).toEqual([{ term: 'fast', url: 'https://news.example/fast' }, { term: 'slow', url: null }])
    expect(news.inTheNews).toEqual([{ story: 'Something happened.', url: 'https://en.wikipedia.org/wiki/Thing', title: 'Thing' }])
  })
})

describe('page keys', () => {
  it('ignore fragments and a trailing slash but keep the query', () => {
    expect(pageKey('https://a.example/x/#y')).toBe(pageKey('https://a.example/x'))
    expect(pageKey('https://a.example/x?p=1')).not.toBe(pageKey('https://a.example/x?p=2'))
  })
})
