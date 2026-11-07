import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { IpcMainInvokeEvent } from 'electron'
import { browserImportChannels, parseBrowserImportCommand, type ImportCategory, type ImportCount, type ImportPreview, type ImportProfile, type ImportRunResult, type ImportSkip } from '../../shared/browserImport'
import { ArcFormatError, parseArcSidebar, sidebarForProfile, type ArcSpace, type ArcTab, type SidebarNode } from './arcSidebar'
import { parseChromiumBookmarks, type ImportedFolder } from './chromiumBookmarks'
import { HISTORY_IMPORT_LIMIT, countHistory, readHistory, type ImportedVisit } from './chromiumHistory'
import { chromiumKey, countLogins, decryptChromiumPassword, readLogins } from './chromiumLogins'
import { safeStorageSecret, type RunSecurity } from './keychain'
import { folderCounts, libraryDocument, planLogins, planTabs, planWorkspaces, type ExistingWorkspace, type ImportedTab, type LoginRow, type WorkspaceImportPlan } from './plan'
import { detectProfiles, isFile, PROFILE_FILES, publicProfile, type DetectedProfile } from './sources'
import { withDatabaseCopy } from './sqliteCopy'

/**
 * Import from another browser on this Mac (Settings › Import). Everything is read from the
 * browser's own files (databases from a private copy), staged in memory, and only then written:
 * passwords to the sealed vault in one write, history to the sealed history, tabs as unloaded
 * tabs, and bookmarks handed to the shell to merge into the encrypted library. Nothing is sent
 * anywhere, and nothing is ever written to the other browser's folders.
 */

export type ImportTabs = {
  /** Addresses of the tabs open now. */
  urls(): string[]
  /** How many more tabs fit under the limit. */
  room(): number
  limit: number
  /** Open these as unloaded tabs (pinned ones with their address as home). */
  add(tabs: ImportedTab[]): void
}

/** Workspaces, for recreating a sidebar browser's spaces (main/workspaces.ts). */
export type ImportWorkspaces = {
  /** Workspaces here now: their names, the addresses of their tabs, and the room left in each. */
  existing(): ExistingWorkspace[]
  favouriteUrls(): string[]
  /** How many more workspaces can be made. */
  freeWorkspaces(): number
  favouriteRoom(): number
  /** Tabs one workspace may hold, and how deep its folders may nest. */
  tabLimit: number
  maxFolderDepth: number
  /** Make (or add to) the workspaces, folders, tabs and favourites, all at once. */
  apply(plan: WorkspaceImportPlan): void
}

export type ImportHistory = {
  importVisits(entries: ReadonlyArray<ImportedVisit>): { added: number; duplicates: number; excluded: number; old: number }
  readonly policy: { footprints: boolean }
}

export type ImportPasswords = {
  importLogins(rows: ReadonlyArray<LoginRow>): Promise<{ added: number; existing: number; invalid: number }>
}

export type BrowserImportDeps = {
  root(): { root: string; testing: boolean }
  tabs: ImportTabs
  history(): ImportHistory | null
  passwords(): ImportPasswords | null
  toOrigin(url: string): string | null
  workspaces?: ImportWorkspaces
  env?: NodeJS.ProcessEnv
  runSecurity?: RunSecurity
  now?: () => Date
}

const BOOKMARKS_LIMIT = 50_000_000
const SIDEBAR_LIMIT = 100_000_000
const sessionNote = (name: string): string => `${name} keeps open and pinned tabs in session files whose format is not published, so they cannot be read reliably and are left out. Its bookmarks come over.`

type SourceData = {
  bookmarks: ImportedFolder[]
  bookmarksSkipped: number
  bookmarksError: string | null
  /** Arc only (null: not Arc, or its sidebar could not be read). */
  sidebar: { spaces: ArcSpace[]; favourites: ArcTab[] } | null
  sidebarError: string | null
}

export class BrowserImportService {
  private busy = false

  constructor(private readonly deps: BrowserImportDeps) {}

  detect(): ImportProfile[] {
    return detectProfiles(this.deps.root().root).map(publicProfile)
  }

  /** A profile named by id, found again on disk (the shell never names a path). */
  private profile(id: string): DetectedProfile {
    const profile = detectProfiles(this.deps.root().root).find((item) => item.id === id)
    if (!profile) throw new Error('That browser profile is no longer on this Mac.')
    return profile
  }

