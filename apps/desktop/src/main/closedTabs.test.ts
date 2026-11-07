import { describe, expect, it } from 'vitest'
import { ClosedTabs, reopenPlace } from './closedTabs'

let counter = 0
const ids = () => `id-${++counter}`
const tab = (url: string, extra: Partial<Parameters<ClosedTabs['remember']>[0]> = {}) => ({ url, title: url, favicon: '', isPrivate: false, ...extra })

describe('recently closed tabs', () => {
  it('reopens the newest first, or one chosen by id', () => {
    const closed = new ClosedTabs(25, ids)
    const a = closed.remember(tab('https://a.example/'))
    closed.remember(tab('https://b.example/'))
    closed.remember(tab('https://c.example/'))
    expect(closed.list().map((entry) => entry.url)).toEqual(['https://c.example/', 'https://b.example/', 'https://a.example/'])
    expect(closed.take()?.url).toBe('https://c.example/')
    expect(closed.take(a!.id)?.url).toBe('https://a.example/')
    expect(closed.list().map((entry) => entry.url)).toEqual(['https://b.example/'])
    expect(closed.take('missing')).toBeNull()
  })

  it('never remembers private tabs or tabs without a web page', () => {
    const closed = new ClosedTabs(25, ids)
    expect(closed.remember(tab('https://secret.example/', { isPrivate: true }))).toBeNull()
    expect(closed.remember(tab(''))).toBeNull()
    expect(closed.remember(tab('about:blank'))).toBeNull()
    expect(closed.remember(tab('file:///etc/passwd'))).toBeNull()
    expect(closed.size).toBe(0)
    expect(closed.take()).toBeNull()
  })

  it('keeps at most the limit, dropping the oldest', () => {
    const closed = new ClosedTabs(25, ids)
    for (let index = 0; index < 30; index += 1) closed.remember(tab(`https://site${index}.example/`))
    expect(closed.size).toBe(25)
    expect(closed.list()[0]?.url).toBe('https://site29.example/')
    expect(closed.list().at(-1)?.url).toBe('https://site5.example/')
  })

  it('keeps the back/forward list, web entries only, with the index following them', () => {
    const closed = new ClosedTabs(25, ids)
    closed.remember(tab('https://b.example/', {
      history: {
        entries: [
          { url: 'about:blank', title: '' },
          { url: 'https://a.example/', title: 'A' },
          { url: 'https://b.example/', title: 'B', pageState: 'state' },
          { url: 'https://c.example/', title: 'C', pageState: 'x'.repeat(70_000) },
        ],
        index: 2,
      },
    }))
    const entry = closed.take()
    expect(entry?.history?.index).toBe(1)
    expect(entry?.history?.entries.map((item) => item.url)).toEqual(['https://a.example/', 'https://b.example/', 'https://c.example/'])
    expect(entry?.history?.entries[1]?.pageState).toBe('state')
    // Very large saved page state is dropped; the entry stays.
    expect(entry?.history?.entries[2]?.pageState).toBeUndefined()
  })

  it('bounds a long history around the current page', () => {
    const closed = new ClosedTabs(25, ids)
    const entries = Array.from({ length: 120 }, (_, index) => ({ url: `https://h.example/${index}`, title: `${index}` }))
    closed.remember(tab('https://h.example/100', { history: { entries, index: 100 } }))
    const history = closed.take()?.history
    expect(history?.entries.length).toBe(50)
    expect(history?.entries[history.index]?.url).toBe('https://h.example/100')
  })

  it('lists only what the interface needs (no history or page state)', () => {
    const closed = new ClosedTabs(25, ids)
    closed.remember(tab('https://a.example/', { history: { entries: [{ url: 'https://a.example/', title: 'A', pageState: 's' }], index: 0 } }))
    expect(Object.keys(closed.list()[0] ?? {}).sort()).toEqual(['favicon', 'id', 'title', 'url'])
  })

  it('remembers the workspace and folder a tab closed in, and lists neither', () => {
    const closed = new ClosedTabs(25, ids)
    closed.remember(tab('https://a.example/', { workspaceId: 'work', folderId: 'papers' }))
    closed.remember(tab('https://b.example/', { workspaceId: 'work' }))
    closed.remember(tab('https://c.example/', { workspaceId: null, folderId: 'orphan' }))
    closed.remember(tab('https://d.example/', { workspaceId: 'x'.repeat(81), folderId: 'papers' }))
    expect(Object.keys(closed.list()[0] ?? {}).sort()).toEqual(['favicon', 'id', 'title', 'url'])
    expect([closed.take(), closed.take(), closed.take(), closed.take()].map((entry) => [entry?.workspaceId, entry?.folderId])).toEqual([
      [undefined, undefined], [undefined, undefined], ['work', undefined], ['work', 'papers'],
    ])
  })
})

describe('where a reopened tab goes', () => {
  const folders: Record<string, { id: string }[]> = { main: [{ id: 'm1' }], work: [{ id: 'papers' }] }
  const foldersOf = (id: string) => folders[id] ?? null

  it('back in the workspace it closed in, and into its folder while that is there', () => {
    expect(reopenPlace({ workspaceId: 'work', folderId: 'papers' }, 'main', foldersOf)).toEqual({ workspaceId: 'work', folderId: 'papers' })
    expect(reopenPlace({ workspaceId: 'work', folderId: 'deleted' }, 'main', foldersOf)).toEqual({ workspaceId: 'work' })
    expect(reopenPlace({ workspaceId: 'main', folderId: 'm1' }, 'main', foldersOf)).toEqual({ workspaceId: 'main', folderId: 'm1' })
  })

  it('in the workspace shown, outside any folder, when its own is gone or was never recorded', () => {
    expect(reopenPlace({ workspaceId: 'gone', folderId: 'papers' }, 'work', foldersOf)).toEqual({ workspaceId: 'work' })
    expect(reopenPlace({}, 'work', foldersOf)).toEqual({ workspaceId: 'work' })
    expect(reopenPlace({ folderId: 'papers' }, 'work', foldersOf)).toEqual({ workspaceId: 'work' })
  })
})
