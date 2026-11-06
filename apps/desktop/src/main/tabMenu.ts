import type { MenuItemConstructorOptions } from 'electron'
import { otherTabIds, tabIdsToRight, type OrderedTab } from './tabOrder'

/** What the tab context menu can do. Each action is carried out by the main process (see index.ts). */
export type TabMenuAction =
  | 'reload'
  | 'duplicate'
  | 'pin'
  | 'unpin'
  | 'mute'
  | 'unmute'
  | 'copy-link'
  | 'go-home'
  | 'close'
  | 'close-others'
  | 'close-right'

export type TabMenuTab = OrderedTab & {
  url: string
  isStartPage?: boolean
  muted?: boolean
  awayFromHome?: boolean
}

type Entry = { action: TabMenuAction; label: string; enabled: boolean } | { separator: true }

/** The menu for one tab, in order, with separators between groups. */
export function tabMenuEntries(tabs: readonly TabMenuTab[], id: string): Entry[] {
  const tab = tabs.find((item) => item.id === id)
  if (!tab) return []
  const hasPage = !tab.isStartPage && /^https?:\/\//i.test(tab.url)
  return [
    { action: 'reload', label: 'Reload', enabled: hasPage },
    { action: 'duplicate', label: 'Duplicate', enabled: hasPage },
    tab.pinned
      ? { action: 'unpin', label: 'Unpin Tab', enabled: true }
      : { action: 'pin', label: 'Pin Tab', enabled: true },
    tab.muted
      ? { action: 'unmute', label: 'Unmute Site', enabled: true }
      : { action: 'mute', label: 'Mute Site', enabled: hasPage },
    { separator: true },
    { action: 'copy-link', label: 'Copy Link', enabled: hasPage },
    ...(tab.pinned ? [{ action: 'go-home' as const, label: 'Go to Pinned Page', enabled: tab.awayFromHome === true }] : []),
    { separator: true },
    // A pinned tab's close button only unloads it; this removes it.
    { action: 'close', label: tab.pinned ? 'Close Pinned Tab' : 'Close Tab', enabled: true },
    { action: 'close-others', label: 'Close Other Tabs', enabled: otherTabIds(tabs, id).length > 0 },
    { action: 'close-right', label: 'Close Tabs to the Right', enabled: tabIdsToRight(tabs, id).length > 0 },
  ]
}

/** Folders for the "Move to Folder" submenu (indented by depth), and what choosing one does. */
export type TabMenuFolders = {
  folders: ReadonlyArray<{ id: string; name: string; depth: number }>
  current: string | null
  move: (folderId: string | null) => void
  createFolder: () => void
}

/** "Move to Folder": every folder, a new one, and out of folders. Pinned tabs have none. */
export function folderSubmenu(choices: TabMenuFolders): MenuItemConstructorOptions[] {
  return [
    ...choices.folders.map((folder): MenuItemConstructorOptions => ({
      label: `${'    '.repeat(Math.max(0, folder.depth - 1))}${folder.name}`,
      type: 'checkbox',
      checked: folder.id === choices.current,
      click: () => choices.move(folder.id),
    })),
    ...(choices.folders.length ? [{ type: 'separator' as const }] : []),
    { label: 'New Folder', click: choices.createFolder },
    ...(choices.current ? [{ label: 'Remove from Folder', click: () => choices.move(null) }] : []),
  ]
}

/** The native menu template; `run` performs an action for this tab. */
export function tabMenuTemplate(
  tabs: readonly TabMenuTab[],
  id: string,
  run: (action: TabMenuAction, id: string) => void,
  folders?: TabMenuFolders,
): MenuItemConstructorOptions[] {
  const items = tabMenuEntries(tabs, id).map((entry): MenuItemConstructorOptions =>
    'separator' in entry
      ? { type: 'separator' as const }
      : { label: entry.label, enabled: entry.enabled, click: () => run(entry.action, id) },
  )
  const tab = tabs.find((item) => item.id === id)
  if (!folders || !tab || tab.pinned) return items
  // After Pin/Unpin.
  const at = items.findIndex((item) => item.label === 'Pin Tab') + 1
  items.splice(at > 0 ? at : 3, 0, { label: 'Move to Folder', submenu: folderSubmenu(folders) })
  return items
}
