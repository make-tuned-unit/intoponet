import { describe, expect, it } from 'vitest'
import type { SavedBookmark, SavedCollection } from './localLibrary'
import { bookmarkHost, groupBookmarks, groupOf, hostHue, moveBookmarkToGroup, siteLabel, UNSORTED_GROUP_ID } from './bookmarkGroups'

const bookmark = (url: string, title: string): SavedBookmark => ({ url, title, topic: 'General browsing', savedAt: '2026-10-26T12:00:00.000Z' })
const bank = bookmark('https://www.bank.example/login', 'My Bank')
const social = bookmark('https://social.example/home', 'Social')
const news = bookmark('https://news.example/', 'Morning news')
const collection = (id: string, label: string, memberUrls: string[]): SavedCollection => ({ id, label, createdAt: '2026-10-26T12:00:00.000Z', memberUrls })

describe('bookmark groups', () => {
  it('lists collection groups in order, then unsorted bookmarks', () => {
    const groups = groupBookmarks([news, bank, social], [collection('money', 'Money', [bank.url]), collection('social', 'Social', [social.url])])
    expect(groups.map((group) => group.id)).toEqual(['money', 'social', UNSORTED_GROUP_ID])
    expect(groups[2]?.bookmarks).toEqual([news])
    expect(groups[2]?.editable).toBe(false)
  })

  it('shows an empty unsorted group only when there are no collections', () => {
    expect(groupBookmarks([], []).map((group) => group.id)).toEqual([UNSORTED_GROUP_ID])
    expect(groupBookmarks([bank], [collection('money', 'Money', [bank.url])]).map((group) => group.id)).toEqual(['money'])
  })

  it('ignores collection members that are no longer bookmarked', () => {
    const groups = groupBookmarks([bank], [collection('money', 'Money', [bank.url, 'https://gone.example/'])])
    expect(groups[0]?.bookmarks).toEqual([bank])
  })

  it('filters by every search term across title, address and topic', () => {
    const groups = groupBookmarks([bank, social, news], [], 'bank login')
    expect(groups[0]?.bookmarks).toEqual([bank])
  })

  it('moves between groups and to unsorted', () => {
    const collections = [collection('a', 'A', [bank.url]), collection('b', 'B', [bank.url])]
    const moved = moveBookmarkToGroup(collections, bank.url, 'a', 'c')
    expect(moved).toEqual(collections.map((item) => item.id === 'a' ? { ...item, memberUrls: [] } : item))
    const toNew = moveBookmarkToGroup([...collections, collection('c', 'C', [])], bank.url, UNSORTED_GROUP_ID, 'c')
    expect(toNew[2]?.memberUrls).toEqual([bank.url])
    const unsorted = moveBookmarkToGroup(collections, bank.url, 'a', UNSORTED_GROUP_ID)
    expect(unsorted.every((item) => item.memberUrls.length === 0)).toBe(true)
    expect(moveBookmarkToGroup(collections, bank.url, 'a', 'a')).toBe(collections)
  })

  it('finds a bookmark group and derives private monogram data', () => {
    expect(groupOf([collection('money', 'Money', [bank.url])], bank.url)).toBe('money')
    expect(groupOf([], bank.url)).toBe(UNSORTED_GROUP_ID)
    expect(bookmarkHost(bank.url)).toBe('bank.example')
    expect(hostHue('bank.example')).toBe(hostHue('bank.example'))
    expect(hostHue('bank.example')).toBeGreaterThanOrEqual(0)
    expect(hostHue('bank.example')).toBeLessThan(360)
  })

  it('names the site, not its subdomain, for monograms', () => {
    expect(siteLabel('https://en.wikipedia.org/wiki/Moon')).toBe('wikipedia')
    expect(siteLabel('https://www.bbc.co.uk/news')).toBe('bbc')
    expect(siteLabel('https://x.com/home')).toBe('x')
    expect(siteLabel('https://localhost:3000/')).toBe('localhost:3000')
  })
})