  /** Bookmarks and (for Arc) the sidebar. Files that cannot be read are reported, never half read. */
  private readSources(profile: DetectedProfile): SourceData {
    const data: SourceData = { bookmarks: [], bookmarksSkipped: 0, bookmarksError: null, sidebar: null, sidebarError: null }
    const bookmarksPath = join(profile.path, PROFILE_FILES.bookmarks)
    if (isFile(bookmarksPath, BOOKMARKS_LIMIT)) {
      try {
        const parsed = parseChromiumBookmarks(readFileSync(bookmarksPath, 'utf8'))
        data.bookmarks = parsed.folders
        data.bookmarksSkipped = parsed.skipped
      } catch {
        data.bookmarksError = `${profile.browserName}'s bookmarks file could not be read.`
      }
    }
    if (profile.source.sidebar) {
      const sidebarPath = join(this.deps.root().root, profile.source.sidebar)
      if (isFile(sidebarPath, SIDEBAR_LIMIT)) {
        try {
          data.sidebar = sidebarForProfile(parseArcSidebar(readFileSync(sidebarPath, 'utf8')), profile.folder)
        } catch (error) {
          data.sidebarError = error instanceof ArcFormatError ? error.message : 'Arc\'s sidebar file could not be read.'
        }
      } else data.sidebarError = 'Arc\'s sidebar file was not found, so its spaces, pinned tabs and folders are left out.'
    }
    return data
  }

  /** Bookmark folders and sidebar folders, as collections. */
  private folders(data: SourceData): ImportedFolder[] {
    return [...data.bookmarks, ...(data.sidebar?.spaces.flatMap((space) => space.folders) ?? [])]
  }

  /** Pinned tabs: Arc favourites and each space's pinned tabs. They are also kept in a collection named after their space. */
  private pinned(data: SourceData): { tabs: ArcTab[]; folders: ImportedFolder[] } {
    if (!data.sidebar) return { tabs: [], folders: [] }
    const folders: ImportedFolder[] = []
    if (data.sidebar.favourites.length) folders.push({ label: 'Imported favourites', pages: data.sidebar.favourites.map((tab) => ({ ...tab, addedAt: null })) })
    for (const space of data.sidebar.spaces) if (space.pinned.length) folders.push({ label: space.title, pages: space.pinned.map((tab) => ({ ...tab, addedAt: null })) })
    return { tabs: [...data.sidebar.favourites, ...data.sidebar.spaces.flatMap((space) => space.pinned)], folders }
  }

  preview(id: string): ImportPreview {
    const profile = this.profile(id)
    const data = this.readSources(profile)
    const folders = this.folders(data)
    const counts = folderCounts(folders)
    const pinned = this.pinned(data)
    const isArc = !!profile.source.sidebar
    const tabNote = isArc ? data.sidebarError ?? undefined : sessionNote(profile.browserName)
    const count = (value: number | null, note?: string): ImportCount => (note ? { count: value, note } : { count: value })
    const database = (file: string, read: (db: DatabaseSync) => number): ImportCount => {
      const path = join(profile.path, file)
      if (!isFile(path)) return count(0)
      try {
        return count(withDatabaseCopy(path, read))
      } catch {
        return count(null, `${profile.browserName}'s ${file === PROFILE_FILES.history ? 'history' : 'passwords'} file could not be read. Quitting ${profile.browserName} and trying again may help.`)
      }
    }
    const history = database(PROFILE_FILES.history, countHistory)
    const passwords = database(PROFILE_FILES.logins, countLogins)
    const bookmarksNote = [data.bookmarksError, isArc && data.sidebarError ? data.sidebarError : null].filter(Boolean).join(' ')
    const spaces = isArc && data.sidebar ? data.sidebar.spaces.map((space) => spaceSummary(space)) : null
    const workspaces: ImportCount = !isArc
      ? count(null, `${profile.browserName} has no sidebar spaces to recreate.`)
      : !spaces
        ? count(null, data.sidebarError ?? undefined)
        : !this.deps.workspaces
          ? count(null, 'Workspaces are not ready yet.')
          : count(spaces.length, `Each space becomes a workspace of the same name (or adds to the one already here), with its pinned tabs, its folders nested as they were, and its open tabs, which load when first shown. Favourites join the favourites row. Intoponet keeps at most ${this.deps.workspaces.tabLimit} tabs in each workspace.`)
    return {
      profileId: profile.id,
      folders: counts.folders,
      ...(spaces ? { spaces, favourites: new Set(data.sidebar!.favourites.map((tab) => tab.url)).size } : {}),
      counts: {
        workspaces,
        bookmarks: count(counts.pages, bookmarksNote || undefined),
        pinned: isArc && data.sidebar ? count(new Set(pinned.tabs.map((tab) => tab.url)).size, `Opened as pinned tabs, and kept in a collection named after their space. Intoponet keeps at most ${this.deps.tabs.limit} tabs open.`) : count(null, tabNote),
        open: isArc && data.sidebar ? count(new Set(data.sidebar.spaces.flatMap((space) => space.open).map((tab) => tab.url)).size, 'Opened unloaded: each page loads when you first show it.') : count(null, tabNote),
        history: history.count !== null && history.count > HISTORY_IMPORT_LIMIT ? { count: history.count, note: `The newest ${HISTORY_IMPORT_LIMIT.toLocaleString('en')} pages come over.` } : history,
        passwords: passwords.count !== null && passwords.count > 0 ? { count: passwords.count, note: `macOS asks first whether Intoponet may use “${profile.source.keychain.service}” from your Keychain. Passwords are kept only in Intoponet's sealed password store on this Mac.` } : passwords,
      },
    }
  }

