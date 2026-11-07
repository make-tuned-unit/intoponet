import { describe, expect, it } from 'vitest'
import { parseBrowserHostCommand } from '@intoponet/browser-api'
import { allowedRange, duplicateIndex, moveTab, otherTabIds, pinnedFirst, setPinned, tabIdsToRight, type OrderedTab } from './tabOrder'
import { folderSubmenu, tabMenuEntries, tabMenuTemplate, type TabMenuTab } from './tabMenu'
import { liveTabFlags } from './tabState'

const ids = (tabs: OrderedTab[]): string => tabs.map((tab) => `${tab.id}${tab.pinned ? '*' : ''}`).join(' ')
const make = (spec: string): OrderedTab[] =>
  spec.split(' ').map((token) => (token.endsWith('*') ? { id: token.slice(0, -1), pinned: true } : { id: token }))

describe('tab order', () => {
  it('puts pinned tabs first, keeping each group in order', () => {
    expect(ids(pinnedFirst(make('a b* c d* e')))).toBe('b* d* a c e')
  })

  it('moves an ordinary tab within the unpinned group only', () => {
    const tabs = make('p* a b c')
    expect(moveTab(tabs, 'c', 1)).toBe(true)
    expect(ids(tabs)).toBe('p* c a b')
    // Asking for the pinned zone clamps to the first unpinned place: nothing to do here.
    expect(moveTab(tabs, 'c', 0)).toBe(false)
    expect(moveTab(tabs, 'a', 99)).toBe(true)
    expect(ids(tabs)).toBe('p* c b a')
  })

  it('keeps a pinned tab inside the pinned group', () => {
    const tabs = make('p* q* a')
    expect(moveTab(tabs, 'p', 5)).toBe(true)
    expect(ids(tabs)).toBe('q* p* a')
    expect(allowedRange(tabs, true)).toEqual({ min: 0, max: 1 })
    expect(allowedRange(tabs, false)).toEqual({ min: 2, max: 2 })
  })

  it('ignores unknown tabs', () => {
    const tabs = make('a b')
    expect(moveTab(tabs, 'zz', 0)).toBe(false)
    expect(setPinned(tabs, 'zz', true)).toBe(false)
  })

  it('pins to the end of the pinned group and unpins to the start of the others', () => {
    const tabs = make('p* a b c')
    expect(setPinned(tabs, 'c', true)).toBe(true)
    expect(ids(tabs)).toBe('p* c* a b')
    expect(setPinned(tabs, 'c', true)).toBe(false)
    expect(setPinned(tabs, 'p', false)).toBe(true)
    expect(ids(tabs)).toBe('c* p a b')
  })

  it('never closes pinned tabs with "close others" or "to the right"', () => {
    const tabs = make('p* a b c')
    expect(otherTabIds(tabs, 'b')).toEqual(['a', 'c'])
    expect(otherTabIds(tabs, 'p')).toEqual(['a', 'b', 'c'])
    expect(tabIdsToRight(tabs, 'a')).toEqual(['b', 'c'])
    expect(tabIdsToRight(tabs, 'p')).toEqual(['a', 'b', 'c'])
    expect(tabIdsToRight(tabs, 'c')).toEqual([])
  })

  it('places a duplicate next to its source (first among unpinned for a pinned source)', () => {
    const tabs = make('p* q* a b')
    expect(duplicateIndex(tabs, 'a')).toBe(3)
    expect(duplicateIndex(tabs, 'p')).toBe(2)
    expect(duplicateIndex(tabs, 'missing')).toBe(4)
  })
})

