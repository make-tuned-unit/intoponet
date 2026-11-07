import { describe, expect, it } from 'vitest'
import { MAX_FAVOURITES, MAX_WORKSPACES, parseBrowserHostCommand } from '@intoponet/browser-api'
import { groupSavedFolders, MAIN_WORKSPACE, nextWorkspaceLook, parseSavedWorkspaces, savedWorkspaceOf, WorkspaceSet, type ParkedWorkspace } from './workspaces'
import { pagePartition } from './workspaceIdentity'

type Tab = { id: string; asleep?: boolean }
const parked = (ids: string[], activeTabId: string | null = null): ParkedWorkspace<Tab> => ({ tabs: ids.map((id) => ({ id })), folders: [], activeTabId })

describe('workspaces', () => {
  it('starts with one Main workspace, shown', () => {
    const set = new WorkspaceSet<Tab>()
    expect(set.workspaces).toEqual([MAIN_WORKSPACE])
    expect(set.activeId).toBe('main')
    expect(set.parkedTabs()).toEqual([])
  })

  it('names new workspaces and gives each an unused icon and accent from the palette', () => {
    const set = new WorkspaceSet<Tab>()
    const second = set.create()!
    const third = set.create({ name: 'Travel' })!
    expect(second.name).toBe('Workspace 2')
    expect(third.name).toBe('Travel')
    expect(new Set(set.workspaces.map((workspace) => workspace.accent)).size).toBe(3)
    expect(new Set(set.workspaces.map((workspace) => workspace.icon)).size).toBe(3)
    expect(nextWorkspaceLook([{ ...MAIN_WORKSPACE }, { id: 'x', name: 'Workspace 2', icon: 'book', accent: 'cyan' }]).name).toBe('Workspace 3')
  })

  it('stops at nine (⌃1–9 reach them all)', () => {
    const set = new WorkspaceSet<Tab>()
    for (let i = 1; i < MAX_WORKSPACES; i += 1) expect(set.create()).not.toBeNull()
    expect(set.create()).toBeNull()
    expect(set.workspaces).toHaveLength(MAX_WORKSPACES)
  })

  it('switching parks the shown workspace as it is and hands back the other one untouched', () => {
    const set = new WorkspaceSet<Tab>()
    const work = set.create({ name: 'Work' })!
    set.park(work.id, { tabs: [{ id: 'w1', asleep: true }, { id: 'w2' }], folders: [{ id: 'f', name: 'Docs', parentId: null }], activeTabId: 'w2' })
    const mainTabs = [{ id: 'm1' }, { id: 'm2', asleep: true }]
    const shown = set.switchTo(work.id, { tabs: mainTabs, folders: [], activeTabId: 'm1' })!
    expect(set.activeId).toBe(work.id)
    expect(shown.tabs).toEqual([{ id: 'w1', asleep: true }, { id: 'w2' }])
    expect(shown.activeTabId).toBe('w2')
    expect(shown.folders.map((folder) => folder.name)).toEqual(['Docs'])
    // The same objects: nothing was reloaded or copied, sleeping tabs stay asleep.
    expect(set.parkedOf('main')!.tabs[1]).toBe(mainTabs[1])
    expect(set.parkedTabs().map((tab) => tab.id)).toEqual(['m1', 'm2'])
    expect(set.workspaceOfParkedTab('m2')).toBe('main')
    expect(set.switchTo(work.id, parked([]))).toBeNull()
    expect(set.switchTo('nope', parked([]))).toBeNull()
  })

  it('resolves ⌃N, next and previous', () => {
    const set = new WorkspaceSet<Tab>()
    const two = set.create()!
    const three = set.create()!
    expect(set.resolve({ index: 1 })?.id).toBe(two.id)
    expect(set.resolve({ index: 5 })).toBeNull()
    expect(set.resolve({ step: -1 })?.id).toBe(three.id)
    expect(set.resolve({ step: 1 })?.id).toBe(two.id)
  })

  it('renames, restyles and reorders', () => {
    const set = new WorkspaceSet<Tab>()
    const two = set.create()!
    expect(set.update(two.id, { name: 'Research', icon: 'flask', accent: 'violet' })).toBe(true)
    expect(set.update(two.id, { name: 'Research' })).toBe(false)
    expect(set.get(two.id)).toMatchObject({ name: 'Research', icon: 'flask', accent: 'violet' })
    expect(set.move(two.id, 0)).toBe(true)
    expect(set.workspaces.map((workspace) => workspace.id)).toEqual([two.id, 'main'])
    expect(set.move(two.id, 0)).toBe(false)
  })

  it('deletes only a workspace not shown, and Undo puts it back where it was with its tabs and favourites', () => {
    const set = new WorkspaceSet<Tab>()
    const two = set.create()!
    const three = set.create()!
    set.park(two.id, parked(['a', 'b'], 'b'))
    set.switchTo(two.id, parked(['m']))
    set.addFavourite('https://mail.example/', 'Mail', false)
    set.switchTo('main', parked(['a', 'b'], 'b'))
    expect(set.remove('main')).toBeNull()
    const removed = set.remove(two.id)!
    expect(removed.index).toBe(1)
    expect(removed.parked.tabs.map((tab) => tab.id)).toEqual(['a', 'b'])
    expect(removed.favourites).toHaveLength(1)
    expect(set.favourites).toHaveLength(0)
    expect(set.workspaces.map((workspace) => workspace.id)).toEqual(['main', three.id])
    expect(set.restore(removed)).toBe(true)
    expect(set.workspaces.map((workspace) => workspace.id)).toEqual(['main', two.id, three.id])
    expect(set.parkedOf(two.id)!.tabs.map((tab) => tab.id)).toEqual(['a', 'b'])
    expect(set.favourites).toHaveLength(1)
  })

  it('never deletes the last workspace', () => {
    const set = new WorkspaceSet<Tab>()
    expect(set.remove('main')).toBeNull()
  })

  it('moves a tab into another workspace and takes it out again', () => {
    const set = new WorkspaceSet<Tab>()
    const two = set.create()!
    expect(set.addToParked(two.id, { id: 't' })).toBe(true)
    expect(set.addToParked('main', { id: 'x' })).toBe(false)
    expect(set.workspaceOfParkedTab('t')).toBe(two.id)
    expect(set.takeParkedTab('t')).toEqual({ id: 't' })
    expect(set.parkedTabs()).toEqual([])
  })
})