  async run(id: string, categories: ImportCategory[]): Promise<ImportRunResult> {
    if (this.busy) throw new Error('An import is already running.')
    this.busy = true
    try {
      return await this.stageAndCommit(this.profile(id), new Set(categories))
    } finally {
      this.busy = false
    }
  }

  private async stageAndCommit(profile: DetectedProfile, chosen: Set<ImportCategory>): Promise<ImportRunResult> {
    const skipped: ImportSkip[] = []
    const skip = (category: ImportCategory, count: number, reason: string): void => {
      if (count > 0) skipped.push({ category, count, reason })
    }
    const data = this.readSources(profile)
    const isArc = !!profile.source.sidebar
    const name = profile.browserName

    // ---- Stage: read and work out everything first; any failure here writes nothing. ----------
    const folders: ImportedFolder[] = []
    if (chosen.has('bookmarks')) {
      if (data.bookmarksError) throw new Error(`${data.bookmarksError} Nothing was imported.`)
      folders.push(...this.folders(data))
      skip('bookmarks', data.bookmarksSkipped, 'not web addresses (javascript:, file: or browser pages)')
    }
    const pinned = this.pinned(data)
    // Spaces as workspaces: their tabs go into them (and their folders into tab folders), not into the open workspace.
    const asWorkspaces = chosen.has('workspaces') && isArc
    let workspacePlan: WorkspaceImportPlan | null = null
    if (asWorkspaces) {
      const target = this.deps.workspaces
      if (!data.sidebar) throw new Error(`${data.sidebarError ?? `${name}'s sidebar could not be read.`} Nothing was imported.`)
      if (!target) throw new Error('Workspaces are not ready yet, so nothing was imported.')
      workspacePlan = planWorkspaces({
        spaces: data.sidebar.spaces,
        favourites: data.sidebar.favourites,
        existing: target.existing(),
        existingFavourites: target.favouriteUrls(),
        freeWorkspaces: target.freeWorkspaces(),
        tabLimit: target.tabLimit,
        favouriteRoom: target.favouriteRoom(),
        include: { pinned: chosen.has('pinned'), open: chosen.has('open') },
        maxFolderDepth: target.maxFolderDepth,
      })
    } else if (chosen.has('pinned') && isArc) folders.push(...pinned.folders)

    const wantedPinned = chosen.has('pinned') && !asWorkspaces ? pinned.tabs : []
    const wantedOpen = chosen.has('open') && !asWorkspaces ? data.sidebar?.spaces.flatMap((space) => space.open) ?? [] : []
    const tabs = planTabs(wantedPinned, wantedOpen, this.deps.tabs.urls(), this.deps.tabs.room())

    let visits: ImportedVisit[] = []
    const history = chosen.has('history') ? this.deps.history() : null
    if (chosen.has('history')) {
      if (!history) throw new Error('History is not open yet, so nothing was imported. Try again in a moment.')
      const path = join(profile.path, PROFILE_FILES.history)
      if (isFile(path)) {
        let read: { visits: ImportedVisit[]; total: number }
        try {
          read = withDatabaseCopy(path, (db) => readHistory(db))
        } catch {
          throw new Error(`${name}'s history could not be read, so nothing was imported. Quitting ${name} and trying again may help.`)
        }
        if (history.policy.footprints) {
          visits = read.visits
          skip('history', read.total - read.visits.length, `older than the newest ${HISTORY_IMPORT_LIMIT.toLocaleString('en')} pages`)
        } else skip('history', read.total, 'Footprints are off (Privacy), so history is not kept')
      }
    }

    let logins: LoginRow[] = []
    const vault = chosen.has('passwords') ? this.deps.passwords() : null
    if (chosen.has('passwords')) {
      if (!vault) throw new Error('Saved passwords are not open yet, so nothing was imported.')
      const path = join(profile.path, PROFILE_FILES.logins)
      if (isFile(path)) {
        let encrypted: ReturnType<typeof readLogins>
        try {
          encrypted = withDatabaseCopy(path, (db) => readLogins(db))
        } catch {
          throw new Error(`${name}'s passwords file could not be read, so nothing was imported. Quitting ${name} and trying again may help.`)
        }
        if (encrypted.length) {
          // The Keychain prompt comes now, for this browser only, because Passwords was ticked.
          const secret = await safeStorageSecret(profile.source, this.deps.root().testing, this.deps.env, this.deps.runSecurity)
          if (!secret.ok) skip('passwords', encrypted.length, secret.reason)
          else {
            const key = chromiumKey(secret.secret)
            const rows = encrypted.map((row) => ({ origin: row.origin, username: row.username, password: decryptChromiumPassword(row.encrypted, key) }))
            key.fill(0)
            const plan = planLogins(rows, this.deps.toOrigin)
            logins = plan.add
            skip('passwords', plan.unreadable, 'could not be opened with the key from the Keychain')
            skip('passwords', plan.insecure, 'not for a secure (https) site')
            skip('passwords', plan.empty, 'no password stored (signed in another way)')
          }
        }
      }
    }

    // ---- Commit: the sealed vault first (one write, all or none), then history and tabs. ------
    const added = { pinned: 0, open: 0, history: 0, passwords: 0 }
    if (vault && logins.length) {
      const result = await vault.importLogins(logins)
      added.passwords = result.added
      skip('passwords', result.existing, 'already saved for that site and username')
      skip('passwords', result.invalid, 'too long, or not for a secure site')
    }
    logins = []
    if (history && visits.length) {
      const result = history.importVisits(visits)
      added.history = result.added
      skip('history', result.duplicates, 'already in your history')
      skip('history', result.excluded, 'from sites you left out (Privacy)')
      skip('history', result.old, 'older than your history keeps')
    }
    if (tabs.add.length) this.deps.tabs.add(tabs.add)
    added.pinned = tabs.add.filter((tab) => tab.pinned).length
    added.open = tabs.add.length - added.pinned
    let workspaceNames: string[] | undefined
    if (workspacePlan) {
      // One synchronous step: every workspace, folder, tab and favourite, or (if it throws) none.
      if (workspacePlan.workspaces.length || workspacePlan.favourites.length) this.deps.workspaces!.apply(workspacePlan)
      Object.assign(added, { workspaces: workspacePlan.counts.workspaces, foldered: workspacePlan.counts.foldered, favourites: workspacePlan.counts.favourites })
      added.pinned += workspacePlan.counts.pinned
      added.open += workspacePlan.counts.open
      workspaceNames = workspacePlan.workspaces.map((workspace) => workspace.name)
      skip('workspaces', workspacePlan.skipped.spaces, `spaces over the limit of workspaces (their folders are kept as collections when Bookmarks is ticked)`)
      skip('workspaces', workspacePlan.skipped.duplicates, 'tabs or favourites already there')
      skip('workspaces', workspacePlan.skipped.overLimit, `tabs over the ${this.deps.workspaces!.tabLimit}-tab limit of a workspace`)
    }
    if (tabs.duplicates) skip(chosen.has('pinned') ? 'pinned' : 'open', tabs.duplicates, 'already open')
    skip('pinned', tabs.leftOut.pinned, `over the ${this.deps.tabs.limit}-tab limit (they are in the collection named after their space)`)
    skip('open', tabs.leftOut.open, `over the ${this.deps.tabs.limit}-tab limit`)
    const library = folders.length ? JSON.stringify(libraryDocument(folders, `From ${name}`.slice(0, 80), (this.deps.now ?? (() => new Date()))())) : null
    return { library, added, skipped, ...(workspaceNames ? { workspaceNames } : {}) }
  }
}

/** What one space would bring as a workspace (for the preview). */
function spaceSummary(space: ArcSpace): { name: string; pinned: number; folders: number; foldered: number; open: number } {
  let folders = 0
  let foldered = 0
  const walk = (nodes: readonly SidebarNode[], inFolder: boolean): void => {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        folders += 1
        walk(node.children, true)
      } else if (inFolder) foldered += 1
    }
  }
  walk(space.tree, false)
  return { name: space.title, pinned: space.tree.filter((node) => node.kind === 'tab').length, folders, foldered, open: space.open.length }
}

/** Settings › Import, answered only for the app shell. */
export function wireBrowserImport(handle: (channel: string, handler: (event: IpcMainInvokeEvent, value: unknown) => unknown) => void, service: BrowserImportService): void {
  handle(browserImportChannels.command, (_event, value: unknown) => {
    const command = parseBrowserImportCommand(value)
    switch (command.type) {
      case 'detect': return service.detect()
      case 'preview': return service.preview(command.profileId)
      case 'run': return service.run(command.profileId, command.categories)
    }
  })
}
