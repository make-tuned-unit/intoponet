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

/** The native menu template; `run` performs an action for this tab. */
export function tabMenuTemplate(
  tabs: readonly TabMenuTab[],
  id: string,
  run: (action: TabMenuAction, id: string) => void,
): MenuItemConstructorOptions[] {
  return tabMenuEntries(tabs, id).map((entry) =>
    'separator' in entry
      ? { type: 'separator' as const }
      : { label: entry.label, enabled: entry.enabled, click: () => run(entry.action, id) },
  )
}
