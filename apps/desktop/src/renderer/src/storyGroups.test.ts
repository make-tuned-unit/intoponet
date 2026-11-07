import { describe, expect, it } from 'vitest'
import type { PageTabSnapshot } from '@intoponet/browser-api'
import { groupingNotice, storyGroupRequests } from './storyGroups'

const tab = (id: string, extra: Partial<PageTabSnapshot> = {}): PageTabSnapshot => ({ id, url: `https://x.example/${id}`, title: id, favicon: '', active: false, ...extra })
const delta = { storyId: 'flood', label: 'Delta floods' }
const vote = { storyId: 'vote', label: 'Coastal election' }

describe('storyGroupRequests', () => {
  it('groups two or more loose tabs of a story, with its id', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    const matches = new Map([['a', delta], ['b', delta], ['c', vote]])
    expect(storyGroupRequests(tabs, matches, [])).toEqual([{ name: 'Delta floods', tabIds: ['a', 'b'], storyId: 'flood' }])
  })

  it('adds a single loose tab to a folder that already has its story', () => {
    const tabs = [tab('a')]
    const matches = new Map([['a', delta]])
    expect(storyGroupRequests(tabs, matches, [{ id: 'f', name: 'Floods', parentId: null, storyId: 'flood' }])).toEqual([{ name: 'Delta floods', tabIds: ['a'], storyId: 'flood' }])
  })

  it('never takes pinned, foldered or private tabs', () => {
    const tabs = [tab('pinned', { pinned: true }), tab('foldered', { folderId: 'f' }), tab('private', { isPrivate: true }), tab('ok')]
    const matches = new Map([['pinned', delta], ['foldered', delta], ['private', delta], ['ok', delta]])
    expect(storyGroupRequests(tabs, matches, [])).toEqual([])
    expect(storyGroupRequests(tabs, matches, [{ id: 'f', name: 'Floods', parentId: null, storyId: 'flood' }])).toEqual([{ name: 'Delta floods', tabIds: ['ok'], storyId: 'flood' }])
  })

  it('takes a side of a pair only with its other side, and counts what is left', () => {
    const pair = (id: string, partnerId: string, side: 'left' | 'right') => tab(id, { split: { partnerId, side } })
    // l is beside r, which is from another story: l stays, and one tab left is not enough for a new folder.
    const apart = [pair('l', 'r', 'left'), pair('r', 'l', 'right'), tab('a')]
    expect(storyGroupRequests(apart, new Map([['l', delta], ['a', delta], ['r', vote]]), [])).toEqual([])
    // Both sides from the same story: they go together.
    const together = [pair('l', 'r', 'left'), pair('r', 'l', 'right'), tab('a')]
    expect(storyGroupRequests(together, new Map([['l', delta], ['r', delta], ['a', delta]]), [])).toEqual([{ name: 'Delta floods', tabIds: ['l', 'r', 'a'], storyId: 'flood' }])
    // A story with a folder and only a lone side of a pair: nothing to ask for.
    expect(storyGroupRequests(apart, new Map([['l', delta]]), [{ id: 'f', name: 'Floods', parentId: null, storyId: 'flood' }])).toEqual([])
  })
})

describe('groupingNotice', () => {
  it('counts the tabs moved and the folders they went into', () => {
    expect(groupingNotice('story', { moved: 1, folders: 1 })).toBe('Grouped 1 tab by story')
    expect(groupingNotice('story', { moved: 3, folders: 2 })).toBe('Grouped 3 tabs by story')
    expect(groupingNotice('tidy', { moved: 1, folders: 1 })).toBe('Made 1 folder (1 tab)')
    // Tidy asked for 2 folders of 5 tabs; two had closed meanwhile and one folder lost both its tabs.
    expect(groupingNotice('tidy', { moved: 3, folders: 1 })).toBe('Made 1 folder (3 tabs)')
  })
})