describe('favourites', () => {
  it('are shared by every workspace unless owned by one', () => {
    const set = new WorkspaceSet<Tab>()
    const two = set.create()!
    const shared = set.addFavourite('https://news.example/', 'News', true)!
    const own = set.addFavourite('https://mail.example/', 'Mail', false)!
    expect(own.workspaceId).toBe('main')
    expect(set.visibleFavourites().map((favourite) => favourite.title)).toEqual(['News', 'Mail'])
    set.switchTo(two.id, parked([]))
    expect(set.visibleFavourites().map((favourite) => favourite.title)).toEqual(['News'])
    // Owned by the workspace shown now.
    expect(set.setFavouriteShared(shared.id, false)).toBe(true)
    expect(set.favourites.find((favourite) => favourite.id === shared.id)!.workspaceId).toBe(two.id)
    expect(set.setFavouriteShared(own.id, true)).toBe(true)
    expect(set.visibleFavourites().map((favourite) => favourite.title)).toEqual(['News', 'Mail'])
    expect(set.removeFavourite(own.id)).toBe(true)
    expect(set.removeFavourite(own.id)).toBe(false)
  })

  it('adds a site once, and keeps the row short', () => {
    const set = new WorkspaceSet<Tab>()
    const first = set.addFavourite('https://a.example/x', 'A', true)!
    expect(set.addFavourite('https://a.example/x/', 'A again', true)).toBe(first)
    for (let i = 1; i < MAX_FAVOURITES; i += 1) set.addFavourite(`https://site${i}.example/`, `S${i}`, true)
    expect(set.addFavourite('https://one-too-many.example/', 'X', true)).toBeNull()
  })
})

describe('saved workspaces', () => {
  it('moves everything saved before workspaces existed into Main', () => {
    const saved = parseSavedWorkspaces({ version: 2, tabs: [{ id: 't', url: 'https://a.example/' }] })
    expect(saved.migrated).toBe(true)
    expect(saved.workspaces).toEqual([MAIN_WORKSPACE])
    expect(saved.activeId).toBe('main')
    expect(savedWorkspaceOf({ id: 't' }, saved.workspaces)).toBe('main')
    expect(groupSavedFolders([{ id: 'f', name: 'F', parentId: null }], saved.workspaces).get('main')).toHaveLength(1)
  })

  it('reads workspaces, the one shown and favourites, dropping only what is damaged', () => {
    const saved = parseSavedWorkspaces({
      version: 3,
      activeWorkspaceId: 'w2',
      workspaces: [
        { id: 'main', name: 'Main', icon: 'globe', accent: 'teal', activeTabId: 't1' },
        { id: 'w2', name: '  Work\nstuff ', icon: 'rocket', accent: 'pink' },
        { id: 'w2', name: 'Duplicate' },
        { id: 'w3', name: '' },
        'junk',
      ],
      favourites: [
        { id: 'f1', url: 'https://mail.example/', title: 'Mail', workspaceId: null },
        { id: 'f2', url: 'javascript:alert(1)', title: 'Bad' },
        { id: 'f3', url: 'https://notes.example/', title: 'Notes', workspaceId: 'w2' },
        { id: 'f4', url: 'https://gone.example/', title: 'Gone', workspaceId: 'deleted' },
      ],
    })
    expect(saved.migrated).toBe(false)
    expect(saved.workspaces.map((workspace) => [workspace.id, workspace.name, workspace.icon])).toEqual([['main', 'Main', 'globe'], ['w2', 'Work stuff', 'globe']])
    expect(saved.workspaces[0]!.activeTabId).toBe('t1')
    expect(saved.activeId).toBe('w2')
    expect(saved.favourites.map((favourite) => favourite.id)).toEqual(['f1', 'f3'])
    expect(savedWorkspaceOf({ workspaceId: 'w2' }, saved.workspaces)).toBe('w2')
    expect(savedWorkspaceOf({ workspaceId: 'deleted' }, saved.workspaces)).toBe('main')
  })

  it('falls back to the first workspace when the shown one is missing', () => {
    expect(parseSavedWorkspaces({ workspaces: [{ id: 'a', name: 'A' }], activeWorkspaceId: 'b' }).activeId).toBe('a')
  })
})

