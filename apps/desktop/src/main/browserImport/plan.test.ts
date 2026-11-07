import { describe, expect, it } from 'vitest'
import { folderCounts, folderPages, libraryDocument, planLogins, planTabs, planWorkspaces } from './plan'

const tab = (url: string) => ({ url, title: url })

describe('planTabs', () => {
  it('puts pinned tabs first, skips ones already open, and keeps within the room left', () => {
    const plan = planTabs([tab('https://a.example/'), tab('https://b.example')], [tab('https://c.example/'), tab('https://a.example/'), tab('https://d.example/')], ['https://b.example/'], 2)
    expect(plan.add).toEqual([{ url: 'https://a.example/', title: 'https://a.example/', pinned: true }, { url: 'https://c.example/', title: 'https://c.example/', pinned: false }])
    expect(plan.duplicates).toBe(2)
    expect(plan.leftOut).toEqual({ pinned: 0, open: 1 })
  })

  it('adds nothing when everything is already open (a second import)', () => {
    const first = planTabs([tab('https://a.example/')], [tab('https://c.example/')], [], 12)
    const second = planTabs([tab('https://a.example/')], [tab('https://c.example/')], first.add.map((item) => item.url), 10)
    expect(second.add).toEqual([])
    expect(second.duplicates).toBe(2)
  })

  it('never makes room by closing tabs', () => {
    expect(planTabs([tab('https://a.example/')], [], [], 0).leftOut).toEqual({ pinned: 1, open: 0 })
    expect(planTabs([tab('https://a.example/')], [], [], -3).add).toEqual([])
  })
})

describe('libraryDocument', () => {
  const now = new Date('2026-11-06T00:00:00Z')
  it('makes one collection per folder name and one bookmark per address', () => {
    const doc = libraryDocument([
      { label: 'Travel', pages: [{ url: 'https://x.example/', title: 'X', addedAt: '2025-01-01T00:00:00.000Z' }] },
      { label: 'travel', pages: [{ url: 'https://x.example/', title: 'X', addedAt: null }, { url: 'https://y.example/', title: '', addedAt: null }] },
      { label: 'Empty', pages: [] },
    ], 'From Arc', now)
    expect(doc.schema).toBe('intoponet.private-library.v1')
    expect(doc.collections.map((collection) => [collection.label, collection.memberUrls])).toEqual([['Travel', ['https://x.example/', 'https://y.example/']]])
    expect(doc.bookmarks).toEqual([
      { url: 'https://x.example/', title: 'X', topic: 'From Arc', savedAt: '2025-01-01T00:00:00.000Z' },
      { url: 'https://y.example/', title: 'https://y.example/', topic: 'From Arc', savedAt: now.toISOString() },
    ])
  })

  it('counts pages and folders for the preview', () => {
    expect(folderCounts([{ label: 'A', pages: [{ url: 'https://x/', title: '', addedAt: null }] }, { label: 'B', pages: [{ url: 'https://x/', title: '', addedAt: null }] }])).toEqual({ pages: 1, folders: 2 })
  })
})

describe('planLogins', () => {
  const toOrigin = (url: string): string | null => (url.startsWith('https://') ? new URL(url).origin : null)
  it('keeps secure sign-ins once per site and username', () => {
    const plan = planLogins([
      { origin: 'https://a.example/login', username: 'me', password: 'one' },
      { origin: 'https://a.example/other', username: 'me', password: 'two' },
      { origin: 'http://b.example/', username: 'me', password: 'x' },
      { origin: 'https://c.example/', username: 'me', password: null },
      { origin: 'https://d.example/', username: 'me', password: '' },
    ], toOrigin)
    expect(plan.add).toEqual([{ origin: 'https://a.example', username: 'me', password: 'one' }])
    expect([plan.insecure, plan.unreadable, plan.empty]).toEqual([1, 1, 1])
  })
})