describe('tab context menu', () => {
  const page = (id: string, extra: Partial<TabMenuTab> = {}): TabMenuTab => ({ id, url: `https://example.org/${id}`, ...extra })

  it('lists the browser tab actions in order', () => {
    const labels = tabMenuEntries([page('a'), page('b'), page('c')], 'b').map((entry) => ('separator' in entry ? '—' : entry.label))
    expect(labels).toEqual(['Reload', 'Duplicate', 'Pin Tab', 'Mute Site', '—', 'Copy Link', '—', 'Close Tab', 'Close Other Tabs', 'Close Tabs to the Right'])
  })

  it('offers unpin and unmute for a pinned, muted tab', () => {
    const labels = tabMenuEntries([page('a', { pinned: true, muted: true })], 'a').flatMap((entry) => ('separator' in entry ? [] : [entry.label]))
    expect(labels).toContain('Unpin Tab')
    expect(labels).toContain('Unmute Site')
  })

  it('disables what cannot apply', () => {
    const entries = tabMenuEntries([page('p', { pinned: true }), page('a'), { id: 'n', url: '', isStartPage: true }], 'n')
    const enabled = Object.fromEntries(entries.flatMap((entry) => ('separator' in entry ? [] : [[entry.action, entry.enabled]])))
    expect(enabled['reload']).toBe(false)
    expect(enabled['duplicate']).toBe(false)
    expect(enabled['copy-link']).toBe(false)
    expect(enabled['close']).toBe(true)
    expect(enabled['close-others']).toBe(true)
    expect(enabled['close-right']).toBe(false)
    // Only pinned tabs besides this one: nothing for "close others" to close.
    const solo = tabMenuEntries([page('p', { pinned: true }), page('a')], 'a')
    expect(solo.find((entry) => 'action' in entry && entry.action === 'close-others')).toMatchObject({ enabled: false })
  })

  it('builds a native template whose items run their action for the tab', () => {
    const ran: string[] = []
    const template = tabMenuTemplate([page('a'), page('b')], 'a', (action, id) => ran.push(`${action}:${id}`))
    expect(template.filter((item) => item.type === 'separator')).toHaveLength(2)
    const close = template.find((item) => item.label === 'Close Tab')
    ;(close?.click as () => void)()
    expect(ran).toEqual(['close:a'])
    expect(tabMenuTemplate([page('a')], 'missing', () => undefined)).toEqual([])
  })
})

describe('tab snapshot state', () => {
  const contents = (loading: boolean, audible: boolean, muted: boolean) => ({
    isLoading: () => loading,
    isCurrentlyAudible: () => audible,
    isAudioMuted: () => muted,
  })

  it('reports loading, sound, mute and pin only when on', () => {
    expect(liveTabFlags(contents(false, false, false), {})).toEqual({})
    expect(liveTabFlags(contents(true, true, true), { pinned: true })).toEqual({ loading: true, audible: true, muted: true, pinned: true })
  })

  it('never shows a spinner on a start page, and keeps the pin for a closed page', () => {
    expect(liveTabFlags(contents(true, false, false), { start: true })).toEqual({})
    expect(liveTabFlags(null, { pinned: true })).toEqual({ pinned: true })
  })
})

describe('tab commands', () => {
  it('accepts valid move, pin, mute and menu commands', () => {
    expect(parseBrowserHostCommand({ type: 'move-tab', id: 'a', toIndex: 2 })).toEqual({ type: 'move-tab', id: 'a', toIndex: 2 })
    expect(parseBrowserHostCommand({ type: 'set-tab-pinned', id: 'a', pinned: true })).toEqual({ type: 'set-tab-pinned', id: 'a', pinned: true })
    expect(parseBrowserHostCommand({ type: 'set-tab-muted', id: 'a', muted: false })).toEqual({ type: 'set-tab-muted', id: 'a', muted: false })
    expect(parseBrowserHostCommand({ type: 'tab-menu', id: 'a' })).toEqual({ type: 'tab-menu', id: 'a' })
    expect(parseBrowserHostCommand({ type: 'tab-menu', id: 'a', x: 10.4, y: 20 })).toEqual({ type: 'tab-menu', id: 'a', x: 10, y: 20 })
  })

  it('rejects malformed ones', () => {
    expect(() => parseBrowserHostCommand({ type: 'move-tab', id: 'a', toIndex: -1 })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'move-tab', id: 'a', toIndex: 1.5 })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'move-tab', id: '', toIndex: 0 })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'set-tab-pinned', id: 'a', pinned: 'yes' })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'set-tab-muted', id: 'x'.repeat(81), muted: true })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'tab-menu', id: 'a', x: 5 })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'tab-menu', id: 'a', x: Number.NaN, y: 1 })).toThrow()
  })
})