describe('workspace commands from the app window', () => {
  it('are validated with the other browser-host commands', () => {
    expect(parseBrowserHostCommand({ type: 'switch-workspace', index: 1 })).toEqual({ type: 'switch-workspace', index: 1 })
    expect(parseBrowserHostCommand({ type: 'switch-workspace', step: -1 })).toEqual({ type: 'switch-workspace', step: -1 })
    expect(parseBrowserHostCommand({ type: 'create-workspace', name: ' Travel ', accent: 'coral' })).toEqual({ type: 'create-workspace', name: 'Travel', accent: 'coral' })
    expect(parseBrowserHostCommand({ type: 'add-favourite', tabId: 't' })).toEqual({ type: 'add-favourite', tabId: 't', shared: true })
    expect(() => parseBrowserHostCommand({ type: 'switch-workspace', index: 9 })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'create-workspace', icon: 'rocket' })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'update-workspace', id: 'w', name: '   ' })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'move-tab-to-workspace', tabId: 't' })).toThrow()
  })
})

describe('workspace separate sign-ins', () => {
  it('turns separate sign-ins on and off, and reports a change only when there is one', () => {
    const set = new WorkspaceSet<{ id: string }>([{ ...MAIN_WORKSPACE }, { id: 'work', name: 'Work', icon: 'briefcase', accent: 'cyan' }])
    expect(set.get('work')?.separateSignIns).toBeUndefined()
    expect(set.update('work', { separateSignIns: true })).toBe(true)
    expect(set.get('work')?.separateSignIns).toBe(true)
    expect(set.update('work', { separateSignIns: true })).toBe(false)
    expect(set.update('work', { separateSignIns: false })).toBe(true)
    expect(set.snapshot(() => 0).workspaces.find((workspace) => workspace.id === 'work')?.separateSignIns).toBe(false)
  })

  it('keeps the setting in saved state, and drops a damaged one', () => {
    const saved = parseSavedWorkspaces({
      activeWorkspaceId: 'work',
      workspaces: [
        { id: 'main', name: 'Main', icon: 'globe', accent: 'teal' },
        { id: 'work', name: 'Work', icon: 'briefcase', accent: 'cyan', separateSignIns: true },
        { id: 'home', name: 'Home', icon: 'house', accent: 'mint', separateSignIns: 'yes' },
      ],
    })
    expect(saved.workspaces.map((workspace) => [workspace.id, workspace.separateSignIns])).toEqual([
      ['main', undefined],
      ['work', true],
      ['home', undefined],
    ])
  })

  it('treats a saved id that cannot name a partition as not having separate sign-ins', () => {
    const saved = parseSavedWorkspaces({
      activeWorkspaceId: 'main',
      workspaces: [
        { id: 'main', name: 'Main', icon: 'globe', accent: 'teal' },
        { id: 'my work', name: 'Edited', icon: 'briefcase', accent: 'cyan', separateSignIns: true },
        { id: '../x', name: 'Escape', icon: 'house', accent: 'mint', separateSignIns: true },
        { id: 'w-2', name: 'Fine', icon: 'house', accent: 'mint', separateSignIns: true },
      ],
    })
    // The workspaces themselves are kept; only the setting goes, so restoring builds their tabs in the shared partition.
    expect(saved.workspaces.map((workspace) => [workspace.id, workspace.separateSignIns])).toEqual([
      ['main', undefined],
      ['my work', undefined],
      ['../x', undefined],
      ['w-2', true],
    ])
    for (const workspace of saved.workspaces) expect(() => pagePartition(workspace, false)).not.toThrow()
  })
})

describe('separate sign-ins commands', () => {
  it('parses the setting and the clear command', () => {
    expect(parseBrowserHostCommand({ type: 'update-workspace', id: 'work', separateSignIns: true })).toMatchObject({ type: 'update-workspace', id: 'work', separateSignIns: true })
    expect(parseBrowserHostCommand({ type: 'update-workspace', id: 'work', name: 'Work' })).not.toHaveProperty('separateSignIns')
    expect(() => parseBrowserHostCommand({ type: 'update-workspace', id: 'work', separateSignIns: 'yes' })).toThrow()
    expect(parseBrowserHostCommand({ type: 'clear-workspace-sign-ins', id: 'work' })).toEqual({ type: 'clear-workspace-sign-ins', id: 'work' })
    expect(() => parseBrowserHostCommand({ type: 'clear-workspace-sign-ins' })).toThrow()
  })
})
