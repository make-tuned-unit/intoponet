import { describe, expect, it } from 'vitest'
import { repairSplits, type SplitTab } from './splitPages'
import { planGrouping, snapshotGrouping, undoGrouping, type GroupableTab } from './tabGrouping'
import { folderedOrder, type FolderedTab, type TabFolder } from './tabOrder'

let counter = 0
const newId = () => `f${++counter}`

// In the sidebar's order (main keeps its tabs so): pinned, then each folder's tabs, then the rest.
const tabs = (): GroupableTab[] => [
  { id: 'pin', pinned: true },
  { id: 'c', folderId: 'old' },
  { id: 'a' },
  { id: 'b' },
  { id: 'secret', isPrivate: true },
]
const folders = (): TabFolder[] => [{ id: 'old', name: 'Reading', parentId: null }]

describe('planGrouping', () => {
  it('makes one folder per story and moves the loose tabs into it', () => {
    const plan = planGrouping({ tabs: tabs(), folders: folders(), groups: [{ name: 'Delta floods', tabIds: ['a', 'b'], storyId: 'flood' }], maxFolders: 60, newId })
    expect(plan.created.length).toBe(1)
    const made = plan.folders.find((folder) => folder.id === plan.created[0])!
    expect(made).toMatchObject({ name: 'Delta floods', parentId: null, storyId: 'flood' })
    expect(plan.folderOf.get('a')).toBe(made.id)
    expect(plan.folderOf.get('b')).toBe(made.id)
  })

  it('reuses the folder that already has the story, then one with the same name', () => {
    const existing: TabFolder[] = [{ id: 'story', name: 'Old name', parentId: null, storyId: 'flood' }, { id: 'named', name: 'Delta floods', parentId: null }]
    const byStory = planGrouping({ tabs: tabs(), folders: existing, groups: [{ name: 'Delta floods', tabIds: ['a'], storyId: 'flood' }], maxFolders: 60, newId })
    expect(byStory.created).toEqual([])
    expect(byStory.folderOf.get('a')).toBe('story')
    const byName = planGrouping({ tabs: tabs(), folders: existing, groups: [{ name: 'Delta floods', tabIds: ['a', 'b'] }], maxFolders: 60, newId })
    expect(byName.created).toEqual([])
    expect(byName.folderOf.get('b')).toBe('named')
  })

  it('gives a same-named folder the story when it has none, and never takes another story\'s folder', () => {
    const plain: TabFolder[] = [{ id: 'named', name: 'Vote', parentId: null }]
    const adopted = planGrouping({ tabs: tabs(), folders: plain, groups: [{ name: 'Vote', tabIds: ['a'], storyId: 'vote' }], maxFolders: 60, newId })
    expect(adopted.folders.find((folder) => folder.id === 'named')?.storyId).toBe('vote')
    const other: TabFolder[] = [{ id: 'taken', name: 'Vote', parentId: null, storyId: 'flood' }]
    const separate = planGrouping({ tabs: tabs(), folders: other, groups: [{ name: 'Vote', tabIds: ['a'], storyId: 'vote' }], maxFolders: 60, newId })
    expect(separate.created.length).toBe(1)
    expect(separate.folderOf.get('a')).toBe(separate.created[0])
  })

  it('never moves pinned or private tabs, and skips unknown ids', () => {
    const plan = planGrouping({ tabs: tabs(), folders: folders(), groups: [{ name: 'X', tabIds: ['pin', 'secret', 'missing', 'b'] }], maxFolders: 60, newId })
    expect([...plan.folderOf.keys()]).toEqual(['b'])
  })

  it('respects the folder limit', () => {
    const full: TabFolder[] = Array.from({ length: 2 }, (_, i) => ({ id: `x${i}`, name: `Folder ${i}`, parentId: null }))
    const plan = planGrouping({ tabs: tabs(), folders: full, groups: [{ name: 'New', tabIds: ['a', 'b'] }], maxFolders: 2, newId })
    expect(plan.created).toEqual([])
    expect(plan.folderOf.size).toBe(0)
  })

  it('does not change the folders it was given', () => {
    const input = folders()
    planGrouping({ tabs: tabs(), folders: input, groups: [{ name: 'Reading', tabIds: ['a'], storyId: 'x' }], maxFolders: 60, newId })
    expect(input).toEqual(folders())
  })
})

