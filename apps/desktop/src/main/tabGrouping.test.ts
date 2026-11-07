import { describe, expect, it } from 'vitest'
import { planGrouping, snapshotGrouping, undoGrouping, type GroupableTab } from './tabGrouping'
import type { TabFolder } from './tabOrder'

let counter = 0
const newId = () => `f${++counter}`

const tabs = (): GroupableTab[] => [
  { id: 'pin', pinned: true },
  { id: 'a' },
  { id: 'b' },
  { id: 'secret', isPrivate: true },
  { id: 'c', folderId: 'old' },
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
    expect(currentTabs.map((tab) => tab.id)).toEqual(['pin', 'a', 'b', 'secret', 'c'])
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

  it('moves the subfolders of a removed folder to the top', () => {
    const currentFolders: TabFolder[] = [{ id: 'made', name: 'Delta', parentId: null, storyId: 'x' }, { id: 'child', name: 'Sub', parentId: 'made' }]
    undoGrouping([], currentFolders, { order: [], folderOf: [], storyOf: [], created: ['made'] })
    expect(currentFolders).toEqual([{ id: 'child', name: 'Sub', parentId: null }])
  })
})
