import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reopenPlace } from './closedTabs'
import { TabArchive } from './tabArchive'
import { repairSplits, type TabSplit } from './splitPages'
import { sweepLeftoverIdentities } from './workspaceIdentity'
import { groupSavedFolders, parseSavedWorkspaces } from './workspaces'

/**
 * Upgrading from 0.1.22 (and going back). The fixture is browser-state.v1.json as 0.1.22 wrote it
 * (addresses replaced): Main; Work with its own sign-ins; Lisbon, anchored; folders (one nested and
 * folded, one a story's), pinned tabs, a pair side by side, favourites. Gone, a workspace with its own
 * sign-ins, had been deleted just before 0.1.22 stopped (a crash in its Undo window), so its partition,
 * permission answers and saved login were still on disk.
 */
const state = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'browser-state-0.1.22.json'), 'utf8')) as Record<string, unknown> & { tabs: Array<{ id: string; split?: TabSplit }> }
const WORK = '68fd42e6-5a53-4f8b-8070-826090ebc499'
const LISBON = 'a22e17c6-a0fe-480e-9ab8-ad5996d7147b'
const GONE = 'b4d33d76-80eb-45bc-a094-b2d76d60af6e'

describe('a profile 0.1.22 saved', () => {
  it('reads every workspace, with its own sign-ins, its place and the favourites, so the leftover sweep may run', () => {
    const saved = parseSavedWorkspaces(state)
    expect(saved.complete).toBe(true)
    expect(saved.migrated).toBe(false)
    expect(saved.activeId).toBe('main')
    expect(saved.workspaces.map((workspace) => [workspace.name, workspace.separateSignIns ?? false, workspace.anchor?.label ?? null])).toEqual([['Main', false, null], ['Work', true, null], ['Lisbon', false, 'Lisbon']])
    expect(saved.favourites.map((favourite) => favourite.workspaceId)).toEqual([null, 'main'])
    const folders = groupSavedFolders(state['folders'], saved.workspaces)
    expect([...folders].map(([id, group]) => [id, group.length])).toEqual([['main', 4], [WORK, 1], [LISBON, 1]])
    // The pair comes back whole.
    const main = state.tabs.filter((tab) => (tab as { workspaceId?: string }).workspaceId === 'main').map((tab) => ({ ...tab }))
    expect(repairSplits(main).filter((tab) => tab.split).map((tab) => [tab.split!.side, tab.split!.ratio])).toEqual([['left', 0.4], ['right', 0.4]])
  })

  it("removes only what the deleted workspace left: Work's sign-ins and the shared ones stay", async () => {
    const saved = parseSavedWorkspaces(state)
    const forgotten: string[] = []
    const removed = await sweepLeftoverIdentities(saved.complete, {
      workspaces: () => saved.workspaces,
      partitionInUse: () => false,
      // What 0.1.22 left in the profile (Partitions/ and the profile folder itself).
      partitionFolders: () => ['intoponet-default', `intoponet-ws-${WORK}`, `intoponet-ws-${GONE}`],
      profileFiles: () => ['browser-state.v1.json', 'link-routes.json', 'passwords.v1.seal', 'site-permissions.json', `site-permissions.ws-${WORK}.json`, `site-permissions.ws-${GONE}.json`, 'site-tweaks.json', 'site-zoom.json'],
      loginWorkspaceIds: async () => [WORK, GONE],
      forget: async (id) => { forgotten.push(id) },
    })
    expect(removed).toEqual([GONE])
    expect(forgotten).toEqual([GONE])
  })

  it('reopens a tab it archived (no workspace or folder recorded) in the workspace shown, outside any folder', () => {
    const archive = new TabArchive(() => 2_000_000)
    const payload = { schema: 'intoponet.tab-archive.v1', entries: [{ id: 'old-y', url: 'https://pages.example/p/old-y', title: 'Page /p/old-y', favicon: '', archivedAt: 1_000_000 }] }
    expect(archive.load(JSON.stringify(payload))).toBe(true)
    const entry = archive.take('old-y')!
    expect(entry).not.toHaveProperty('workspaceId')
    expect(entry).not.toHaveProperty('folderId')
    expect(reopenPlace(entry, LISBON, () => [{ id: 'old-folder' }])).toEqual({ workspaceId: LISBON })
  })

  it('can read the archived tabs this version writes: the same schema and fields, the place only added', () => {
    const archive = new TabArchive(() => 2_000_000)
    archive.add({ url: 'https://pages.example/p/warch2', title: 'Page /p/warch2', favicon: '', workspaceId: WORK, folderId: 'clients', history: { entries: [{ url: 'https://pages.example/p/warch1', title: 'Page /p/warch1' }, { url: 'https://pages.example/p/warch2', title: 'Page /p/warch2' }], index: 1 } })
    const raw = JSON.parse(archive.serialize()) as { schema: string; entries: Array<Record<string, unknown>> }
    // What 0.1.22's TabArchive.load requires of each entry; anything else it ignores.
    expect(raw.schema).toBe('intoponet.tab-archive.v1')
    for (const entry of raw.entries) {
      expect(typeof entry['id'] === 'string' && (entry['id'] as string).length <= 80).toBe(true)
      expect(new URL(entry['url'] as string).protocol).toBe('https:')
      expect(typeof entry['title']).toBe('string')
      expect(typeof entry['favicon']).toBe('string')
      expect(Number.isFinite(entry['archivedAt'])).toBe(true)
    }
    expect(raw.entries[0]).toMatchObject({ workspaceId: WORK, folderId: 'clients' })
  })
})
