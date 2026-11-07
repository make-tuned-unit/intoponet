import type { PageTabSnapshot, TabFolderSnapshot, TabGroupRequest } from '@intoponet/browser-api'
import type { StoryMatch } from '../../shared/news/storyTabs'

/**
 * Group by story: the loose matched tabs of each story go into one folder for it. A story with
 * a folder already gets its loose matched tabs (even one); otherwise it needs two or more.
 * Pinned, foldered and private tabs are never grouped.
 */
export function storyGroupRequests(tabs: readonly PageTabSnapshot[], matches: ReadonlyMap<string, StoryMatch>, folders: readonly TabFolderSnapshot[]): TabGroupRequest[] {
  const byStory = new Map<string, { label: string; tabIds: string[] }>()
  for (const tab of tabs) {
    const match = matches.get(tab.id)
    if (!match || tab.pinned || tab.folderId || tab.isPrivate) continue
    const entry = byStory.get(match.storyId) ?? { label: match.label, tabIds: [] }
    entry.tabIds.push(tab.id)
    byStory.set(match.storyId, entry)
  }
  const groups: TabGroupRequest[] = []
  for (const [storyId, { label, tabIds }] of byStory) {
    const hasFolder = folders.some((folder) => folder.storyId === storyId)
    if (!hasFolder && tabIds.length < 2) continue
    groups.push({ name: label, tabIds, storyId })
  }
  return groups
}
