import type { PageTabSnapshot, TabFolderSnapshot } from '@intoponet/browser-api'
import { createCollection, type SavedBookmark, type SavedCollection } from './localLibrary'

/**
 * Tab sidebar folders and the library: a folder saved as a collection becomes one private
 * collection per folder (a folder inside another is named "Work / Reports"), with each of its web
 * pages bookmarked; saving again adds only what is new. Private tabs are never saved.
 */

/** Folder ids depth first (the sidebar's order). */
export function folderTree(folders: readonly TabFolderSnapshot[]): Array<{ folder: TabFolderSnapshot; depth: number }> {
  const out: Array<{ folder: TabFolderSnapshot; depth: number }> = []
  const visit = (parent: string | null, depth: number): void => {
    for (const folder of folders) {
      if (folder.parentId !== parent || out.some((entry) => entry.folder.id === folder.id)) continue
      out.push({ folder, depth })
      visit(folder.id, depth + 1)
    }
  }
  visit(null, 1)
  return out
}

export function folderPath(folders: readonly TabFolderSnapshot[], id: string): string {
  const names: string[] = []
  let current = folders.find((folder) => folder.id === id)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    current = current.parentId ? folders.find((folder) => folder.id === current!.parentId) : undefined
  }
  return names.join(' / ')
}

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

export function saveFolderAsCollections(input: {
  folderId: string
  folders: readonly TabFolderSnapshot[]
  tabs: readonly PageTabSnapshot[]
  bookmarks: readonly SavedBookmark[]
  collections: readonly SavedCollection[]
  topic: string
  now?: string
}): { bookmarks: SavedBookmark[]; collections: SavedCollection[]; saved: number } {
  const ids = [input.folderId, ...folderTree(input.folders).filter(({ folder }) => {
    let parent = folder.parentId
    while (parent) {
      if (parent === input.folderId) return true
      parent = input.folders.find((item) => item.id === parent)?.parentId ?? null
    }
    return false
  }).map(({ folder }) => folder.id)]
  const now = input.now ?? new Date().toISOString()
  const bookmarks = [...input.bookmarks]
  let collections = [...input.collections]
  let saved = 0
  for (const id of ids) {
    const pages = input.tabs.filter((tab) => tab.folderId === id && !tab.isPrivate && !tab.isStartPage && isWeb(tab.url))
    const label = folderPath(input.folders, id)
    let collection = collections.find((item) => item.label === label)
    if (!collection) {
      collection = createCollection(label)
      collections = [...collections, collection]
    }
    const members = new Set(collection.memberUrls)
    for (const tab of pages) {
      if (!bookmarks.some((bookmark) => bookmark.url === tab.url)) bookmarks.push({ url: tab.url, title: tab.title || tab.url, topic: input.topic, savedAt: now })
      if (!members.has(tab.url)) {
        members.add(tab.url)
        saved += 1
      }
    }
    const updated = { ...collection, memberUrls: [...members] }
    collections = collections.map((item) => (item.id === collection!.id ? updated : item))
  }
  return { bookmarks, collections, saved }
}
