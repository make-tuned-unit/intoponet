import { describe, expect, it } from 'vitest'
import { folderCounts, libraryDocument, planLogins, planTabs } from './plan'

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