describe('undoGrouping', () => {
  it('restores the folders, each tab\'s folder and the tab order exactly', () => {
    const currentTabs = tabs()
    const currentFolders = folders()
    const snapshot = snapshotGrouping(currentTabs, currentFolders, [])
    const plan = planGrouping({ tabs: currentTabs, folders: currentFolders, groups: [{ name: 'Delta floods', tabIds: ['b', 'a'], storyId: 'flood' }], maxFolders: 60, newId })
    // Apply the plan the way main does.
    currentFolders.splice(0, currentFolders.length, ...plan.folders)
    for (const tab of currentTabs) {
      const folderId = plan.folderOf.get(tab.id)
      if (folderId) tab.folderId = folderId
    }
    const grouped = snapshotGrouping(currentTabs, currentFolders, plan.created)
    expect(grouped.created).toHaveLength(1)
    // Undo the grouping: the snapshot taken before it.
    undoGrouping(currentTabs, currentFolders, { ...snapshot, created: plan.created })
    expect(currentFolders).toEqual(folders())
    expect(currentTabs.map((tab) => tab.id)).toEqual(['pin', 'c', 'a', 'b', 'secret'])
    expect(currentTabs.find((tab) => tab.id === 'a')?.folderId).toBeUndefined()
    expect(currentTabs.find((tab) => tab.id === 'c')?.folderId).toBe('old')
  })

  it('restores a reused folder\'s story, and tabs opened since keep their folder unless it was made by the grouping', () => {
    const currentTabs: GroupableTab[] = [{ id: 'a', folderId: 'story' }]
    const currentFolders: TabFolder[] = [{ id: 'story', name: 'Delta floods', parentId: null }]
    const snapshot = snapshotGrouping(currentTabs, currentFolders, [])
    currentFolders[0]!.storyId = 'flood'
    currentTabs.push({ id: 'new', folderId: 'story' }, { id: 'gone', folderId: 'made' })
    currentFolders.push({ id: 'made', name: 'Made', parentId: null })
    undoGrouping(currentTabs, currentFolders, snapshot)
    expect(currentFolders.find((folder) => folder.id === 'story')?.storyId).toBeUndefined()
    expect(currentTabs.find((tab) => tab.id === 'new')?.folderId).toBe('story')
    expect(currentTabs.find((tab) => tab.id === 'gone')?.folderId).toBe('made')
  })

  /** Group `ids` into a new folder the way main does (plan, apply, folderedOrder), and return the snapshot to undo it. */
  const group = (currentTabs: GroupableTab[], currentFolders: TabFolder[], ids: string[]) => {
    const plan = planGrouping({ tabs: currentTabs, folders: currentFolders, groups: [{ name: 'Delta floods', tabIds: ids, storyId: 'flood' }], maxFolders: 60, newId })
    const snapshot = snapshotGrouping(currentTabs, currentFolders, plan.created)
    currentFolders.splice(0, currentFolders.length, ...plan.folders)
    for (const tab of currentTabs) {
      const folderId = plan.folderOf.get(tab.id)
      if (folderId) tab.folderId = folderId
    }
    const ordered = folderedOrder(currentTabs as unknown as FolderedTab[], currentFolders) as unknown as GroupableTab[]
    currentTabs.splice(0, currentTabs.length, ...ordered)
    // Moving one side of a pair into a folder ends the pair (main's repairSplits).
    repairSplits(currentTabs as unknown as SplitTab[])
    return snapshot
  }

  it('keeps pinned tabs first and folder tabs together when tabs were pinned or put in a folder since', () => {
    const currentTabs: GroupableTab[] = [{ id: 'pin', pinned: true }, { id: 'a' }, { id: 'b' }, { id: 'x' }, { id: 'y' }]
    const currentFolders: TabFolder[] = [{ id: 'old', name: 'Reading', parentId: null }]
    const snapshot = group(currentTabs, currentFolders, ['a', 'b'])
    // Since the grouping: `x` was pinned (pinned tabs go first), `y` put in the folder Reading, and a new tab put there too.
    const x = currentTabs.find((tab) => tab.id === 'x')!
    x.pinned = true
    currentTabs.splice(currentTabs.indexOf(x), 1)
    currentTabs.splice(1, 0, x)
    currentTabs.find((tab) => tab.id === 'y')!.folderId = 'old'
    currentTabs.push({ id: 'new', folderId: 'old' })
    undoGrouping(currentTabs, currentFolders, snapshot)
    expect(currentTabs.map((tab) => tab.id)).toEqual(['pin', 'x', 'new', 'a', 'b', 'y'])
    expect(currentTabs.find((tab) => tab.id === 'y')?.folderId).toBeUndefined()
    expect(currentTabs.find((tab) => tab.id === 'new')?.folderId).toBe('old')
  })

  it('pairs side by side again the tabs whose pair the grouping ended', () => {
    const pairOf = (partnerId: string, side: 'left' | 'right') => ({ split: { partnerId, side, ratio: 0.4 } })
    const currentTabs: GroupableTab[] = [{ id: 'a', ...pairOf('b', 'left') }, { id: 'b', ...pairOf('a', 'right') }, { id: 'c' }]
    const snapshot = group(currentTabs, [], ['a', 'c'])
    expect(currentTabs.every((tab) => !tab.split)).toBe(true)
    undoGrouping(currentTabs, [], snapshot)
    expect(currentTabs.map((tab) => tab.id)).toEqual(['a', 'b', 'c'])
    expect(currentTabs[0]!.split).toEqual({ partnerId: 'b', side: 'left', ratio: 0.4 })
    expect(currentTabs[1]!.split).toEqual({ partnerId: 'a', side: 'right', ratio: 0.4 })
  })

  it('leaves alone a pair whose other side closed, or a side paired with another tab since', () => {
    const pairOf = (partnerId: string, side: 'left' | 'right') => ({ split: { partnerId, side, ratio: 0.5 } })
    const closed: GroupableTab[] = [{ id: 'a', ...pairOf('b', 'left') }, { id: 'b', ...pairOf('a', 'right') }, { id: 'c' }]
    const first = group(closed, [], ['a', 'c'])
    closed.splice(closed.findIndex((tab) => tab.id === 'b'), 1)
    undoGrouping(closed, [], first)
    expect(closed.every((tab) => !tab.split)).toBe(true)
    const repaired: GroupableTab[] = [{ id: 'a', ...pairOf('b', 'left') }, { id: 'b', ...pairOf('a', 'right') }, { id: 'c' }]
    const second = group(repaired, [], ['a', 'c'])
    // `b` was put side by side with a new tab since.
    repaired.find((tab) => tab.id === 'b')!.split = { partnerId: 'n', side: 'left', ratio: 0.5 }
    repaired.push({ id: 'n', split: { partnerId: 'b', side: 'right', ratio: 0.5 } })
    undoGrouping(repaired, [], second)
    expect(repaired.find((tab) => tab.id === 'a')?.split).toBeUndefined()
    expect(repaired.find((tab) => tab.id === 'b')?.split?.partnerId).toBe('n')
  })

  it('moves the subfolders of a removed folder to the top', () => {
    const currentFolders: TabFolder[] = [{ id: 'made', name: 'Delta', parentId: null, storyId: 'x' }, { id: 'child', name: 'Sub', parentId: 'made' }]
    undoGrouping([], currentFolders, { order: [], folderOf: [], storyOf: [], created: ['made'] })
    expect(currentFolders).toEqual([{ id: 'child', name: 'Sub', parentId: null }])
  })
})
