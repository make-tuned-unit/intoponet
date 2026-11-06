import { describe, expect, it } from 'vitest'
import type { PageTabSnapshot, TabFolderSnapshot } from '@intoponet/browser-api'
import { folderPath, folderTree, saveFolderAsCollections } from './tabFolders'

const folders: TabFolderSnapshot[] = [
  { id: 'w', name: 'Work', parentId: null },
  { id: 'r', name: 'Reports', parentId: 'w' },
  { id: 't', name: 'Trips', parentId: null },
]
const tab = (id: string, url: string, folderId?: string, extra: Partial<PageTabSnapshot> = {}): PageTabSnapshot => ({ id, url, title: `T ${id}`, favicon: '', active: false, ...(folderId ? { folderId } : {}), ...extra })

describe('tab folders and collections', () => {
  it('walks folders depth first and names nested ones by their path', () => {
    expect(folderTree(folders).map(({ folder, depth }) => `${folder.id}${depth}`)).toEqual(['w1', 'r2', 't1'])
    expect(folderPath(folders, 'r')).toBe('Work / Reports')
  })

  it('saves a folder and the folders in it as collections, once, without private tabs', () => {
    const tabs = [
      tab('1', 'https://a.example/', 'w'),
      tab('2', 'https://b.example/', 'r'),
      tab('3', 'https://secret.example/', 'w', { isPrivate: true }),
      tab('4', 'https://c.example/', 't'),
    ]
    const first = saveFolderAsCollections({ folderId: 'w', folders, tabs, bookmarks: [], collections: [], topic: 'Work', now: 'x' })
    expect(first.collections.map((collection) => [collection.label, collection.memberUrls])).toEqual([
      ['Work', ['https://a.example/']],
      ['Work / Reports', ['https://b.example/']],
    ])
    expect(first.bookmarks.map((bookmark) => bookmark.url)).toEqual(['https://a.example/', 'https://b.example/'])
    expect(first.saved).toBe(2)
    const again = saveFolderAsCollections({ folderId: 'w', folders, tabs, bookmarks: first.bookmarks, collections: first.collections, topic: 'Work' })
    expect(again.saved).toBe(0)
    expect(again.collections).toHaveLength(2)
  })
})
