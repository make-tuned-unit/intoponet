import { describe, expect, it } from 'vitest'
import { canNest, deleteFolder, descendantIds, folderDepth, folderedOrder, folderTreeOrder, moveFolderedTab, setTabFolder, type TabFolder } from './tabOrder'


describe('tab folders', () => {
  const folders = (): TabFolder[] => [
    { id: 'work', name: 'Work', parentId: null },
    { id: 'reports', name: 'Reports', parentId: 'work' },
    { id: 'trips', name: 'Trips', parentId: null },
  ]
  const tabs = (): Array<{ id: string; pinned?: boolean; folderId?: string }> => [
    { id: 'p', pinned: true },
    { id: 'a' },
    { id: 'b', folderId: 'trips' },
    { id: 'c', folderId: 'reports' },
    { id: 'd', folderId: 'work' },
    { id: 'e' },
  ]

  it('orders pinned tabs, then each folder depth first, then loose tabs', () => {
    expect(folderTreeOrder(folders())).toEqual(['work', 'reports', 'trips'])
    expect(folderedOrder(tabs(), folders()).map((tab) => tab.id)).toEqual(['p', 'd', 'c', 'b', 'a', 'e'])
    // A tab whose folder is gone is loose.
    expect(folderedOrder([{ id: 'x', folderId: 'gone' }, { id: 'y', folderId: 'trips' }], folders()).map((tab) => tab.id)).toEqual(['y', 'x'])
  })

  it('nests at least four levels, never inside itself', () => {
    const deep: TabFolder[] = [
      { id: '1', name: '1', parentId: null }, { id: '2', name: '2', parentId: '1' }, { id: '3', name: '3', parentId: '2' }, { id: '4', name: '4', parentId: '3' },
    ]
    expect(folderDepth(deep, '4')).toBe(4)
    expect(canNest(deep, '1', '4')).toBe(false)
    expect(canNest(deep, '4', '4')).toBe(false)
    expect(canNest([...deep, { id: '5', name: '5', parentId: null }], '5', '4')).toBe(true)
    const tooDeep = [...deep, { id: '5', name: '5', parentId: '4' }, { id: '6', name: '6', parentId: '5' }, { id: 'x', name: 'x', parentId: null }]
    expect(canNest(tooDeep, 'x', '6')).toBe(false)
    expect(descendantIds(deep, '2')).toEqual(new Set(['3', '4']))
  })

  it('moves tabs into folders, and dropping among a folder’s tabs joins it', () => {
    const list = folderedOrder(tabs(), folders())
    expect(setTabFolder(list, folders(), 'a', 'reports')).toBe(true)
    expect(list.map((tab) => `${tab.id}:${tab.folderId ?? ''}`)).toEqual(['p:', 'd:work', 'c:reports', 'a:reports', 'b:trips', 'e:'])
    expect(setTabFolder(list, folders(), 'p', 'work')).toBe(false)
    // e dropped where b (trips) is: e joins trips.
    expect(moveFolderedTab(list, folders(), 'e', list.findIndex((tab) => tab.id === 'b'))).toBe(true)
    expect(list.find((tab) => tab.id === 'e')!.folderId).toBe('trips')
    expect(list.map((tab) => tab.id)).toEqual(['p', 'd', 'c', 'a', 'e', 'b'])
    // Out of a folder: dropped among loose tabs (none left here, so by setting no folder).
    expect(setTabFolder(list, folders(), 'e', null)).toBe(true)
    expect(list.at(-1)!.id).toBe('e')
  })

  it('deletes a folder: its folders move up and its tabs go to its parent', () => {
    const list = folderedOrder(tabs(), folders())
    const all = folders()
    expect(deleteFolder(list, all, 'work')).toBe(true)
    expect(all.find((folder) => folder.id === 'reports')!.parentId).toBeNull()
    expect(list.find((tab) => tab.id === 'd')!.folderId).toBeUndefined()
    expect(list.map((tab) => tab.id)).toEqual(['p', 'c', 'b', 'd', 'a', 'e'])
  })
})