describe('spaces as workspaces', () => {
  const page = (path: string) => ({ kind: 'tab' as const, url: `https://${path}.example/`, title: path })
  const work = {
    title: 'Work',
    tree: [page('docs'), { kind: 'folder' as const, name: 'Reading', children: [page('tonga'), { kind: 'folder' as const, name: 'Later', children: [page('samoa'), { kind: 'folder' as const, name: 'Deeper', children: [page('fiji')] }] }] }],
    open: [tab('https://news.example/')],
  }
  const base = { favourites: [], existing: [], existingFavourites: [], freeWorkspaces: 8, tabLimit: 12, favouriteRoom: 12, include: { pinned: true, open: true }, maxFolderDepth: 6 }

  it('makes a workspace per space with its pinned tabs, nested folders and open tabs', () => {
    const plan = planWorkspaces({ ...base, spaces: [work, { title: 'Home', tree: [], open: [] }] })
    expect(plan.workspaces.map((workspace) => [workspace.name, workspace.existingId])).toEqual([['Work', null], ['Home', null]])
    const [made] = plan.workspaces
    expect(made!.pinned.map((item) => item.title)).toEqual(['docs'])
    expect(made!.folders).toEqual([{ name: 'Reading', tabs: [{ url: 'https://tonga.example/', title: 'tonga' }], children: [{ name: 'Later', tabs: [{ url: 'https://samoa.example/', title: 'samoa' }], children: [{ name: 'Deeper', tabs: [{ url: 'https://fiji.example/', title: 'fiji' }], children: [] }] }] }])
    expect(made!.open.map((item) => item.url)).toEqual(['https://news.example/'])
    expect(plan.counts).toEqual({ workspaces: 2, pinned: 1, foldered: 3, open: 1, favourites: 0 })
  })

  it('keeps folders deeper than allowed in the deepest folder that fits', () => {
    const plan = planWorkspaces({ ...base, maxFolderDepth: 2, spaces: [work] })
    const later = plan.workspaces[0]!.folders[0]!.children[0]!
    expect(later.name).toBe('Later')
    expect(later.children).toEqual([])
    expect(later.tabs.map((item) => item.title)).toEqual(['samoa', 'fiji'])
  })

  it('adds to a workspace of the same name, and plans nothing the second time', () => {
    const first = planWorkspaces({ ...base, spaces: [work] })
    const urls = [...first.workspaces[0]!.pinned, ...folderPages(first.workspaces[0]!.folders), ...first.workspaces[0]!.open].map((item) => item.url)
    const again = planWorkspaces({ ...base, spaces: [work], existing: [{ id: 'w', name: 'work', urls, room: 7 }] })
    expect(again.workspaces).toEqual([])
    expect(again.counts.workspaces).toBe(0)
    expect(again.skipped.duplicates).toBe(5)
    const more = planWorkspaces({ ...base, spaces: [{ ...work, open: [tab('https://extra.example/')] }], existing: [{ id: 'w', name: 'Work', urls, room: 7 }] })
    expect(more.workspaces.map((workspace) => [workspace.existingId, workspace.open.length])).toEqual([['w', 1]])
  })

  it('stays within the tab limit of a workspace and the number of workspaces', () => {
    const plan = planWorkspaces({ ...base, tabLimit: 3, freeWorkspaces: 1, spaces: [work, { title: 'Home', tree: [page('recipes')], open: [] }] })
    expect(plan.counts.pinned + plan.counts.foldered + plan.counts.open).toBe(3)
    expect(plan.skipped).toEqual({ duplicates: 0, overLimit: 2, spaces: 1 })
  })

  it('puts favourites in the row while it has room, then pinned in the first workspace', () => {
    const plan = planWorkspaces({ ...base, favouriteRoom: 1, existingFavourites: ['https://mail.example/'], favourites: [tab('https://mail.example/'), tab('https://maps.example/'), tab('https://calendar.example/')], spaces: [work] })
    expect(plan.favourites.map((item) => item.url)).toEqual(['https://maps.example/'])
    expect(plan.workspaces[0]!.pinned.map((item) => item.url)).toEqual(['https://docs.example/', 'https://calendar.example/'])
    expect(plan.skipped.duplicates).toBe(1)
  })

  it('brings only the kinds of tab that were ticked', () => {
    const plan = planWorkspaces({ ...base, include: { pinned: false, open: true }, spaces: [work] })
    expect(plan.counts).toEqual({ workspaces: 1, pinned: 0, foldered: 0, open: 1, favourites: 0 })
  })
})
