import { randomUUID } from 'node:crypto'
import type { ImportedFolder } from './chromiumBookmarks'

/**
 * Staging: everything an import will write is worked out here first, from what was read and
 * what Intoponet already has. Nothing in this file writes anything.
 */

export type ImportedTab = { url: string; title: string; pinned: boolean }

/** The address as Intoponet compares tabs (parsed and written back the same way). */
export function sameAddress(url: string): string {
  try {
    return new URL(url).toString()
  } catch {
    return url
  }
}

/**
 * Tabs to open: pinned first, then open ones, each address once and none already open, within
 * the room left under the tab limit. Existing tabs are never closed to make room.
 */
export function planTabs(pinned: Array<{ url: string; title: string }>, open: Array<{ url: string; title: string }>, existing: readonly string[], room: number): { add: ImportedTab[]; duplicates: number; leftOut: { pinned: number; open: number } } {
  const seen = new Set(existing.map(sameAddress))
  const add: ImportedTab[] = []
  let duplicates = 0
  const leftOut = { pinned: 0, open: 0 }
  const take = (tabs: Array<{ url: string; title: string }>, isPinned: boolean): void => {
    for (const tab of tabs) {
      const key = sameAddress(tab.url)
      if (seen.has(key)) {
        duplicates += 1
        continue
      }
      seen.add(key)
      if (add.length >= Math.max(0, room)) {
        leftOut[isPinned ? 'pinned' : 'open'] += 1
        continue
      }
      add.push({ url: key, title: tab.title.slice(0, 180), pinned: isPinned })
    }
  }
  take(pinned, true)
  take(open, false)
  return { add, duplicates, leftOut }
}

export type LibraryBookmark = { url: string; title: string; topic: string; savedAt: string }
export type LibraryCollection = { id: string; label: string; createdAt: string; memberUrls: string[] }
export type LibraryDocument = { schema: 'intoponet.private-library.v1'; bookmarks: LibraryBookmark[]; collections: LibraryCollection[]; recents: []; absorbed: [] }

/**
 * A private-library document (the same shape an exported library has) that the shell merges
 * into the open library: pages match by address, collections by name, so importing again adds
 * nothing. Folders with the same name become one collection; each address is listed once in it.
 */
export function libraryDocument(folders: ImportedFolder[], topic: string, now: Date): LibraryDocument {
  const stamp = now.toISOString()
  const bookmarks = new Map<string, LibraryBookmark>()
  const collections = new Map<string, LibraryCollection>()
  for (const folder of folders) {
    const label = folder.label.trim().slice(0, 80)
    if (!label) continue
    const key = label.toLowerCase()
    let collection = collections.get(key)
    if (!collection) {
      collection = { id: randomUUID(), label, createdAt: stamp, memberUrls: [] }
      collections.set(key, collection)
    }
    for (const page of folder.pages) {
      if (!bookmarks.has(page.url)) bookmarks.set(page.url, { url: page.url, title: page.title || page.url.slice(0, 180), topic: topic.slice(0, 80), savedAt: page.addedAt ?? stamp })
      if (!collection.memberUrls.includes(page.url)) collection.memberUrls.push(page.url)
    }
  }
  return { schema: 'intoponet.private-library.v1', bookmarks: [...bookmarks.values()], collections: [...collections.values()].filter((collection) => collection.memberUrls.length > 0), recents: [], absorbed: [] }
}

/** Pages and folders a set of folders holds (for the preview). */
export function folderCounts(folders: ImportedFolder[]): { pages: number; folders: number } {
  const urls = new Set(folders.flatMap((folder) => folder.pages.map((page) => page.url)))
  const labels = new Set(folders.map((folder) => folder.label.toLowerCase()))
  return { pages: urls.size, folders: labels.size }
}

export type LoginRow = { origin: string; username: string; password: string }

/**
 * Sign-ins to hand to the vault: secure sites only (the vault's own rule), each site and
 * username once. Rows without a password (sign in with another account) are left out.
 */
export function planLogins(rows: Array<{ origin: string; username: string; password: string | null }>, toOrigin: (url: string) => string | null): { add: LoginRow[]; insecure: number; unreadable: number; empty: number } {
  const add: LoginRow[] = []
  const seen = new Set<string>()
  let insecure = 0
  let unreadable = 0
  let empty = 0
  for (const row of rows) {
    if (row.password === null) {
      unreadable += 1
      continue
    }
    if (!row.password) {
      empty += 1
      continue
    }
    const origin = toOrigin(row.origin)
    if (!origin) {
      insecure += 1
      continue
    }
    const key = `${origin}\n${row.username}`
    if (seen.has(key)) continue
    seen.add(key)
    add.push({ origin, username: row.username, password: row.password })
  }
  return { add, insecure, unreadable, empty }
}