describe('tab menu: Move to Folder', () => {
  const tabs: TabMenuTab[] = [{ id: 'p', url: 'https://p.example/', pinned: true }, { id: 'a', url: 'https://a.example/' }]
  const choices = (current: string | null, moves: Array<string | null>, made: string[]) => ({
    folders: [{ id: 'w', name: 'Work', depth: 1 }, { id: 'r', name: 'Reports', depth: 2 }],
    current,
    move: (folderId: string | null) => { moves.push(folderId) },
    createFolder: () => { made.push('new') },
  })

  it('lists folders indented by depth, a new folder, and out of folders when in one', () => {
    const moves: Array<string | null> = []
    const made: string[] = []
    const items = folderSubmenu(choices('r', moves, made))
    expect(items.map((item) => item.label ?? item.type)).toEqual(['Work', '    Reports', 'separator', 'New Folder', 'Remove from Folder'])
    expect(items[1]!.checked).toBe(true)
    items[0]!.click?.({} as never, undefined, {} as never)
    items[4]!.click?.({} as never, undefined, {} as never)
    items[3]!.click?.({} as never, undefined, {} as never)
    expect(moves).toEqual(['w', null])
    expect(made).toEqual(['new'])
  })

  it('offers it for unpinned tabs only, after Pin Tab', () => {
    const run = (): void => undefined
    const forTab = tabMenuTemplate(tabs, 'a', run, choices(null, [], []))
    const pinIndex = forTab.findIndex((item) => item.label === 'Pin Tab')
    expect(forTab[pinIndex + 1]!.label).toBe('Move to Folder')
    expect(tabMenuTemplate(tabs, 'p', run, choices(null, [], [])).some((item) => item.label === 'Move to Folder')).toBe(false)
  })
})

describe('tab menu: Move to Workspace and favourites', () => {
  const tabs: TabMenuTab[] = [{ id: 'a', url: 'https://a.example/' }, { id: 'x', url: 'https://x.example/', isPrivate: true }]
  const workspaces = (moves: string[]) => ({
    others: [{ id: 'w2', name: 'Work' }, { id: 'w3', name: 'Home' }],
    move: (id: string) => { moves.push(id) },
    moveToNew: () => { moves.push('new') },
    favourite: { added: false, toggle: () => { moves.push('fav') } },
  })

  it('lists the other workspaces and a new one, and offers favourites, after Pin Tab', () => {
    const moves: string[] = []
    const items = tabMenuTemplate(tabs, 'a', () => undefined, undefined, workspaces(moves))
    const pinIndex = items.findIndex((item) => item.label === 'Pin Tab')
    expect(items[pinIndex + 1]!.label).toBe('Move to Workspace')
    expect(items[pinIndex + 2]!.label).toBe('Add to Favourites')
    const submenu = items[pinIndex + 1]!.submenu as Array<{ label?: string; type?: string; click?: () => void }>
    expect(submenu.map((item) => item.label ?? item.type)).toEqual(['Work', 'Home', 'separator', 'New Workspace'])
    submenu[1]!.click?.()
    submenu[3]!.click?.()
    ;(items[pinIndex + 2]!.click as () => void)()
    expect(moves).toEqual(['w3', 'new', 'fav'])
  })

  it('never offers them for a private tab', () => {
    const items = tabMenuTemplate(tabs, 'x', () => undefined, undefined, workspaces([]))
    expect(items.some((item) => item.label === 'Move to Workspace' || item.label === 'Add to Favourites')).toBe(false)
  })
})

