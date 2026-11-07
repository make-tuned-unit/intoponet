export type BrowserPanelBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserPanelSnapshot = {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  isVisible: boolean
  /** The page is in a private tab: nothing about it is recorded. */
  isPrivate?: boolean
  /** The active tab is a new tab that has not loaded a page yet: the shell draws its start page. */
  isStartPage?: boolean
  /** The page's zoom (1 = 100%); the toolbar shows it when it is not 100%. */
  zoomFactor?: number
  /** The page could not load: the shell draws the error page in its place (the view stays hidden). */
  loadError?: import('./browsing').PageLoadError
}

/** A recently closed tab that can be reopened (private tabs are never kept). */
export type ClosedTabSnapshot = {
  id: string
  url: string
  title: string
  favicon: string
}

export type NavigationIntent =
  | { kind: 'url'; value: string }
  | { kind: 'search'; value: string }
  | { kind: 'topic'; value: string }

const looksLikeWebAddress =
  /^(https?:\/\/)?(localhost|(\d{1,3}\.){3}\d{1,3}|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d{1,5})?([/?#].*)?$/i

export function inferLauncherIntent(
  value: string,
  preferred: NavigationIntent['kind'],
): NavigationIntent {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 8_192) {
    throw new Error('Invalid navigation value.')
  }
  if (!/\s/.test(trimmed) && looksLikeWebAddress.test(trimmed)) {
    return { kind: 'url', value: trimmed }
  }
  return { kind: preferred, value: trimmed }
}

export function resolveNavigationIntent(intent: NavigationIntent): string {
  const value = intent.value.trim()
  if (intent.kind === 'search') {
    return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
  }
  if (intent.kind === 'topic') {
    return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(value)}`
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only HTTP and HTTPS destinations are supported.')
  }
  return url.toString()
}

export type FindInPageResult = {
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

export type DownloadFinishedEvent = {
  filename: string
  path: string
  state: 'completed' | 'cancelled' | 'interrupted'
}

export type PageTabSnapshot = {
  id: string
  url: string
  title: string
  favicon: string
  active: boolean
  isPrivate?: boolean
  /** A new tab still showing the start page. */
  isStartPage?: boolean
  /** The page is loading (the tab shows a spinner in place of its icon). */
  loading?: boolean
  /** The page is playing sound right now. */
  audible?: boolean
  /** The tab's sound is muted. */
  muted?: boolean
  /** Pinned tabs sit first, show only their icon and survive "Close Other Tabs". */
  pinned?: boolean
  /** A pinned tab's home: the address it was pinned at. */
  home?: string
  /** A pinned tab now on another site than its home (it offers a way back). */
  awayFromHome?: boolean
  /** The page is unloaded to save memory; it loads again (where it was) when shown. */
  asleep?: boolean
  /** When the tab was last shown or left (ms since 1970; this session only, never saved). */
  lastShownAt?: number
  /** The sidebar folder it is in. */
  folderId?: string
}

/** A folder in the tab sidebar (folders nest through parentId). */
export type TabFolderSnapshot = { id: string; name: string; parentId: string | null; collapsed?: boolean }

/** The tab sidebar: icons (expands on hover), kept open (also in full width), or hidden (the left edge brings it back). */
export const TAB_SIDEBAR_MODES = ['icons', 'open', 'hidden'] as const
export type TabSidebarMode = (typeof TAB_SIDEBAR_MODES)[number]
export type TabSidebarState = { mode: TabSidebarMode; width: number }
export const TAB_SIDEBAR_WIDTH = { min: 180, max: 420, initial: 240 } as const

/** A tab that tidied itself away (Archived tabs): reopened with its back/forward list. */
export type ArchivedTabSnapshot = { id: string; url: string; title: string; favicon: string; archivedAt: number }

export type NetworkPrivacySnapshot = {
  /** DNS-over-HTTPS configured for all lookups. */
  encryptedDns: boolean
  dnsProviders: string
  /** WebRTC cannot reveal local/private IP addresses. */
  webrtcLocalIpHidden: boolean
  /** Reserved for a future tunnel; nothing routes through a VPN today. */
  vpn: 'not-configured'
}

export type ProtectionSnapshot = {
  origin: string
  enabled: boolean
  blockedAds: number
  blockedTrackers: number
  adsEnabled: boolean
  trackersEnabled: boolean
  network?: NetworkPrivacySnapshot
}

export type PrivateLibraryReadResult =
  | { status: 'ok'; payload: string | null }
  | {
      status: 'error'
      reason: 'encryption-unavailable' | 'decrypt-failed' | 'reencrypt-failed'
    }

/** Export as PDF: what a plain click does (the options popover changes it). */
export type PdfExportOptions = {
  /** auto: Formatted when the page reads as an article, else As seen. */
  mode: 'auto' | 'formatted' | 'asSeen'
  paper: 'auto' | 'a4' | 'letter'
  textSize: 'small' | 'medium' | 'large'
  images: boolean
  /** The source block on page one (title, author, site, dates, address) and the footer title. */
  citation: boolean
  /** Bookmark group the page is filed in, with a link to the PDF ('' = none, 'unsorted' = no group). */
  groupId: string
}

export const DEFAULT_PDF_EXPORT_OPTIONS: PdfExportOptions = {
  mode: 'auto',
  paper: 'auto',
  textSize: 'medium',
  images: true,
  citation: true,
  groupId: '',
}

/** Anything unknown or malformed falls back to the default, field by field. */
export function parsePdfExportOptions(value: unknown): PdfExportOptions {
  const input = isRecord(value) ? value : {}
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T =>
    allowed.includes(input[key] as T) ? (input[key] as T) : fallback
  const groupId = typeof input['groupId'] === 'string' && /^[\w-]{0,80}$/.test(input['groupId']) ? input['groupId'] : ''
  return {
    mode: pick('mode', ['auto', 'formatted', 'asSeen'] as const, DEFAULT_PDF_EXPORT_OPTIONS.mode),
    paper: pick('paper', ['auto', 'a4', 'letter'] as const, DEFAULT_PDF_EXPORT_OPTIONS.paper),
    textSize: pick('textSize', ['small', 'medium', 'large'] as const, DEFAULT_PDF_EXPORT_OPTIONS.textSize),
    images: typeof input['images'] === 'boolean' ? input['images'] : DEFAULT_PDF_EXPORT_OPTIONS.images,
    citation: typeof input['citation'] === 'boolean' ? input['citation'] : DEFAULT_PDF_EXPORT_OPTIONS.citation,
    groupId,
  }
}

export type PdfExportEvent =
  | { state: 'working'; step: 'preparing' | 'printing' | 'finishing' }
  | {
      state: 'saved'
      filename: string
      path: string
      pages: number | null
      bytes: number
      mode: 'formatted' | 'asSeen'
      /** Why Formatted was not used when Auto was asked for ('' when it was). */
      fellBack: string
      missingImages: number
      ads: number
      url: string
      title: string
      groupId: string
      isPrivate: boolean
    }
  | { state: 'failed'; reason: string }
  | { state: 'cancelled' }

/** A PDF saved with Export as PDF (not from private tabs), listed under Bookmarks › PDFs. */
export type SavedPdfRecord = {
  id: string
  path: string
  filename: string
  title: string
  url: string
  savedAt: string
  pages: number | null
  bytes: number
  mode: 'formatted' | 'asSeen'
}

export type BrowserHostEvent =
  | { type: 'frequency-visit'; url: string; title: string; rating: string | null; navigationId: string }
  | { type: 'panel-state'; panel: BrowserPanelSnapshot }
  | { type: 'navigation-failed'; url: string; reason: string }
  | ({ type: 'find-result' } & FindInPageResult)
  | ({ type: 'download-finished' } & DownloadFinishedEvent)
  | { type: 'pdf-export'; event: PdfExportEvent }
  | { type: 'protection-state'; protection: ProtectionSnapshot }
  | { type: 'tabs'; tabs: PageTabSnapshot[] }
  | { type: 'tab-dock-state'; open: boolean }
  /** Full-screen toolbar auto-hide: the pointer moved into the page. */
  | { type: 'chrome-state'; revealed: boolean }
  /** The pointer moved into the page while the tab rail was expanded. */
  | { type: 'tab-rail-state'; expanded: boolean }
  /** Shell shortcuts pressed while the native page view had keyboard focus. */
  | { type: 'shortcut'; action: ShellShortcut }
  | { type: 'field-snapshot'; payload: string }
  | { type: 'public-field-status'; status: PublicFieldStatus }
  /** Validated per-country local news digest (JSON). */
  | { type: 'news-digest'; payload: string }
  /** "Paste and Go" chosen in the address bar's menu: the clipboard text, read in main. */
  | { type: 'paste-and-go'; text: string }
  /** The open page's address was copied (`cleaned`: tracking parameters were removed). */
  | { type: 'address-copied'; cleaned: boolean }
  /** The recent-tabs switcher opened, moved (selected: the highlighted tab's title) or closed. */
  /** Full width, sidebar hidden: the pointer rested at the window's left edge (over the page). */
  | { type: 'tab-sidebar-edge' }
  /** Tabs closed into Archived tabs just now (Undo reopens them), or the archive changed. */
  | { type: 'tabs-archived'; ids: string[]; titles: string[] }
  | { type: 'archived-tabs-changed' }
  /** The sidebar's folders changed (`rename`: a folder just made from the tab menu, to name now). */
  | { type: 'tab-folders'; folders: TabFolderSnapshot[]; rename?: string }
  | { type: 'tab-switcher'; open: boolean; selected?: string; position?: number; count?: number }

export type ShellShortcut = 'new-tab' | 'find' | 'find-next' | 'find-previous' | 'open-settings' | 'bookmark' | 'next-tab' | 'previous-tab' | 'focus-launcher' | 'toggle-bookmarks' | 'capture' | 'toggle-private' | 'absorb-selection' | 'toggle-tab-sidebar' | 'command-menu'

export type PublicFieldStatus = {
  mode: 'local' | 'shared'
  sourceLabel: string
  configuredOrigin: string | null
  state: 'fetching' | 'current' | 'stale' | 'error'
  evaluationTime: string | null
  message: string
  /** Present only for independently collected local sources; RSS is reported separately. */
  sourceHealth?: Record<LocalPublicSource, PublicSourceHealth>
}

export type LocalPublicSource = 'reading' | 'usgs' | 'eonet'
export type PublicSourceHealth = {
  state: 'current' | 'cached' | 'not-due' | 'failed' | 'unavailable'
  /** Latest request attempt, including failures; null when status was reconstructed from cache. */
  lastCheckedAt: string | null
  /** Latest record retrieval timestamp, distinct from the aggregate snapshot time. */
  latestRecordRetrievedAt: string | null
  /** Latest source window end or record publication time when available. */
  latestObservationAt: string | null
  recordCount: number
}

export interface BrowserHostApi {
  open(intent: NavigationIntent, disposition?: OpenDisposition): Promise<void>
  /** Open a new tab on the start page and switch to it. */
  newTab(): Promise<void>
  close(): Promise<void>
  restore(): Promise<void>
  navigate(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  stop(): Promise<void>
  find(query: string, options?: { findNext?: boolean; forward?: boolean }): Promise<void>
  stopFind(): Promise<void>
  print(): Promise<void>
  zoom(action: 'in' | 'out' | 'reset'): Promise<void>
  setBounds(bounds: BrowserPanelBounds): Promise<void>
  setFullWidth(enabled: boolean): Promise<void>
  /** Hide the page view while the shell animates over it; false shows it again. */
  holdPage(held: boolean): Promise<void>
  /** `hold` keeps the dock open while the pointer crosses the page (e.g. typing in its search). */
  setTabDockOpen(open: boolean, hold?: boolean): Promise<void>
  /** Full-screen toolbar reveal; `hold` keeps it while a control has focus. */
  setChromeRevealed(revealed: boolean, hold?: boolean): Promise<void>
  /** Expanded (unpinned) tab rail collapses when the pointer enters the page. */
  setTabRailExpanded(expanded: boolean): Promise<void>
  /** The saved tab sidebar mode and width (null when never set). */
  getTabSidebar(): Promise<TabSidebarState | null>
  getArchivedTabs(): Promise<ArchivedTabSnapshot[]>
  /** Runs a menu-bar command by id (see APP_SHORTCUTS in main/appMenu.ts). */
  runMenuCommand(id: string): Promise<void>
  getTabFolders(): Promise<TabFolderSnapshot[]>
  createTabFolder(name: string, parentId?: string | null, tabIds?: string[]): Promise<TabFolderSnapshot>
  updateTabFolder(id: string, changes: { name?: string; collapsed?: boolean; parentId?: string | null }): Promise<void>
  deleteTabFolder(id: string): Promise<void>
  moveTabToFolder(tabId: string, folderId: string | null): Promise<void>
  openTabFolder(name: string, urls: string[]): Promise<void>
  reopenArchivedTabs(ids: string[]): Promise<void>
  setTabSidebar(sidebar: TabSidebarState): Promise<void>
  getState(): Promise<BrowserPanelSnapshot>
  getProtection(): Promise<ProtectionSnapshot>
  setSiteProtection(enabled: boolean): Promise<void>
  setProtectionCategories(categories: { ads: boolean; trackers: boolean }): Promise<void>
  getTabs(): Promise<PageTabSnapshot[]>
  activateTab(id: string): Promise<void>
  closeTab(id: string): Promise<void>
  cycleTabs(direction: 'next' | 'previous'): Promise<void>
  /** Move a tab to a new position in the tab order (pinned tabs stay ahead of the others). */
  moveTab(id: string, toIndex: number): Promise<void>
  setTabPinned(id: string, pinned: boolean): Promise<void>
  setTabMuted(id: string, muted: boolean): Promise<void>
  /** The tab's context menu (a native menu), at a point in the window or at the pointer. */
  showTabMenu(id: string, at?: { x: number; y: number }): Promise<void>
  /** Close the tab being shown (⌘W) and show the next one, or the globe when none are left. */
  closeActiveTab(): Promise<void>
  /** Reopen the most recently closed tab, or the one with this id (⌘⇧T). */
  reopenClosedTab(id?: string): Promise<void>
  /** Recently closed tabs, newest first (this session only). */
  getClosedTabs(): Promise<ClosedTabSnapshot[]>
  /** Show tab number `index` (0-based); -1 is the last tab. */
  selectTab(index: number): Promise<void>
  /** Copies the open page's address (tracking parameters removed unless `clean` is false). */
  copyPageAddress(clean?: boolean): Promise<void>
  /** Takes a pinned tab back to the address it was pinned at. */
  goTabHome(id: string): Promise<void>
  /** Ends the recent-tabs switcher: show the highlighted tab, or keep the current one. */
  tabSwitcher(action: 'commit' | 'cancel'): Promise<void>
  /** Open a web address in a card over the page or the globe (link preview), in the current browsing mode. */
  previewLink(url: string): Promise<void>
  /** Reload, ignoring cached files. */
  forceReload(): Promise<void>
  /** Save the page as HTML with its files (asks where, in Downloads). */
  savePage(): Promise<void>
  /** Save the page as a PDF now (progress and the result arrive as 'pdf-export' events). */
  exportPdf(options?: PdfExportOptions): Promise<void>
  cancelPdfExport(): Promise<void>
  getPdfSettings(): Promise<PdfExportOptions>
  setPdfSettings(options: PdfExportOptions): Promise<void>
  openSavedFile(path: string, reveal: boolean): Promise<void>
  listSavedPdfs(): Promise<SavedPdfRecord[]>
  forgetSavedPdf(id: string): Promise<void>
  readPrivateLibrary(): Promise<PrivateLibraryReadResult>
  writePrivateLibrary(payload: string): Promise<void>
  deletePrivateLibrary(): Promise<void>
  getFieldSnapshot(): Promise<string | null>
  getPublicFieldStatus(): Promise<PublicFieldStatus>
  getNewsDigest(): Promise<string | null>
  /** What is rising and fading in one place's news (JSON), or null before the first digest. */
  getPlaceTrends(place: { countryCode: string; name?: string; aliases?: string[]; geonameId?: string }): Promise<string | null>
  /** The address bar's context menu (Cut, Copy, Paste, Paste and Go, Select All). */
  showAddressMenu(hasSelection: boolean): Promise<void>
  subscribe(listener: (event: BrowserHostEvent) => void): () => void
}

export const browserHostChannels = {
  command: 'browser-host:command',
  event: 'browser-host:event',
} as const

/** Where the address bar opens a result: ⌘↵ a background tab, ⌥↵ a new foreground tab. */
export type OpenDisposition = 'background-tab' | 'foreground-tab'

export type BrowserHostCommand =
  /** `disposition`: open in a new tab — in the background, or brought to front even from a start page. */
  | { type: 'open'; intent: NavigationIntent; disposition?: OpenDisposition }
  | { type: 'new-tab' }
  | { type: 'close' }
  | { type: 'restore' }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'stop' }
  | { type: 'find'; query: string; findNext: boolean; forward: boolean }
  | { type: 'stop-find' }
  | { type: 'print' }
  | { type: 'zoom'; action: 'in' | 'out' | 'reset' }
  | { type: 'set-bounds'; bounds: BrowserPanelBounds }
  | { type: 'set-full-width'; enabled: boolean }
  /** Keep the page view hidden (true) while the shell draws over it, e.g. the sources carousel; false shows it again. */
  | { type: 'hold-page'; held: boolean }
  | { type: 'set-tab-dock-open'; open: boolean; hold?: boolean }
  | { type: 'set-chrome-revealed'; revealed: boolean; hold?: boolean }
  | { type: 'set-tab-rail-expanded'; expanded: boolean }
  /** The tab sidebar's mode and width, kept with the open tabs (null until first set). */
  | { type: 'get-tab-sidebar' }
  /** Archived tabs, newest first. */
  | { type: 'get-archived-tabs' }
  /** A menu-bar command by its id (command mode), carried out as if its menu item were chosen. */
  | { type: 'run-menu-command'; id: string }
  /** Tab sidebar folders. */
  | { type: 'get-tab-folders' }
  | { type: 'create-tab-folder'; name: string; parentId: string | null; tabIds: string[] }
  | { type: 'update-tab-folder'; id: string; name?: string; collapsed?: boolean; parentId?: string | null }
  | { type: 'delete-tab-folder'; id: string }
  | { type: 'move-tab-to-folder'; tabId: string; folderId: string | null }
  /** A saved collection opened as a folder of (unloaded) tabs. */
  | { type: 'open-tab-folder'; name: string; urls: string[] }
  /** Reopen archived tabs (shown when one id; all in the background otherwise). */
  | { type: 'reopen-archived-tabs'; ids: string[] }
  | { type: 'set-tab-sidebar'; sidebar: TabSidebarState }
  | { type: 'get-state' }
  | { type: 'get-protection' }
  | { type: 'set-site-protection'; enabled: boolean }
  | { type: 'set-protection-categories'; ads: boolean; trackers: boolean }
  | { type: 'get-tabs' }
  | { type: 'activate-tab'; id: string }
  | { type: 'close-tab'; id: string }
  | { type: 'cycle-tabs'; direction: 'next' | 'previous' }
  | { type: 'move-tab'; id: string; toIndex: number }
  | { type: 'set-tab-pinned'; id: string; pinned: boolean }
  | { type: 'set-tab-muted'; id: string; muted: boolean }
  | { type: 'tab-menu'; id: string; x?: number; y?: number }
  | { type: 'close-active-tab' }
  | { type: 'reopen-closed-tab'; id?: string }
  | { type: 'get-closed-tabs' }
  | { type: 'select-tab'; index: number }
  /** Copy the open page's address; `clean` removes known tracking parameters. */
  | { type: 'copy-page-address'; clean: boolean }
  /** A pinned tab goes back to its home address (and is shown). */
  | { type: 'tab-home'; id: string }
  /** ⌃ released (commit: show the highlighted tab) or Escape (cancel) while the recent-tabs switcher is open. */
  | { type: 'tab-switcher'; action: 'commit' | 'cancel' }
  /** Preview a web address in a card floating over the page or the globe (⇧-click on a headline). */
  | { type: 'preview-link'; url: string }
  | { type: 'force-reload' }
  | { type: 'save-page' }
  /** Save the page as a PDF in one click (options: also remembered for the next click). */
  | { type: 'export-pdf'; options?: PdfExportOptions }
  | { type: 'cancel-pdf-export' }
  | { type: 'get-pdf-settings' }
  | { type: 'set-pdf-settings'; options: PdfExportOptions }
  /** A PDF this app saved: open it, or show it in Finder. */
  | { type: 'open-saved-file'; path: string; reveal: boolean }
  /** Every PDF saved here whose file is still there, newest first. */
  | { type: 'list-saved-pdfs' }
  /** Take a PDF off that list (the file stays where it is). */
  | { type: 'forget-saved-pdf'; id: string }
  | { type: 'read-private-library' }
  | { type: 'write-private-library'; payload: string }
  | { type: 'delete-private-library' }
  | { type: 'get-field-snapshot' }
  | { type: 'get-public-field-status' }
  | { type: 'get-news-digest' }
  /** What is rising and fading in one place's news (a country, or a city by name). */
  | { type: 'get-place-trends'; countryCode: string; name?: string; aliases?: string[]; geonameId?: string }
  /** Right-click in the address bar: edit items plus "Paste and Go". */
  | { type: 'address-menu'; hasSelection: boolean }

const commandTypes = new Set<BrowserHostCommand['type']>([
  'open',
  'new-tab',
  'hold-page',
  'close',
  'restore',
  'navigate',
  'back',
  'forward',
  'reload',
  'stop',
  'find',
  'stop-find',
  'print',
  'zoom',
  'set-bounds',
  'set-full-width',
  'set-tab-dock-open',
  'set-chrome-revealed',
  'set-tab-rail-expanded',
  'get-tab-sidebar',
  'get-archived-tabs',
  'run-menu-command',
  'get-tab-folders',
  'create-tab-folder',
  'update-tab-folder',
  'delete-tab-folder',
  'move-tab-to-folder',
  'open-tab-folder',
  'reopen-archived-tabs',
  'set-tab-sidebar',
  'get-state',
  'get-protection',
  'set-site-protection',
  'set-protection-categories',
  'get-tabs',
  'activate-tab',
  'close-tab',
  'cycle-tabs',
  'move-tab',
  'set-tab-pinned',
  'set-tab-muted',
  'tab-menu',
  'close-active-tab',
  'reopen-closed-tab',
  'get-closed-tabs',
  'select-tab',
  'copy-page-address',
  'tab-home',
  'tab-switcher',
  'preview-link',
  'force-reload',
  'save-page',
  'export-pdf',
  'cancel-pdf-export',
  'get-pdf-settings',
  'set-pdf-settings',
  'open-saved-file',
  'list-saved-pdfs',
  'forget-saved-pdf',
  'read-private-library',
  'write-private-library',
  'delete-private-library',
  'get-field-snapshot',
  'get-public-field-status',
  'get-news-digest',
  'get-place-trends',
  'address-menu',
])

function parseTabId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) throw new Error('Invalid tab.')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseIntent(value: unknown): NavigationIntent {
  if (!isRecord(value)) throw new Error('Invalid navigation intent.')
  const { kind, value: input } = value
  if (kind !== 'url' && kind !== 'search' && kind !== 'topic') {
    throw new Error('Invalid navigation mode.')
  }
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > 8_192) {
    throw new Error('Invalid navigation value.')
  }
  return { kind, value: input }
}

function parseBounds(value: unknown): BrowserPanelBounds {
  if (!isRecord(value)) throw new Error('Invalid panel bounds.')
  const keys = ['x', 'y', 'width', 'height'] as const
  for (const key of keys) {
    const coordinate = value[key]
    if (
      typeof coordinate !== 'number' ||
      !Number.isFinite(coordinate) ||
      Math.abs(coordinate) > 32_768
    ) {
      throw new Error('Invalid panel bounds.')
    }
  }
  return {
    x: value['x'] as number,
    y: value['y'] as number,
    width: value['width'] as number,
    height: value['height'] as number,
  }
}

/** Largest private library payload accepted for saving, in characters. */
export const PRIVATE_LIBRARY_MAX_CHARS = 32_000_000

function isShortId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
}

function nullableId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (!isShortId(value)) throw new Error('Invalid folder.')
  return value
}

/** A folder's name: trimmed, single line, at most 80 characters. */
function folderName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid folder name.')
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80)
  if (!name) throw new Error('A folder needs a name.')
  return name
}

export function parseBrowserHostCommand(value: unknown): BrowserHostCommand {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    throw new Error('Invalid browser-host command.')
  }
  const type = value['type']
  if (!commandTypes.has(type as BrowserHostCommand['type'])) {
    throw new Error('Unknown browser-host command.')
  }

  switch (type) {
    case 'open': {
      const disposition = value['disposition']
      if (disposition !== undefined && disposition !== 'background-tab' && disposition !== 'foreground-tab') {
        throw new Error('Invalid open disposition.')
      }
      return { type, intent: parseIntent(value['intent']), ...(disposition ? { disposition } : {}) }
    }
    case 'navigate':
      if (
        typeof value['url'] !== 'string' ||
        value['url'].length === 0 ||
        value['url'].length > 8_192
      ) {
        throw new Error('Invalid navigation URL.')
      }
      return { type, url: value['url'] }
    case 'find':
      if (typeof value['query'] !== 'string' || value['query'].length > 8_192) {
        throw new Error('Invalid find query.')
      }
      return {
        type,
        query: value['query'],
        findNext: value['findNext'] === true,
        forward: value['forward'] !== false,
      }
    case 'zoom':
      if (value['action'] !== 'in' && value['action'] !== 'out' && value['action'] !== 'reset') {
        throw new Error('Invalid zoom action.')
      }
      return { type, action: value['action'] }
    case 'set-bounds':
      return { type, bounds: parseBounds(value['bounds']) }
    case 'hold-page':
      if (typeof value['held'] !== 'boolean') throw new Error('Invalid page hold.')
      return { type, held: value['held'] }
    case 'set-full-width':
      if (typeof value['enabled'] !== 'boolean') throw new Error('Invalid full-width state.')
      return { type, enabled: value['enabled'] }
    case 'set-tab-dock-open':
      if (typeof value['open'] !== 'boolean') throw new Error('Invalid tab-dock state.')
      if (value['hold'] !== undefined && typeof value['hold'] !== 'boolean') throw new Error('Invalid tab-dock hold.')
      return { type, open: value['open'], ...(value['hold'] === true ? { hold: true } : {}) }
    case 'set-tab-sidebar': {
      const sidebar = value['sidebar'] as Record<string, unknown> | null
      if (typeof sidebar !== 'object' || sidebar === null || !(TAB_SIDEBAR_MODES as readonly unknown[]).includes(sidebar['mode']) ||
          typeof sidebar['width'] !== 'number' || !Number.isFinite(sidebar['width'])) throw new Error('Invalid tab sidebar.')
      return { type, sidebar: { mode: sidebar['mode'] as TabSidebarMode, width: Math.round(Math.min(TAB_SIDEBAR_WIDTH.max, Math.max(TAB_SIDEBAR_WIDTH.min, sidebar['width']))) } }
    }
    case 'get-tab-sidebar':
    case 'get-archived-tabs':
      return { type }
    case 'get-tab-folders':
      return { type }
    case 'create-tab-folder': {
      const tabIds = value['tabIds'] ?? []
      if (!Array.isArray(tabIds) || tabIds.length > 50 || !tabIds.every(isShortId)) throw new Error('Invalid folder tabs.')
      return { type, name: folderName(value['name']), parentId: nullableId(value['parentId']), tabIds: tabIds as string[] }
    }
    case 'update-tab-folder': {
      if (!isShortId(value['id'])) throw new Error('Invalid folder.')
      if (value['collapsed'] !== undefined && typeof value['collapsed'] !== 'boolean') throw new Error('Invalid folder.')
      return {
        type,
        id: value['id'],
        ...(value['name'] !== undefined ? { name: folderName(value['name']) } : {}),
        ...(value['collapsed'] !== undefined ? { collapsed: value['collapsed'] as boolean } : {}),
        ...(value['parentId'] !== undefined ? { parentId: nullableId(value['parentId']) } : {}),
      }
    }
    case 'delete-tab-folder':
      if (!isShortId(value['id'])) throw new Error('Invalid folder.')
      return { type, id: value['id'] }
    case 'move-tab-to-folder':
      if (!isShortId(value['tabId'])) throw new Error('Invalid tab.')
      return { type, tabId: value['tabId'], folderId: nullableId(value['folderId']) }
    case 'open-tab-folder': {
      const urls = value['urls']
      if (!Array.isArray(urls) || urls.length === 0 || urls.length > 50 || !urls.every((url) => typeof url === 'string' && url.length <= 8_192)) throw new Error('Invalid folder pages.')
      return { type, name: folderName(value['name']), urls: urls as string[] }
    }
    case 'run-menu-command':
      if (typeof value['id'] !== 'string' || !/^[a-z][a-z-]{1,40}$/.test(value['id'])) throw new Error('Invalid menu command.')
      return { type, id: value['id'] }
    case 'reopen-archived-tabs': {
      const ids = value['ids']
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 300 || !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 80)) throw new Error('Invalid archived tabs.')
      return { type, ids: ids as string[] }
    }
    case 'set-tab-rail-expanded':
      if (typeof value['expanded'] !== 'boolean') throw new Error('Invalid tab rail state.')
      return { type, expanded: value['expanded'] }
    case 'set-chrome-revealed':
      if (typeof value['revealed'] !== 'boolean') throw new Error('Invalid toolbar state.')
      if (value['hold'] !== undefined && typeof value['hold'] !== 'boolean') throw new Error('Invalid toolbar hold.')
      return { type, revealed: value['revealed'], ...(value['hold'] === true ? { hold: true } : {}) }
    case 'set-site-protection':
      if (typeof value['enabled'] !== 'boolean') {
        throw new Error('Invalid site protection flag.')
      }
      return { type, enabled: value['enabled'] }
    case 'set-protection-categories':
      if (typeof value['ads'] !== 'boolean' || typeof value['trackers'] !== 'boolean') {
        throw new Error('Invalid protection categories.')
      }
      return { type, ads: value['ads'], trackers: value['trackers'] }
    case 'activate-tab':
    case 'close-tab':
      if (typeof value['id'] !== 'string' || value['id'].length === 0 || value['id'].length > 80) {
        throw new Error('Invalid tab.')
      }
      return { type, id: value['id'] }
    case 'move-tab': {
      const toIndex = value['toIndex']
      if (typeof toIndex !== 'number' || !Number.isInteger(toIndex) || toIndex < 0 || toIndex > 1_000) {
        throw new Error('Invalid tab position.')
      }
      return { type, id: parseTabId(value['id']), toIndex }
    }
    case 'set-tab-pinned':
      if (typeof value['pinned'] !== 'boolean') throw new Error('Invalid tab pin.')
      return { type, id: parseTabId(value['id']), pinned: value['pinned'] }
    case 'set-tab-muted':
      if (typeof value['muted'] !== 'boolean') throw new Error('Invalid tab mute.')
      return { type, id: parseTabId(value['id']), muted: value['muted'] }
    case 'tab-menu': {
      const id = parseTabId(value['id'])
      const x = value['x']
      const y = value['y']
      if (x === undefined && y === undefined) return { type, id }
      const coordinate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 32_768
      if (!coordinate(x) || !coordinate(y)) throw new Error('Invalid menu position.')
      return { type, id, x: Math.round(x), y: Math.round(y) }
    }
    case 'cycle-tabs':
      if (value['direction'] !== 'next' && value['direction'] !== 'previous') {
        throw new Error('Invalid tab cycle.')
      }
      return { type, direction: value['direction'] }
    case 'reopen-closed-tab':
      if (value['id'] === undefined) return { type }
      if (typeof value['id'] !== 'string' || value['id'].length === 0 || value['id'].length > 80) {
        throw new Error('Invalid closed tab.')
      }
      return { type, id: value['id'] }
    case 'tab-switcher':
      if (value['action'] !== 'commit' && value['action'] !== 'cancel') throw new Error('Invalid switcher action.')
      return { type, action: value['action'] }
    case 'preview-link':
      if (typeof value['url'] !== 'string' || value['url'].length === 0 || value['url'].length > 8_192 || !/^https?:\/\//i.test(value['url'])) {
        throw new Error('Invalid preview address.')
      }
      return { type, url: value['url'] }
    case 'tab-home':
      if (typeof value['id'] !== 'string' || value['id'].length === 0 || value['id'].length > 80) throw new Error('Invalid tab.')
      return { type, id: value['id'] }
    case 'copy-page-address':
      if (typeof value['clean'] !== 'boolean') throw new Error('Invalid copy request.')
      return { type, clean: value['clean'] }
    case 'select-tab':
      if (typeof value['index'] !== 'number' || !Number.isInteger(value['index']) || value['index'] < -1 || value['index'] > 999) {
        throw new Error('Invalid tab number.')
      }
      return { type, index: value['index'] }
    case 'write-private-library':
      // The whole library is one sealed payload; 32 MB is ~16,000 absorbed excerpts (500 KB filled up after ~250).
      if (typeof value['payload'] !== 'string' || value['payload'].length > PRIVATE_LIBRARY_MAX_CHARS) {
        throw new Error(typeof value['payload'] === 'string' ? 'The private library is too large to save.' : 'Invalid private library.')
      }
      return { type, payload: value['payload'] }
    case 'get-place-trends': {
      const code = value['countryCode']
      const name = value['name']
      const aliases = value['aliases']
      const geonameId = value['geonameId']
      if (geonameId !== undefined && (typeof geonameId !== 'string' || !/^\d{1,10}$/.test(geonameId))) throw new Error('Invalid place id.')
      if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) throw new Error('Invalid place.')
      if (name !== undefined && (typeof name !== 'string' || name.length > 120)) throw new Error('Invalid place name.')
      if (aliases !== undefined && (!Array.isArray(aliases) || aliases.length > 8 || aliases.some((alias) => typeof alias !== 'string' || alias.length > 120))) throw new Error('Invalid place names.')
      return { type, countryCode: code, ...(typeof name === 'string' && name ? { name } : {}), ...(Array.isArray(aliases) ? { aliases: aliases as string[] } : {}), ...(typeof geonameId === 'string' ? { geonameId } : {}) }
    }
    case 'address-menu':
      return { type, hasSelection: value['hasSelection'] === true }
    case 'read-private-library':
    case 'delete-private-library':
    case 'get-field-snapshot':
    case 'get-public-field-status':
    case 'get-news-digest':
    case 'new-tab':
    case 'close':
    case 'restore':
    case 'back':
    case 'forward':
    case 'reload':
    case 'stop':
    case 'stop-find':
    case 'print':
    case 'get-state':
    case 'get-protection':
    case 'get-tabs':
    case 'close-active-tab':
    case 'get-closed-tabs':
    case 'force-reload':
    case 'save-page':
    case 'cancel-pdf-export':
    case 'get-pdf-settings':
    case 'list-saved-pdfs':
      return { type }
    case 'forget-saved-pdf': {
      const id = value['id']
      if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(id)) throw new Error('Invalid saved PDF.')
      return { type, id }
    }
    case 'export-pdf':
      return value['options'] === undefined ? { type } : { type, options: parsePdfExportOptions(value['options']) }
    case 'set-pdf-settings':
      return { type, options: parsePdfExportOptions(value['options']) }
    case 'open-saved-file': {
      const path = value['path']
      if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048 || !/\.pdf$/i.test(path) || path.includes('\0')) throw new Error('Invalid file.')
      return { type, path, reveal: value['reveal'] === true }
    }
    default:
      throw new Error('Unknown browser-host command.')
  }
}

export * from './captures'
export * from './olds'
export * from './knowledge'
export * from './laya'
export * from './translate'
export * from './privacy'
export * from './sitePermissions'
export * from './beacons'
export * from './updates'
export * from './downloads'
export * from './history'
export * from './browsing'
