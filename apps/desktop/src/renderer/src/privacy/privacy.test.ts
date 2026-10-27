import { describe, expect, it } from 'vitest'
import { parsePrivacyCommand } from '@intoponet/browser-api'
import { parsePrivacySettings, defaultPrivacySettings } from './privacySettings'
import { explainCollection, mergeCollections, pruneRecents, splitCollectionBySite, type SavedBookmark, type SavedCollection } from '../localLibrary'

describe('privacy command parser', () => {
  it('accepts the three commands', () => {
    expect(parsePrivacyCommand({ type: 'state' })).toEqual({ type: 'state' })
    expect(parsePrivacyCommand({ type: 'set-private-mode', on: true })).toEqual({ type: 'set-private-mode', on: true })
    expect(parsePrivacyCommand({ type: 'set-backup-exclusion', on: false })).toEqual({ type: 'set-backup-exclusion', on: false })
  })
  it('rejects anything else', () => {
    expect(() => parsePrivacyCommand(null)).toThrow()
    expect(() => parsePrivacyCommand({ type: 'set-private-mode', on: 'yes' })).toThrow()
    expect(() => parsePrivacyCommand({ type: 'wipe-everything' })).toThrow()
  })
})

describe('privacy settings', () => {
  it('defaults to keeping footprints until deleted', () => {
    expect(parsePrivacySettings(null)).toEqual(defaultPrivacySettings)
    expect(defaultPrivacySettings).toEqual({ footprints: true, retentionDays: 0 })
    expect(parsePrivacySettings('not json')).toEqual(defaultPrivacySettings)
  })
  it('keeps valid values and drops invalid retention', () => {
    expect(parsePrivacySettings(JSON.stringify({ footprints: false, retentionDays: 7 }))).toEqual({ footprints: false, retentionDays: 7 })
    expect(parsePrivacySettings(JSON.stringify({ retentionDays: 12 })).retentionDays).toBe(0)
  })
})

describe('retention', () => {
  const now = Date.parse('2026-10-26T12:00:00Z')
  const page = (daysAgo: number) => ({ url: `https://a.test/${daysAgo}`, title: 't', visitedAt: new Date(now - daysAgo * 86_400_000).toISOString() })
  it('drops pages older than the window', () => {
    expect(pruneRecents([page(1), page(8), page(40)], 7, now).map((item) => item.url)).toEqual(['https://a.test/1'])
    expect(pruneRecents([page(1), page(8), page(40)], 30, now)).toHaveLength(2)
  })
  it('keeps everything when retention is 0', () => {
    const all = [page(1), page(400)]
    expect(pruneRecents(all, 0, now)).toBe(all)
  })
})

describe('collections', () => {
  const c = (id: string, urls: string[]): SavedCollection => ({ id, label: id, createdAt: '2026-01-01T00:00:00Z', memberUrls: urls })
  it('merges without duplicates and removes the source', () => {
    const next = mergeCollections([c('a', ['https://x.test/1', 'https://y.test/1']), c('b', ['https://x.test/1'])], 'a', 'b')
    expect(next).toEqual([c('b', ['https://x.test/1', 'https://y.test/1'])])
  })
  it('ignores merging into itself or a missing collection', () => {
    const list = [c('a', ['https://x.test/1'])]
    expect(mergeCollections(list, 'a', 'a')).toBe(list)
    expect(mergeCollections(list, 'a', 'zzz')).toBe(list)
  })
  it('splits sites with two or more pages into their own collections', () => {
    const next = splitCollectionBySite([c('a', ['https://www.x.test/1', 'https://x.test/2', 'https://y.test/1'])], 'a')
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ id: 'a', memberUrls: ['https://y.test/1'] })
    expect(next[1]).toMatchObject({ label: 'a · x.test', memberUrls: ['https://www.x.test/1', 'https://x.test/2'] })
  })
  it('does not split a single-site collection', () => {
    const list = [c('a', ['https://x.test/1', 'https://x.test/2'])]
    expect(splitCollectionBySite(list, 'a')).toBe(list)
  })
  it('explains sites, topics and places', () => {
    const bookmarks: SavedBookmark[] = [
      { url: 'https://x.test/1', title: 'One', topic: 'Water', savedAt: '', fieldAnchor: { lat: 1, lon: 2, label: 'Lagos' } },
      { url: 'https://x.test/2', title: 'Two', topic: 'Water', savedAt: '' },
      { url: 'https://y.test/1', title: 'Three', topic: 'Energy', savedAt: '' },
    ]
    const why = explainCollection(c('a', bookmarks.map((bookmark) => bookmark.url)), bookmarks)
    expect(why.sites).toEqual([{ name: 'x.test', count: 2 }, { name: 'y.test', count: 1 }])
    expect(why.topics[0]).toEqual({ name: 'Water', count: 2 })
    expect(why.places).toEqual([{ name: 'Lagos', count: 1 }])
    expect(why.splittable).toBe(true)
  })
})

describe('sites to leave out', () => {
  it('normalises site names and matches subdomains only', async () => {
    const { normalizeSite, isExcludedSite, parsePrivacyCommand } = await import('@intoponet/browser-api')
    expect(normalizeSite('https://www.Example.com/path')).toBe('example.com')
    expect(normalizeSite('news.example.co.uk')).toBe('news.example.co.uk')
    expect(normalizeSite('not a site')).toBeNull()
    expect(normalizeSite('localhost')).toBeNull()
    expect(isExcludedSite('https://m.example.com/a', ['example.com'])).toBe(true)
    expect(isExcludedSite('https://notexample.com/a', ['example.com'])).toBe(false)
    expect(parsePrivacyCommand({ type: 'set-excluded-sites', sites: ['Example.com', 'example.com', 'bad site', 3] })).toEqual({ type: 'set-excluded-sites', sites: ['example.com'] })
    expect(() => parsePrivacyCommand({ type: 'set-excluded-sites', sites: 'example.com' })).toThrow()
  })
})
