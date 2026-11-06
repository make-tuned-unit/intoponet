import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import {
  app,
  BrowserWindow,
  ipcMain,
  powerMonitor,
  Menu,
  safeStorage,
  session,
  WebContentsView,
  clipboard,
  protocol,
  shell,
  systemPreferences,
  autoUpdater,
  dialog,
  nativeImage,
  net,
  webFrameMain,
  nativeTheme,
} from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { pendingWrite, writeFileAtomic, writeFileAtomicSync } from './atomicFile'
import { isAppShellUrl, SHELL_PERMISSIONS } from './shellGuard'
import { LatestWriter } from './latestWriter'
import { fetchCurrentRelease, UpdateController } from './updates'
import { FeedbackService, parseFeedbackCommand } from './feedback'
import { PasswordVault } from './passwords/vault'
import { PasswordService, type PasswordPage } from './passwords/service'
import { passwordOrigin } from './passwords/origin'
import { parsePasswordCommand, passwordChannels, type PasswordEvent } from '../shared/passwords'
import { parsePasswordPageMessage, passwordPageChannels } from '../shared/passwordPage'
import { updateChannels, parseUpdateCommand } from '@intoponet/browser-api'
import { browserUserAgent } from './browserUserAgent'
import { capTitle, capUrl, coalesce, persistedActiveUrl } from './tabState'
import { EXIT_FULLSCREEN_SCRIPT, FULLSCREEN_WORLD_ID, fullscreenSiteName, showFullscreenNotice } from './fullscreenNotice'
import { bindLeavePrompt, SAFE_DIALOG_PREFERENCES } from './leavePrompt'
import { fetchTabIcon, TabIconMemory } from './tabFavicon'
import { browsingChannels, parseBrowsingCommand, type BrowsingEvent, type BrowsingSettings, type PageLoadError, type TabSidebarState, type TabSleepAfter, type TabSwitchOrder } from '@intoponet/browser-api'
import { ExternalOpenBroker, classifyExternalUrl } from './externalOpen'
import { CertificateErrorMemo, classifyLoadError, isCertificateError, showsErrorPage, summarizeCertificate } from './errorPage'
import { IncomingOpenQueue, LocalFileGrants, incomingFileTarget, incomingTargetsFromArgs, incomingWebUrl, type IncomingTarget } from './incomingOpen'
import { PageAppearanceController } from './pageAppearance'
import { SWITCHER_KEYS_SCRIPT, switcherHtml, SWITCHER_ROW_HEIGHT, SWITCHER_ROWS, TabSwitcher, type SwitcherTab } from './tabSwitcher'
import { DEFAULT_TAB_SLEEP, parseBrowsingSettingsFile, sleepAfterMs, tabsDueForSleep, TYPED_FORM_SCRIPT } from './tabSleep'
import { browserContextExtras, searchSelectionLabel } from './browserContextMenu'

declare const __INTOPONET_MAC_UPDATE_URL__: string

// Every renderer is sandboxed, whatever its own options say (a backstop: each window and view
// already asks for it). Must run before the app is ready; worker threads in main are unaffected.
app.enableSandbox()

// Sites see plain Chrome (some refuse "Electron" as an outdated browser).
app.userAgentFallback = browserUserAgent(app.userAgentFallback)

if (!app.isReady()) {
  app.commandLine.appendSwitch(
    'disable-features',
    'WebContentsForceDark,WebContentsForceDarkVariations',
  )
}

// ---- Links and files from other apps (default browser, Open With, a second launch) ----
/** What arrived before the window was ready opens once it is (see whenReady). */
const incomingOpens = new IncomingOpenQueue()
/** Local files opened from Finder: the only files a tab may read (see servePageFiles). */
const localFileGrants = new LocalFileGrants()
const readSmallFile = (path: string): Buffer => {
  if (statSync(path).size > 64_000) throw new Error('Too large for a saved link.')
  return readFileSync(path)
}
if (!app.requestSingleInstanceLock()) {
  // Intoponet is already open (with this profile): it opens what this launch was given.
  app.quit()
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    for (const target of incomingTargetsFromArgs(argv, workingDirectory, readSmallFile)) incomingOpens.push(target)
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  const web = incomingWebUrl(url)
  if (web) incomingOpens.push({ kind: 'web', url: web })
})
app.on('open-file', (event, path) => {
  event.preventDefault()
  incomingOpens.push(incomingFileTarget(path, readSmallFile))
})
import { cachedPublicField, publicFieldStatus, startPublicFieldRefresh } from './public-field'
import { startNewsService } from './news/newsService'
import { openDigestBuilder } from './news/openDigestBuilder'
import { readSealedPrivateLibrary } from './privateLibraryStorage'
import { routeProtectionRequest } from './protectionRequest'
import {
  dockReserveAt,
  dockReserveTarget,
  pageViewBoundsForDock,
  shouldCloseTabDockFromNativeMouse,
  shouldHideChromeFromNativeMouse,
  windowButtonsVisible,
  TAB_DOCK_TWEEN_MS,
} from './tabDockBounds'
import { FOCUS_TAKES_TYPING_SCRIPT, isPlainEscape, pageKeyAction, TEXT_FIELD_FIRST } from './shellShortcuts'
import { cleanAddress } from '../shared/cleanAddress'
import { createAppMenuController, routeAppCommand, type AppCommand, type AppMenuState } from './appMenu'
import { boundedHistory, ClosedTabs, type TabHistory } from './closedTabs'
import { stepZoom, ZoomStore } from './zoomStore'
import { savePageFilename } from './savePage'
import { TRACKER_STUB_SCRIPT } from './trackerStubs'
import { addressMenuTemplate, pasteAndGoText } from './addressMenu'
import { bindPermissionOwnerLifecycle, kindsFor, originOf, SitePermissionBroker, SitePermissionStore } from './sitePermissions'
import { bindPopupCloseWithOwner, nestedPopupDecision, popupDecision, popupWindowOptions, PopupLimiter, trackUserActivation, UserActivation, guardPopupWindow } from './popups'
import { CLIENT_CERTIFICATE_NOTICE, declineClientCertificate, rejectCertificateErrorForSession } from './browserCertificatePolicy'
import { reserveDownloadPath, sanitizeDownloadFilename } from './downloadReservation'
import { downloadsDirectory, installBrowsingData, openHistoryPane, type BrowsingData } from './browsingData'
import { exportPagePdf } from './pdfExport/exportPdf'
import { SavedPdfList } from './pdfExport/savedPdfs'
import { DEFAULT_PDF_SETTINGS, parsePdfSettings, type PdfExportSettings } from './pdfExport/settings'
import { CrashRecoveryPolicy } from './crashRecovery'
import { BeaconPublisher } from './beacons/publisher'
import { DEFAULT_BEACON_REGISTRY } from './beacons/defaults'
import { ENCRYPTED_DNS, networkPrivacySnapshot, WEBRTC_POLICY } from './networkPrivacy'
let newsService: ReturnType<typeof startNewsService> | null = null
let encryptedDnsActive = false
import { CaptureLibrary, migrateEncryptedCaptures } from './captureStore'
import { CaptureService } from './captureService'
import { CAPTURE_SCHEME, captureChannels, knowledgeChannels, layaChannels, parseLayaCommand, translateChannels, parseTranslateCommand, normalizeLanguage, privacyChannels, parsePrivacyCommand, isExcludedSite, type PrivacyState, sitePermissionChannels, parseSitePermissionCommand, beaconChannels, parseBeaconCommand, oldsChannels, parseCaptureCommand, parseKnowledgeCommand, parseOldsCommand } from '@intoponet/browser-api'
import { KnowledgeService } from './knowledge/service'
import { LayaService } from './laya/service'
import { openLayaEmbedder } from './laya/openEmbedder'
import { TranslateService } from './translate/service'
import { FaviconCache, isIconHost } from './faviconCache'
import { ArticlePreviews, previewableUrl } from './articlePreview'
import { ACCESS_SCRIPT, ACCESS_WORLD_ID, parseAccess } from './access/pageAccess'
import { backupExclusionAvailable, backupExclusionStatus, readBackupExclusionIntent, setBackupExclusion, watchBackupExclusionPaths } from './backupExclusion'
import { TranslateStore } from './translate/store'
import { openTranslationEngine } from './translate/openEngine'
import { loadKnowledgeCrypto, retryingKnowledgeCrypto } from './knowledge/crypto'
import { OldsService } from './olds/oldsService'
import { OutletArchive } from './olds/outletArchive'

// Private capture media scheme (served to the app window's default session
// only; web pages run in a separate partition and cannot reach it).
protocol.registerSchemesAsPrivileged([
  { scheme: CAPTURE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])
let captures: CaptureService | null = null
import { browserContextActions, type BrowserContextAction } from './browserContextMenu'
import { duplicateIndex, moveTab, otherTabIds, pinnedFirst, setPinned, tabIdsToRight } from './tabOrder'
import { tabMenuTemplate, type TabMenuAction } from './tabMenu'
import { liveTabFlags } from './tabState'
import {
  browserHostChannels,
  type BrowserHostCommand,
  type BrowserHostEvent,
  type BrowserPanelBounds,
  type BrowserPanelSnapshot,
  type ClosedTabSnapshot,
  type PageTabSnapshot,
  type SavedPdfRecord,
  type PrivateLibraryReadResult,
  type ShellShortcut,
  type ProtectionSnapshot,
  type PublicFieldStatus,
  parseBrowserHostCommand,
  resolveNavigationIntent,
} from '@intoponet/browser-api'
import {
  LocalProtectionEngine,
  ProtectionPageContextStore,
} from '@intoponet/protection-engine'

let window: BrowserWindow | null = null
let pageView: WebContentsView | null = null
let translateService: TranslateService | null = null
/** Saved passwords (sealed on this Mac); null until the app is ready. */
let passwords: PasswordService | null = null
/** Private browsing: new tabs use an in-memory session and record nothing. */
const PRIVATE_PARTITION = 'intoponet-private'
// Site permissions: asked in a bar, remembered per site (private tabs: in memory until private browsing ends).
let sitePermissions: SitePermissionBroker | null = null
const privatePermissions = new SitePermissionStore(null)
/** Sites the user never wants absorbed or remembered (Privacy › Sites to leave out). */
let excludedSites: string[] = []
let privateMode = false
const privateViews = new WeakSet<WebContentsView>()
let faviconCache: FaviconCache | null = null
let pageAttached = false
let activeTabId: string | null = null
let browserFullWidth = false
let tabDockOpen = false
let tabDockHeld = false
let chromeRevealed = false
let chromeHeld = false
let tabRailExpanded = false
/** A page that asked for HTML fullscreen (a video, a game): its view fills the window until it leaves. */
/** Isolated world for reading a page's rating declarations (others: translate, knowledge, access). */
const RATING_WORLD_ID = 1305
/** Isolated world for asking where keyboard focus is (text fields get some keys first). */
const KEYS_WORLD_ID = 1311
let htmlFullScreenView: WebContentsView | null = null
let removeFullscreenNotice: (() => void) | null = null
/** Animated dock reservation; null when resting at its target. */
let dockReserveNow: number | null = null
let dockTweenTimer: ReturnType<typeof setTimeout> | null = null
const openTabs: OpenTab[] = []
let lastBounds: BrowserPanelBounds = { x: 40, y: 104, width: 900, height: 600 }
let lastKnownUrl = ''
let persistenceTimer: ReturnType<typeof setTimeout> | null = null
const protection = new LocalProtectionEngine()
const protectionPages = new ProtectionPageContextStore()
/** Recently closed tabs (⌘⇧T, History › Recently Closed): this session only, never private tabs. */
const closedTabs = new ClosedTabs(25)
/** Per-site zoom kept between launches (not for private tabs); null until the app is ready. */
let zoomStore: ZoomStore | null = null
/** Reopened tabs whose history is being restored: showing them must not load their address over it. */
const restoringViews = new WeakSet<WebContentsView>()

type OpenTab = {
  id: string
  url: string
  title: string
  favicon: string
  view: WebContentsView
  /** A new tab that has not loaded a page: its view stays hidden and the shell draws the start page. */
  start?: boolean
  /** Pinned tabs sit first and are restored next launch as pinned. */
  pinned?: boolean
  /** The page could not load: its view stays hidden and the shell draws the error page (errorPage.ts). */
  loadError?: PageLoadError
  /** An offline error already retried once by itself (reset when a page loads). */
  autoRetried?: boolean
  /** A pinned tab's home: the address it was pinned at. */
  home?: string
  /** Unloaded (pinned tab closed, or asleep): the view is blank until shown; `history` is where it was. */
  asleep?: { history?: TabHistory }
  /** When the tab was last shown or left (for sleeping background tabs and recent-order switching). */
  lastShownAt?: number
}

/** Asks before a page opens another app (externalOpen.ts); null until the app is ready. */
let externalOpener: ExternalOpenBroker | null = null
/** Pages follow the Mac's light/dark appearance unless Settings says otherwise (pageAppearance.ts). */
const pageAppearance = new PageAppearanceController('system')
/** Certificate problems, kept until the failed load that follows shows them. */
const certificateErrors = new CertificateErrorMemo()

type PersistentBrowserState = {
  version: 2
  url: string
  bounds: BrowserPanelBounds
  wasVisible: boolean
  tabs: { id: string; url: string; title: string; pinned?: boolean; home?: string }[]
  /** The tab sidebar's mode and width (absent until first changed). */
  sidebar?: TabSidebarState
}

const defaultPanelState = (): BrowserPanelSnapshot => ({
  url: lastKnownUrl,
  title: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  isVisible: pageAttached,
})

/**
 * Whether a view's page is gone. Once its contents is destroyed, `view.webContents` is undefined
 * (not merely destroyed), so every access must go through this check first.
 */
function viewGone(view: WebContentsView): boolean {
  const contents = view.webContents as Electron.WebContents | undefined
  return !contents || contents.isDestroyed()
}

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function persistentState(): PersistentBrowserState {
  // Private tabs are never saved or restored; nor are empty new tabs.
  const tabs = tabSnapshots().filter((tab) => !tab.isPrivate && !tab.isStartPage).map((tab) => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    ...(tab.pinned ? { pinned: true } : {}),
    ...(tab.pinned && tab.home ? { home: tab.home } : {}),
  }))
  return {
    version: 2,
    // The open page only when it is a saved tab: a private page's address never reaches the disk.
    url: persistedActiveUrl(tabs, activeTabId, lastKnownUrl),
    bounds: lastBounds,
    wasVisible: pageAttached,
    tabs,
    ...(tabSidebar ? { sidebar: tabSidebar } : {}),
  }
}

function stateFilePath(): string {
  return join(app.getPath('userData'), 'browser-state.v1.json')
}

/** Saves still on their way to disk; quitting waits for them (see before-quit). */
const writesInFlight = new Set<Promise<unknown>>()

/** An atomic save the quit path will wait for. Failures are logged; the next save tries again. */
function trackedWrite(path: string, data: string): Promise<void> {
  const write = writeFileAtomic(path, data)
  writesInFlight.add(write)
  void write.catch(() => undefined).finally(() => writesInFlight.delete(write))
  return write
}

/** Set once the final state is written on quit (and while the window closes): later saves would only be stale. */
let stateWritesClosed = false

async function savePersistentState(): Promise<void> {
  if (stateWritesClosed) return
  await trackedWrite(stateFilePath(), JSON.stringify(persistentState()))
}

function schedulePersistentStateSave(): void {
  if (stateWritesClosed) return
  if (persistenceTimer) clearTimeout(persistenceTimer)
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null
    savePersistentState().catch((error: unknown) => console.error('Could not save open tabs:', error))
  }, 150)
}

/** The last save, on quit: synchronous (the process is ending) and after any async save of the same file. */
function writeFinalState(): void {
  if (persistenceTimer) clearTimeout(persistenceTimer)
  persistenceTimer = null
  try {
    writeFileAtomicSync(stateFilePath(), JSON.stringify(persistentState()))
  } catch (error) {
    console.error('Could not save open tabs on quit:', error)
  }
}

async function loadPersistentState(): Promise<PersistentBrowserState | null> {
  try {
    const parsed = JSON.parse(await readFile(stateFilePath(), 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const candidate = parsed as Record<string, unknown>
    if (
      (candidate['version'] !== 1 && candidate['version'] !== 2) ||
      typeof candidate['wasVisible'] !== 'boolean'
    ) {
      return null
    }
    const url =
      typeof candidate['url'] === 'string' && safeHttpUrl(candidate['url'])
        ? candidate['url']
        : ''
    const boundsCommand = parseBrowserHostCommand({
      type: 'set-bounds',
      bounds: candidate['bounds'],
    })
    if (boundsCommand.type !== 'set-bounds') return null
    const tabs = Array.isArray(candidate['tabs'])
      ? candidate['tabs'].flatMap((entry) => {
          if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
          const record = entry as Record<string, unknown>
          if (typeof record['url'] !== 'string' || !safeHttpUrl(record['url'])) return []
          return [
            {
              id: typeof record['id'] === 'string' ? record['id'].slice(0, 80) : randomUUID(),
              url: record['url'],
              title: typeof record['title'] === 'string' ? record['title'].slice(0, 180) : '',
              ...(record['pinned'] === true ? { pinned: true } : {}),
              ...(record['pinned'] === true && typeof record['home'] === 'string' && record['home'].length <= 8_192 && safeHttpUrl(record['home']) ? { home: record['home'] } : {}),
            },
          ]
        })
      : url
        ? [{ id: randomUUID(), url, title: '' }]
        : []
    let sidebar: TabSidebarState | undefined
    try {
      const parsedSidebar = parseBrowserHostCommand({ type: 'set-tab-sidebar', sidebar: candidate['sidebar'] })
      if (parsedSidebar.type === 'set-tab-sidebar') sidebar = parsedSidebar.sidebar
    } catch { /* never set, or damaged: the default */ }
    return {
      version: 2,
      url,
      bounds: boundsCommand.bounds,
      wasVisible: candidate['wasVisible'],
      tabs,
      ...(sidebar ? { sidebar } : {}),
    }
  } catch {
    return null
  }
}

function panelState(): BrowserPanelSnapshot {
  if (!pageView || viewGone(pageView)) return defaultPanelState()
  const contents = pageView.webContents
  if (isStartView(pageView)) {
    return {
      url: '',
      title: 'New tab',
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isVisible: pageAttached,
      isPrivate: privateViews.has(pageView),
      isStartPage: true,
    }
  }
  return {
    url: capUrl(contents.getURL()),
    title: capTitle(contents.getTitle()),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    isLoading: contents.isLoading(),
    isVisible: pageAttached,
    isPrivate: privateViews.has(pageView),
    zoomFactor: Number(contents.getZoomFactor().toFixed(3)),
    ...loadErrorOf(pageView),
  }
}

function emit(event: BrowserHostEvent): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(browserHostChannels.event, event)
  }
  // The menu bar enables its items from the same state (rebuilt only when that changed).
  if (event.type === 'panel-state' || event.type === 'tabs') appMenu.schedule()
}

/** At most about one per frame: a page can fire navigation and title events as fast as it likes. */
const emitPanelState = coalesce(() => emit({ type: 'panel-state', panel: panelState() }))

function exceptionsFilePath(): string {
  return join(app.getPath('userData'), 'protection-exceptions.json')
}

function currentOrigin(): string {
  if (!lastKnownUrl) return ''
  try {
    return new URL(lastKnownUrl).origin
  } catch {
    return ''
  }
}

function protectionSnapshot(): ProtectionSnapshot {
  const origin = currentOrigin()
  const categories = protection.categoryToggles()
  const counts = protectionPages.counters(pageView?.webContents.id ?? null)
  return {
    origin,
    enabled: origin ? protection.isSiteEnabled(origin, 'default') : true,
    ...counts,
    adsEnabled: categories.ads,
    trackersEnabled: categories.trackers,
    network: networkPrivacySnapshot(encryptedDnsActive),
  }
}

/** Coalesced too: every blocked request of the open page asks for an update. */
const emitProtectionState = coalesce(() => emit({ type: 'protection-state', protection: protectionSnapshot() }))

function persistExceptions(): void {
  if (!app.isReady()) return
  trackedWrite(
    exceptionsFilePath(),
    JSON.stringify({
      version: 1,
      disabledOrigins: protection.disabledOriginList(),
      categories: protection.categoryToggles(),
    }),
  ).catch((error: unknown) => console.error('Could not save protection settings:', error))
}

async function loadExceptions(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(exceptionsFilePath(), 'utf8')) as {
      disabledOrigins?: unknown
      categories?: { ads?: unknown; trackers?: unknown }
    }
    if (Array.isArray(raw.disabledOrigins)) {
      protection.loadDisabledOrigins(
        raw.disabledOrigins.filter((value): value is string => typeof value === 'string'),
      )
    }
    if (raw.categories) {
      protection.loadCategories({
        ads: raw.categories.ads !== false,
        trackers: raw.categories.trackers !== false,
      })
    }
  } catch {
    // First launch or unreadable file — default-on.
  }
}

const cosmeticStyleId = 'intoponet-cosmetic'

function cosmeticInjection(css: string): string {
  return `(() => {
    const id = ${JSON.stringify(cosmeticStyleId)};
    const existing = document.getElementById(id);
    const css = ${JSON.stringify(css)};
    if (!css) {
      existing?.remove();
      return;
    }
    const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style');
    style.id = id;
    style.textContent = css;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  })()`
}

/**
 * Frames that already have this document's cosmetic rules, per page: `processId:routingId`.
 * Cleared when a frame navigates, so each frame document is injected once rather than on every
 * frame load anywhere in the page.
 */
const cosmeticFrames = new WeakMap<Electron.WebContents, Set<string>>()

function cosmeticFrameKey(frame: Electron.WebFrameMain): string {
  return `${frame.processId}:${frame.routingId}`
}

function forgetCosmeticFrame(contents: Electron.WebContents, isMainFrame: boolean, processId: number, routingId: number): void {
  const injected = cosmeticFrames.get(contents)
  if (!injected) return
  if (isMainFrame) injected.clear()
  else injected.delete(`${processId}:${routingId}`)
}

/**
 * Hide ads and stub blocked trackers. `only` limits it to one frame (the one that just loaded);
 * `onlyNew` skips frames whose current document already has the rules. With neither, every frame
 * gets the current rules (the active tab or the protection settings changed).
 */
async function applyCosmeticFilters(
  contents: Electron.WebContents,
  options: { only?: Electron.WebFrameMain | null; onlyNew?: boolean } = {},
): Promise<void> {
  try {
    if (contents.isDestroyed()) return
    const origin = currentOrigin()
    const rules =
      origin && !protection.isSiteEnabled(origin, 'default')
        ? null
        : protection.cosmeticRules(lastKnownUrl, lastKnownUrl)
    const css = rules?.cssRules.join('\n') ?? ''
    // With protection on, blocked tracker globals get quiet stand-ins so the page's own buttons don't throw.
    const script = rules ? `${cosmeticInjection(css)};${TRACKER_STUB_SCRIPT}` : cosmeticInjection(css)
    const frames = options.only ? [options.only] : contents.mainFrame?.framesInSubtree ?? []
    let injected = cosmeticFrames.get(contents)
    if (!injected) cosmeticFrames.set(contents, (injected = new Set()))
    const done = injected
    await Promise.all(
      frames.map(async (frame) => {
        if (frame.detached) return
        const key = cosmeticFrameKey(frame)
        if ((options.onlyNew || options.only) && done.has(key)) return
        done.add(key)
        try {
          await frame.executeJavaScript(script)
        } catch {
          // The frame can detach between the snapshot and the injection; a later load may try again.
          done.delete(key)
        }
      }),
    )
  } catch {
    // The page may have navigated away before insertion finished.
  }
}

function wireProtectionSession(partition = 'persist:intoponet-default'): void {
  const guest = session.fromPartition(partition)
  guest.webRequest.onBeforeRequest((details, callback) => {
    const routed = routeProtectionRequest(protection, protectionPages, details, openTabs)
    if (!routed) {
      callback({})
      return
    }
    const { webContentsId, decision } = routed
    if (decision.action === 'block') {
      if (pageView?.webContents.id === webContentsId) emitProtectionState()
      callback({ cancel: true })
      return
    }
    callback({})
  })
}

/** The shell is drawing over the page (sources carousel): any page shown meanwhile stays hidden. */
let pageHeld = false

function setPageHeld(held: boolean): void {
  pageHeld = held
  if (pageView && pageAttached) pageView.setVisible(pageViewShown(pageView))
}

/** The page view is drawn unless the shell draws over it (start page, error page, held). */
function pageViewShown(view: WebContentsView): boolean {
  return !pageHeld && !isStartView(view) && !openTabs.some((tab) => tab.view === view && tab.loadError)
}

function attachPageView(): void {
  if (!window || !pageView || pageAttached) return
  window.contentView.addChildView(pageView)
  // A start-page tab keeps its (blank) view hidden so the shell's start page shows and takes input.
  pageView.setVisible(pageViewShown(pageView))
  applyPageViewBounds()
  pageAttached = true
  updateWindowButtons()
  schedulePersistentStateSave()
  emitPanelState()
}

function applyPageViewBounds(): void {
  if (!pageView) return
  if (htmlFullScreenView === pageView && window) {
    const [width = 0, height = 0] = window.getContentSize()
    pageView.setBounds({ x: 0, y: 0, width, height })
    return
  }
  const viewportHeight = window?.getContentSize()[1] ?? lastBounds.y + lastBounds.height
  pageView.setBounds(pageViewBoundsForDock(lastBounds, viewportHeight, browserFullWidth, tabDockOpen, dockReserveNow ?? undefined))
}

function prefersReducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion
  } catch {
    return false
  }
}

/**
 * Glide the page edge to the dock's new reservation (ease-out cubic, matched
 * by the renderer's dock animation) instead of snapping 116px in one frame.
 */
function tweenDockReserve(previousTarget: number): void {
  const target = dockReserveTarget(browserFullWidth, tabDockOpen)
  const from = dockReserveNow ?? previousTarget
  if (dockTweenTimer) clearTimeout(dockTweenTimer)
  dockTweenTimer = null
  if (from === target || !browserFullWidth || prefersReducedMotion()) {
    dockReserveNow = null
    applyPageViewBounds()
    return
  }
  const start = Date.now()
  const step = (): void => {
    const elapsed = Date.now() - start
    dockReserveNow = dockReserveAt(from, target, elapsed)
    applyPageViewBounds()
    if (elapsed >= TAB_DOCK_TWEEN_MS) {
      dockReserveNow = null
      dockTweenTimer = null
      applyPageViewBounds()
      return
    }
    dockTweenTimer = setTimeout(step, 1000 / 120)
  }
  step()
}

function privateLibraryPath(): string {
  return join(app.getPath('userData'), 'private-library.v1.seal')
}

async function readSealedLibrary(): Promise<PrivateLibraryReadResult> {
  const result = await readSealedPrivateLibrary({
    encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
    fileExists: existsSync(privateLibraryPath()),
    decrypt: () => safeStorage.decryptStringAsync(readFileSync(privateLibraryPath())),
    reEncrypt: writeSealedLibrary,
  })
  return result
}

/** Library saves run one at a time in the order asked, and only the newest waiting one is written. */
const libraryWriter = new LatestWriter<string>(async (payload) => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('On-device encryption is unavailable.')
  }
  const sealed = await safeStorage.encryptStringAsync(payload)
  await writeFileAtomic(privateLibraryPath(), sealed)
})

function writeSealedLibrary(payload: string): Promise<void> {
  return libraryWriter.save(payload)
}

async function deleteSealedLibrary(): Promise<void> {
  // A save still waiting must not bring the library back after it is deleted.
  await libraryWriter.discard()
  await pendingWrite(privateLibraryPath())
  if (existsSync(privateLibraryPath())) unlinkSync(privateLibraryPath())
}

// ---- Saved passwords ----------------------------------------------------------

function passwordVaultPath(): string {
  return join(app.getPath('userData'), 'passwords.v1.seal')
}

function openPasswordVault(): PasswordVault {
  return new PasswordVault(
    {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptStringAsync(text),
      decrypt: (data) => safeStorage.decryptStringAsync(data),
    },
    {
      read: () => (existsSync(passwordVaultPath()) ? readFileSync(passwordVaultPath()) : null),
      write: (data) => {
        const destination = passwordVaultPath()
        const temporary = `${destination}.${randomUUID()}.tmp`
        try {
          writeFileSync(temporary, data, { mode: 0o600 })
          renameSync(temporary, destination)
        } catch (error) {
          if (existsSync(temporary)) unlinkSync(temporary)
          throw error
        }
      },
    },
  )
}

function passwordPage(view: WebContentsView): PasswordPage {
  const contents = view.webContents
  return {
    id: contents.id,
    isPrivate: privateViews.has(view),
    origin: () => (contents.isDestroyed() ? null : passwordOrigin(contents.mainFrame.url)),
    fill: (message) => {
      if (!contents.isDestroyed()) contents.mainFrame.send(passwordPageChannels.fill, message)
    },
  }
}

let lastPasswordState = ''
function emitPasswordState(): void {
  const view = pageView
  if (!passwords || !window || window.isDestroyed()) return
  const state = view && !isStartView(view) ? passwords.pageState(passwordPage(view)) : Promise.resolve(null)
  void state.then((value) => {
    if (view !== pageView || !window || window.isDestroyed()) return
    const event: PasswordEvent = { type: 'page-state', state: value }
    const key = JSON.stringify(event)
    if (key === lastPasswordState) return
    lastPasswordState = key
    window.webContents.send(passwordChannels.event, event)
  }, () => undefined)
}

/** Touch ID when the Mac has it; otherwise a plain confirmation. */
async function authorizePasswordReveal(origin: string): Promise<boolean> {
  if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
    try {
      await systemPreferences.promptTouchID('reveal your saved password')
      return true
    } catch {
      return false
    }
  }
  const site = origin.replace(/^https?:\/\//, '')
  const options = {
    type: 'question' as const,
    buttons: ['Continue', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Use the saved password for ${site}?`,
    detail: 'It will be shown or copied. Touch ID is not available, so Intoponet asks first.',
  }
  const { response } = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  return response === 0
}

function wirePasswords(): void {
  passwords = new PasswordService(openPasswordVault(), {
    changed: (pageId) => {
      if (pageId === null && window && !window.isDestroyed()) window.webContents.send(passwordChannels.event, { type: 'changed' } satisfies PasswordEvent)
      if (pageId === null || pageId === pageView?.webContents.id) emitPasswordState()
    },
    authorize: authorizePasswordReveal,
    clipboard: { read: () => clipboard.readText(), write: (text) => clipboard.writeText(text), clear: () => clipboard.clear() },
  })
  // Only the top frame of a normal tab may report a sign-in; its origin is read here, not trusted from the page.
  ipcMain.on(passwordPageChannels.report, (event, value: unknown) => {
    const tab = openTabs.find((item) => !viewGone(item.view) && item.view.webContents === event.sender)
    if (!tab || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return
    const message = parsePasswordPageMessage(value)
    if (!message) return
    void passwords!.report(passwordPage(tab.view), message).catch(() => undefined)
  })
  handleFromShell(passwordChannels.command, async (_event, value: unknown) => {
    const command = parsePasswordCommand(value)
    const service = passwords!
    const active = pageView && !isStartView(pageView) ? passwordPage(pageView) : null
    switch (command.type) {
      case 'page-state': return active ? service.pageState(active) : null
      case 'decide': return service.decide(command.id, command.decision)
      case 'fill':
        if (!active) throw new Error('No page is open.')
        return service.fill(active, command.id)
      case 'dismiss-choice':
        if (active) service.dismissChoice(active.id)
        return undefined
      case 'list': return service.list()
      case 'status': return service.status()
      case 'reveal': return service.reveal(command.id)
      case 'copy': return service.copy(command.id)
      case 'remove': return service.remove(command.id)
      case 'never-list': return service.neverList()
      case 'remove-never': return service.removeNever(command.origin)
    }
  })
}

// ---- The in-tab error page (errorPage.ts says why it is drawn by the shell) ----

function loadErrorOf(view: WebContentsView): { loadError?: PageLoadError } {
  const error = openTabs.find((tab) => tab.view === view)?.loadError
  return error ? { loadError: error } : {}
}

/** Show (or, with null, take away) a tab's error page. */
function setLoadError(view: WebContentsView, error: PageLoadError | null): void {
  const tab = openTabs.find((item) => item.view === view)
  if (!tab || (!error && !tab.loadError)) return
  if (error) tab.loadError = error
  else {
    delete tab.loadError
    tab.autoRetried = false
  }
  if (pageView === view && pageAttached) view.setVisible(pageViewShown(view))
  if (pageView === view) emitPanelState()
  // "Offline" while the Mac reports a network (it changed under the load): one quiet retry.
  if (error?.autoRetry && net.isOnline() && !tab.autoRetried) {
    tab.autoRetried = true
    setTimeout(() => { if (tab.loadError?.autoRetry && !viewGone(tab.view)) tab.view.webContents.reload() }, 3_000).unref?.()
  }
  watchForNetwork()
}

let networkWatch: ReturnType<typeof setInterval> | null = null
let networkWasOnline = true

/** While a tab shows "No internet connection", reload it when the Mac is back online. */
function watchForNetwork(): void {
  const waiting = openTabs.some((tab) => tab.loadError?.autoRetry)
  if (!waiting) {
    if (networkWatch) clearInterval(networkWatch)
    networkWatch = null
    return
  }
  if (networkWatch) return
  networkWasOnline = net.isOnline()
  networkWatch = setInterval(() => {
    const online = net.isOnline()
    if (online && !networkWasOnline) {
      for (const tab of openTabs) if (tab.loadError?.autoRetry && !viewGone(tab.view)) tab.view.webContents.reload()
    }
    networkWasOnline = online
  }, 2_000)
  networkWatch.unref?.()
}

function navigationFailureReason(code: number, description: string): string {
  if (code <= -200 && code >= -219) {
    return `The site certificate was not trusted (${description}). The page was not loaded.`
  }
  return description
}

function wireDownloadSession(partition = 'persist:intoponet-default'): void {
  const browsing = session.fromPartition(partition)
  const isPrivate = partition === PRIVATE_PARTITION
  // Camera, microphone, location, notifications and clipboard reading are asked in a bar under the toolbar;
  // harmless ones (fullscreen, writing to the clipboard) are granted; everything else is refused.
  browsing.setPermissionRequestHandler((contents, permission, callback, details) => {
    // A link to another app that reached Chromium (a redirect, a frame): asked like any other.
    if (permission === 'openExternal') {
      callback(false)
      const externalURL = (details as { externalURL?: string }).externalURL
      if (externalURL) routeExternal(contents, externalURL)
      return
    }
    if (!sitePermissions) return callback(false)
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? []
    if (permission === 'media' && !capturingContents.has(contents.id)) {
      const id = contents.id
      capturingContents.add(id)
      contents.once('destroyed', () => capturingContents.delete(id))
    }
    // Answers are kept per (asking site, page it is in): an embedded frame is named with its page.
    sitePermissions.request({ origin: originOf(details.requestingUrl || contents.getURL()), topOrigin: originOf(contents.getURL()), kinds: kindsFor(permission, mediaTypes), isPrivate, owner: contents.id }, callback)
  })
  browsing.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    const mediaType = (details as { mediaType?: string }).mediaType
    const kinds = kindsFor(permission, mediaType === 'video' ? ['video'] : mediaType === 'audio' ? ['audio'] : [])
    const topOrigin = contents ? originOf(contents.getURL()) : originOf((details as { embeddingOrigin?: string }).embeddingOrigin ?? '')
    return sitePermissions?.check(originOf(requestingOrigin), kinds, isPrivate, topOrigin) === true
  })
  app.on('certificate-error', (event, webContents, url, error, certificate, callback, isMainFrame) => {
    // Refused, as before; the error page shows what was wrong with the certificate.
    if (rejectCertificateErrorForSession(event, webContents, browsing, callback) && isMainFrame !== false) {
      certificateErrors.remember(webContents.id, url, summarizeCertificate(certificate, error))
    }
  })
  servePageFiles(browsing)
  browsing.setSpellCheckerEnabled(true)
  if (process.platform !== 'darwin') {
    // macOS uses its own spell checker and languages; elsewhere, the person's preferred languages.
    const available = new Set(browsing.availableSpellCheckerLanguages)
    const preferred = app.getPreferredSystemLanguages().flatMap((code) => [code, code.split('-')[0] ?? code]).filter((code) => available.has(code))
    if (preferred.length) browsing.setSpellCheckerLanguages([...new Set(preferred)].slice(0, 3))
  }
  // Downloads manager (progress, pause/resume, list); the plain handler below only if it failed to start.
  if (browsingData) return browsingData.wireSession(partition)
  browsing.on('will-download', (_event, item) => {
    const requestedFilename = item.getFilename() || 'download'
    // "Save Link As": macOS asks where to save it.
    if (saveAsRequests.delete(item.getURLChain()[0] ?? item.getURL())) {
      item.setSaveDialogOptions({ title: 'Save Link As', defaultPath: join(app.getPath('downloads'), sanitizeDownloadFilename(requestedFilename)) })
      item.once('done', (_download, state) => {
        const path = item.getSavePath()
        if (!path) return
        emit({ type: 'download-finished', filename: path.split('/').pop() || requestedFilename, path, state })
      })
      return
    }
    let reservation: ReturnType<typeof reserveDownloadPath> | null = null
    try {
      reservation = reserveDownloadPath(app.getPath('downloads'), requestedFilename)
      item.setSavePath(reservation.path)
    } catch {
      item.cancel()
      reservation?.cleanupIfEmpty()
      emit({ type: 'download-finished', filename: sanitizeDownloadFilename(requestedFilename), path: '', state: 'interrupted' })
      return
    }
    if (!reservation) return
    item.once('done', (_download, state) => {
      if (state !== 'completed') reservation.cleanupIfEmpty()
      emit({
        type: 'download-finished',
        filename: reservation.filename,
        path: reservation.path,
        state,
      })
    })
  })
}

/** Links saved with "Save Link As", waiting for their download to start. */
const saveAsRequests = new Set<string>()

/**
 * file:// in a tab: only files opened from Finder or another app (and a saved page's own
 * "_files" folder) are served; Electron would otherwise let a local page read any file.
 */
function servePageFiles(browsing: Electron.Session): void {
  browsing.protocol.handle('file', (request) => {
    let path = ''
    try { path = fileURLToPath(request.url) } catch { /* not a file path */ }
    if (!path || !localFileGrants.allows(path)) return new Response('This file was not opened in Intoponet.', { status: 403, headers: { 'content-type': 'text/plain' } })
    return net.fetch(pathToFileURL(path).href, { bypassCustomProtocolHandlers: true })
  })
}

/** A page (or its popup) wants to open another app: ask first (externalOpen.ts). */
function routeExternal(contents: Electron.WebContents, href: string): void {
  if (!externalOpener || contents.isDestroyed()) return
  const isPrivate = contents.session === session.fromPartition(PRIVATE_PARTITION)
  const result = externalOpener.request({ href, pageUrl: contents.getURL(), isPrivate, owner: contents.id })
  if (result === 'no-app' && pageView && !viewGone(pageView) && pageView.webContents === contents) {
    const target = classifyExternalUrl(href)
    if (target.kind === 'external') emit({ type: 'navigation-failed', url: `${target.scheme}:`, reason: `No app on this Mac opens ${target.scheme}: links.` })
  }
}

/** Downloads list and browsing history (see browsingData.ts). */
let browsingData: BrowsingData | null = null
function installDownloadsAndHistory(): void {
  browsingData = installBrowsingData({
    getWindow: () => window,
    handle: handleFromShell,
    excludedSites: () => excludedSites,
    normalPartition: 'persist:intoponet-default',
    privatePartition: PRIVATE_PARTITION,
    seal: {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptStringAsync(text),
      decrypt: async (sealed) => (await safeStorage.decryptStringAsync(sealed)).result,
      encryptSync: (text) => safeStorage.encryptString(text),
      availableSync: () => safeStorage.isEncryptionAvailable(),
    },
    onDownloadDone: (entry) => emit({ type: 'download-finished', ...entry }),
  })
}

/** Icons already converted for each page (by icon address), and the newest icon each page reported. */
const tabIconMemory = new WeakMap<WebContentsView, TabIconMemory>()
const tabIconWanted = new WeakMap<WebContentsView, string>()

/**
 * A page reported its icon: the tab shows it as a small data: URL fetched through the page's own
 * session (never by the app window, which would load any address a page names).
 */
function updateTabIcon(view: WebContentsView, iconUrl: string): void {
  tabIconWanted.set(view, iconUrl)
  let memory = tabIconMemory.get(view)
  if (!memory) tabIconMemory.set(view, (memory = new TabIconMemory()))
  const apply = (data: string): void => {
    if (tabIconWanted.get(view) !== iconUrl) return
    const tab = openTabs.find((item) => item.view === view)
    if (!tab || tab.favicon === data) return
    tab.favicon = data
    emitTabs()
  }
  const known = iconUrl ? memory.get(iconUrl) : ''
  if (known !== undefined) return apply(known)
  if (viewGone(view)) return
  const pageSession = view.webContents.session
  const remembered = memory
  void fetchTabIcon(iconUrl, (url, init) => pageSession.fetch(url, init)).then((data) => {
    remembered.set(iconUrl, data)
    apply(data)
  })
}

function tabSnapshots(): PageTabSnapshot[] {
  return openTabs.map((tab) => {
    // A page closed underneath us (e.g. while the window closes) keeps what was last known.
    const live = !viewGone(tab.view)
    const currentUrl = live ? tab.view.webContents.getURL() : ''
    return {
      id: tab.id,
      // Bounded: a page's address and title can be made enormous.
      url: tab.start ? '' : capUrl(safeHttpUrl(currentUrl) ? currentUrl : tab.url),
      title: tab.start ? 'New tab' : capTitle((live ? tab.view.webContents.getTitle() : '') || tab.title || capUrl(tab.url)),
      favicon: tab.favicon,
      active: tab.id === activeTabId,
      isPrivate: privateViews.has(tab.view),
      ...(tab.start ? { isStartPage: true } : {}),
      ...liveTabFlags(live ? tab.view.webContents : null, tab),
      ...(tab.pinned && tab.home ? { home: capUrl(tab.home), ...(awayFromHome(safeHttpUrl(currentUrl) ? currentUrl : tab.url, tab.home) ? { awayFromHome: true } : {}) } : {}),
      ...(tab.asleep ? { asleep: true } : {}),
      ...(tab.lastShownAt ? { lastShownAt: tab.lastShownAt } : {}),
    }
  })
}

function isStartView(view: WebContentsView): boolean {
  return openTabs.some((tab) => tab.view === view && tab.start === true)
}

/** A new tab on the start page, made active at once (same privacy as the browsing mode). */
function createStartTab(): void {
  makeRoomForTab()
  const view = buildView(privateMode)
  const tab: OpenTab = { id: randomUUID(), url: '', title: '', favicon: '', view, start: true }
  tab.lastShownAt = Date.now()
  openTabs.push(tab)
  showTab(tab.id)
  emitPanelState()
}

/** The tab is about to load a page: stop drawing the start page and show the view. */
function leaveStartPage(view: WebContentsView): void {
  const tab = openTabs.find((item) => item.view === view)
  if (!tab?.start) return
  tab.start = false
  if (pageView === view && pageAttached) view.setVisible(pageViewShown(view))
  emitTabs()
  if (pageView === view) emitPanelState()
}

/** The address bar's own menu; "Paste and Go" reads the clipboard here, only when chosen. */
async function showAddressMenu(hasSelection: boolean): Promise<void> {
  const canPasteAndGo = pasteAndGoText(await clipboard.readText()) !== null
  if (!window || window.isDestroyed()) return
  const template = addressMenuTemplate({
    hasSelection,
    canPasteAndGo,
    onPasteAndGo: () => {
      void Promise.resolve(clipboard.readText()).then((raw) => {
        const text = pasteAndGoText(raw)
        if (text) emit({ type: 'paste-and-go', text })
      })
    },
  })
  Menu.buildFromTemplate(template).popup({ window })
}

/** Coalesced like the panel state (titles, icons and navigations of every tab arrive here). */
const emitTabs = coalesce(() => emit({ type: 'tabs', tabs: tabSnapshots() }))

function samePage(left: string, right: string): boolean {
  try {
    const a = new URL(left)
    const b = new URL(right)
    return (
      a.origin === b.origin &&
      a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '') &&
      a.search === b.search
    )
  } catch {
    return left === right
  }
}

function rememberTab(view: WebContentsView): void {
  const tab = openTabs.find((item) => item.view === view)
  if (!tab) return
  const url = view.webContents.getURL()
  const title = view.webContents.getTitle()
  if (safeHttpUrl(url)) tab.url = url
  if (title) tab.title = title
  emitTabs()
}

function detachActive(): void {
  captures?.pageChanged('tab-changed', pageView)
  if (window && pageView && pageAttached) {
    if (!viewGone(pageView)) pageView.webContents.stopFindInPage('clearSelection')
    window.contentView.removeChildView(pageView)
    pageAttached = false
    updateWindowButtons()
  }
}

function showTab(id: string): WebContentsView | null {
  const tab = openTabs.find((item) => item.id === id)
  if (!tab) return null
  if (pageView && pageView !== tab.view) detachActive()
  const now = Date.now()
  const previous = openTabs.find((item) => item.id === activeTabId)
  if (previous) previous.lastShownAt = now
  tab.lastShownAt = now
  activeTabId = tab.id
  pageView = tab.view
  const selectedUrl = tab.view.webContents.getURL()
  lastKnownUrl = safeHttpUrl(selectedUrl) ? selectedUrl : tab.url
  attachPageView()
  emitTabs()
  emitProtectionState()
  emitPasswordState()
  // A tab that loaded in the background missed its cosmetic rules and tracker stand-ins.
  if (!tab.start && !tab.view.webContents.isLoading()) void applyCosmeticFilters(tab.view.webContents)
  const current = tab.view.webContents.getURL()
  const sleep = tab.asleep
  if (sleep) {
    delete tab.asleep
    emitTabs()
  }
  if (sleep?.history && (!current || current === 'about:blank')) {
    // Woken where it was: back/forward list and scroll position (page state) restored.
    const view = tab.view
    restoringViews.add(view)
    void view.webContents.navigationHistory.restore(sleep.history)
      .catch(() => view.webContents.loadURL(tab.url))
      .catch(() => undefined)
      .finally(() => restoringViews.delete(view))
  } else if ((!current || current === 'about:blank') && safeHttpUrl(tab.url) && !restoringViews.has(tab.view) && crashRecovery.canAutoRecover(tab.id)) {
    void tab.view.webContents.loadURL(tab.url)
  }
  return tab.view
}

/** A pinned tab is away from home once it is on another site (moving around the same site is not leaving). */
function awayFromHome(current: string, home: string): boolean {
  const here = safeHttpUrl(current)
  const there = safeHttpUrl(home)
  if (!here || !there) return false
  const site = (host: string): string => host.replace(/^www\./, '')
  return site(here.hostname) !== site(there.hostname)
}

/** The tab sidebar's mode and width, saved with the tabs (null until first changed). */
let tabSidebar: TabSidebarState | null = null
/** Full width with the sidebar hidden: the pointer resting at the left edge of the page brings it back. */
let sidebarEdgeTimer: ReturnType<typeof setTimeout> | null = null

/** How long a background tab waits before sleeping (Settings › Browsing). */
let tabSleepAfter: TabSleepAfter = DEFAULT_TAB_SLEEP
/** The order ⌃Tab steps through tabs. */
let tabSwitchOrder: TabSwitchOrder = 'strip'
/** Pages that asked for the camera or microphone: they never sleep (a call in a background tab). */
const capturingContents = new Set<number>()
/** Checks may shorten a "minute" so sleeping can be seen in seconds; the app itself never sets this. */
const TAB_SLEEP_MINUTE_MS = Math.max(50, Number(process.env['INTOPONET_TAB_SLEEP_MINUTE_MS']) || 60_000)
let sleepingNow = false

/** ⌃Tab in recently-used order (tabSwitcher.ts); its list is a small native view over the page. */
const tabSwitcher = new TabSwitcher()
let switcherView: WebContentsView | null = null
let switcherIdle: ReturnType<typeof setTimeout> | null = null

function switcherTabs(): SwitcherTab[] {
  return openTabs.map((tab) => {
    const live = !viewGone(tab.view)
    return {
      id: tab.id,
      title: tab.start ? 'New tab' : (live ? tab.view.webContents.getTitle() : '') || tab.title,
      url: tab.start ? '' : (live && safeHttpUrl(tab.view.webContents.getURL()) ? tab.view.webContents.getURL() : tab.url),
      favicon: tab.favicon,
      lastShownAt: tab.lastShownAt ?? 0,
      isPrivate: privateViews.has(tab.view),
    }
  })
}

function hideSwitcher(): void {
  if (switcherIdle) clearTimeout(switcherIdle)
  switcherIdle = null
  if (switcherView && window && !window.isDestroyed()) window.contentView.removeChildView(switcherView)
  emit({ type: 'tab-switcher', open: false })
}

function stepTabSwitcher(direction: 'next' | 'previous'): void {
  if (!window || window.isDestroyed()) return
  const tabs = switcherTabs()
  const opening = !tabSwitcher.open
  const step = tabSwitcher.step(tabs, activeTabId, direction)
  if (!step) {
    hideSwitcher()
    return
  }
  if (!switcherView || viewGone(switcherView)) {
    // A static page: no script, no navigation, never focused (keys stay with the page or the shell).
    switcherView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, spellcheck: false } })
    switcherView.setBackgroundColor('#00000000')
    switcherView.webContents.on('will-navigate', (event) => event.preventDefault())
    switcherView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }
  const view = switcherView
  const { width, height } = window.getContentBounds()
  const rows = Math.min(step.order.length, SWITCHER_ROWS)
  const boxWidth = Math.min(520, width - 80)
  const boxHeight = rows * SWITCHER_ROW_HEIGHT + 18
  view.setBounds({ x: Math.round((width - boxWidth) / 2), y: Math.max(80, Math.round((height - boxHeight) / 2) - 40), width: boxWidth, height: boxHeight })
  void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(switcherHtml(tabs, step.order, step.index))}`).catch(() => undefined)
  // On top of everything (adding again moves it to the front).
  window.contentView.addChildView(view)
  const chosen = tabs.find((tab) => tab.id === step.order[step.index])
  emit({ type: 'tab-switcher', open: true, selected: chosen?.title || chosen?.url || 'Untitled page', position: step.index + 1, count: step.order.length })
  // Keys are with the page: it tells when ⌃ is released (or Escape pressed).
  const page = pageView
  if (opening && page && pageAttached && !viewGone(page)) {
    void page.webContents.executeJavaScriptInIsolatedWorld(KEYS_WORLD_ID, [{ code: SWITCHER_KEYS_SCRIPT }])
      .then((result: unknown) => { if (result === 'commit' || result === 'cancel') endTabSwitcher(result) })
      .catch(() => undefined)
  }
  // If ⌃'s release is never seen (the key went to another app), finish on its own.
  if (switcherIdle) clearTimeout(switcherIdle)
  switcherIdle = setTimeout(() => endTabSwitcher('commit'), 4_000)
}

function endTabSwitcher(action: 'commit' | 'cancel'): void {
  if (!tabSwitcher.open) return
  const chosen = action === 'commit' ? tabSwitcher.commit() : (tabSwitcher.cancel(), null)
  hideSwitcher()
  if (chosen && chosen !== activeTabId) showTab(chosen)
  else if (chosen && !pageAttached) showTab(chosen)
}

/** Puts background tabs that have been out of sight long enough to sleep (see tabSleep.ts). */
async function sleepIdleTabs(): Promise<void> {
  if (sleepingNow) return
  sleepingNow = true
  try {
    const now = Date.now()
    const due = tabsDueForSleep(openTabs.map((tab) => {
      const live = !viewGone(tab.view)
      const contentsId = live ? tab.view.webContents.id : -1
      return {
        id: tab.id,
        active: tab.id === activeTabId,
        asleep: !!tab.asleep || !live,
        start: !!tab.start || !!tab.loadError,
        lastShownAt: tab.lastShownAt ?? now,
        audible: live && tab.view.webContents.isCurrentlyAudible(),
        capturing: capturingContents.has(contentsId),
        downloading: live && (browsingData?.downloads.activeForPage(String(contentsId)) ?? false),
      }
    }), now, sleepAfterMs(tabSleepAfter, TAB_SLEEP_MINUTE_MS))
    for (const id of due) {
      const tab = openTabs.find((item) => item.id === id)
      if (!tab || viewGone(tab.view)) continue
      // Typed text not yet sent keeps a tab awake (it would be lost); so does a page that will not answer.
      const typed = await tab.view.webContents.executeJavaScriptInIsolatedWorld(KEYS_WORLD_ID, [{ code: TYPED_FORM_SCRIPT }]).catch(() => true)
      if (typed !== false || tab.id === activeTabId || tab.asleep) continue
      unloadTab(tab, { keepHistory: true })
    }
  } finally {
    sleepingNow = false
  }
}

/**
 * Unloads a tab but keeps it in place: its page is closed and a blank view takes its place, loaded
 * again when the tab is next shown. With `keepHistory` it wakes where it was (back/forward list and
 * scroll); without, it starts again at `url`. The tab must not be the one showing.
 */
function unloadTab(tab: OpenTab, options: { keepHistory: boolean; url?: string }): void {
  if (tab.start || tab.asleep || viewGone(tab.view) || pageView === tab.view) return
  const old = tab.view
  const liveUrl = old.webContents.getURL()
  let history: TabHistory | undefined
  if (options.keepHistory) {
    try {
      history = boundedHistory({ entries: old.webContents.navigationHistory.getAllEntries(), index: old.webContents.navigationHistory.getActiveIndex() })
    } catch {
      history = undefined
    }
  }
  tab.url = options.url ?? (safeHttpUrl(liveUrl) ? liveUrl : tab.url)
  tab.title = old.webContents.getTitle() || tab.title
  delete tab.loadError
  // The tab holds the replacement first, so closing the old page does not close the tab.
  tab.view = buildView(privateViews.has(old))
  tab.asleep = history ? { history } : {}
  const contentsId = viewContentsIds.get(old)
  if (contentsId !== undefined) {
    protectionPages.remove(contentsId)
    translateService?.forgetPage(contentsId)
  }
  setImmediate(() => { if (!viewGone(old)) old.webContents.close() })
  emitTabs()
  schedulePersistentStateSave()
}

/**
 * Closing a tab (⌘W, its close button, middle-click). A pinned tab is only unloaded, back at its
 * home, and stays in place; any other tab closes. The tab showing hands over to its neighbour.
 */
function closeTab(id: string): void {
  const index = openTabs.findIndex((tab) => tab.id === id)
  const tab = openTabs[index]
  if (!tab) return
  const showing = pageAttached && activeTabId === id
  if (!tab.pinned || !tab.home) {
    discardTab(id)
    if (showing) {
      const next = openTabs[index] ?? openTabs[index - 1]
      if (next) showTab(next.id)
    }
    return
  }
  if (tab.asleep) return
  if (activeTabId === id) {
    const next = openTabs.find((other, at) => at > index && other.id !== id) ?? [...openTabs].reverse().find((other) => other.id !== id)
    if (showing && next) showTab(next.id)
    else {
      detachActive()
      pageView = null
      activeTabId = null
    }
  }
  unloadTab(tab, { keepHistory: false, url: tab.home })
  emitPanelState()
}

function discardTab(id: string): void {
  const index = openTabs.findIndex((tab) => tab.id === id)
  if (index < 0) return
  const [tab] = openTabs.splice(index, 1)
  if (!tab) return
  rememberClosedTab(tab)
  crashRecovery.forget(tab.id)
  if (pageView === tab.view) {
    detachActive()
    pageView = null
    activeTabId = null
    lastKnownUrl = ''
    tabDockOpen = false
  }
  const contentsId = viewContentsIds.get(tab.view)
  if (contentsId !== undefined) {
    protectionPages.remove(contentsId)
    translateService?.forgetPage(contentsId)
  }
  if (!viewGone(tab.view)) tab.view.webContents.close()
  emitTabs()
  emitPanelState()
  emitPasswordState()
  schedulePersistentStateSave()
}

function makeRoomForTab(): void {
  while (openTabs.length >= MAX_TABS) {
    const victim = openTabs.find((tab) => tab.id !== activeTabId && !tab.pinned) ?? openTabs.find((tab) => tab.id !== activeTabId) ?? openTabs[0]
    if (!victim) return
    discardTab(victim.id)
  }
}

/** Each view's webContents id, readable after the contents is destroyed. */
const viewContentsIds = new WeakMap<WebContentsView, number>()

const popupLimiter = new PopupLimiter()
/** When each page was last clicked or typed in: pages open tabs and windows only right after. */
const userActivation = new UserActivation()

/** Most tabs open at once; a page asking for more is refused rather than closing your tabs. */
const MAX_TABS = 12

/**
 * A page asked for a tab or window without a click or key press first. A site always allowed
 * pop-ups gets it (as a tab); otherwise it is blocked and the bar offers to open it.
 */
function blockedPopup(opener: WebContentsView, url: string): void {
  const target = safeHttpUrl(url)
  if (!target || !sitePermissions || viewGone(opener)) return
  const contents = opener.webContents
  const isPrivate = privateViews.has(opener)
  sitePermissions.request({ origin: originOf(contents.getURL()), kinds: ['popups'], isPrivate, owner: contents.id }, (granted) => {
    if (!granted || viewGone(opener) || !popupLimiter.allow(contents.id)) return
    const tab = createBrowserTab(target.toString(), true, isPrivate, true)
    if (tab) void tab.webContents.loadURL(target.toString()).catch(() => undefined)
  })
}

/** Whether this site was always allowed pop-ups (the bar's "Always for this site"). */
function popupsAllowed(contents: Electron.WebContents, isPrivate: boolean): boolean {
  return sitePermissions?.check(originOf(contents.getURL()), ['popups'], isPrivate) === true
}
const crashRecovery = new CrashRecoveryPolicy()

/** A popup window opened by a page: http(s) only, nested popups become tabs, closes with its page. */
function wirePopupWindow(child: BrowserWindow, opener: WebContentsView): void {
  bindPermissionOwnerLifecycle(child.webContents, (owner) => sitePermissions?.dropOwner(owner))
  child.webContents.on('will-navigate', (event, url) => {
    if (safeHttpUrl(url)) return
    event.preventDefault()
    routeExternal(child.webContents, url)
  })
  bindLeavePrompt(child.webContents, () => child, dialog.showMessageBoxSync)
  guardPopupWindow(child)
  const childContentsId = child.webContents.id
  trackUserActivation(child.webContents, userActivation)
  child.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
    const activated = userActivation.consume(childContentsId)
    const plan = nestedPopupDecision({ url, disposition, features }, popupLimiter, childContentsId, Date.now(), activated)
    if (plan.action === 'deny') {
      if (!plan.withoutGesture) emit({ type: 'navigation-failed', url, reason: plan.reason })
      return { action: 'deny' }
    }
    const tab = createBrowserTab(url, true, privateViews.has(opener), true)
    if (tab) void tab.webContents.loadURL(url).catch(() => undefined)
    return { action: 'deny' }
  })
  child.webContents.once('destroyed', () => popupLimiter.forget(childContentsId))
  bindPopupCloseWithOwner(child, opener.webContents)
}

function createBrowserTab(urlValue: string, activate = true, isPrivate = privateMode, openedByPage = false, localFile = false): WebContentsView | null {
  // A local file only when it was opened from Finder or another app (see openIncoming).
  const url = safeHttpUrl(urlValue) ?? (localFile && urlValue.startsWith('file:') ? new URL(urlValue) : null)
  if (!url) return null
  // A page never closes your tabs to make room for its own.
  if (openedByPage && openTabs.length >= MAX_TABS) {
    emit({ type: 'navigation-failed', url: url.toString(), reason: `A page tried to open another tab, but ${MAX_TABS} tabs are already open. Close a tab and try again.` })
    return null
  }
  makeRoomForTab()
  const view = buildView(isPrivate)
  const tab: OpenTab = { id: randomUUID(), url: url.toString(), title: '', favicon: '', view }
  tab.lastShownAt = Date.now()
  openTabs.push(tab)
  if (activate) {
    showTab(tab.id)
    lastKnownUrl = url.toString()
  } else {
    emitTabs()
  }
  schedulePersistentStateSave()
  return view
}

function contextMenuTemplate(view: WebContentsView, params: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
  const actions = browserContextActions({
    linkURL: params.linkURL,
    srcURL: params.srcURL,
    mediaType: params.mediaType,
    hasImageContents: params.hasImageContents,
    isEditable: params.isEditable,
    selectionText: params.selectionText,
    canGoBack: view.webContents.navigationHistory.canGoBack(),
    canGoForward: view.webContents.navigationHistory.canGoForward(),
  })
  const items: MenuItemConstructorOptions[] = []
  const has = (action: BrowserContextAction): boolean => actions.includes(action)
  const linkUrl = safeHttpUrl(params.linkURL)?.toString()
  const imageUrl = safeHttpUrl(params.srcURL)?.toString()

  if (has('open-link-in-new-tab') && linkUrl) {
    items.push({ label: 'Open Link in New Tab', click: () => {
      const newView = createBrowserTab(linkUrl, true, privateViews.has(view))
      if (newView) void newView.webContents.loadURL(linkUrl)
    } })
  }
  if (has('copy-link-address') && linkUrl) {
    items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(linkUrl) })
  }
  if (has('open-link-in-new-tab') || has('copy-link-address')) items.push({ type: 'separator' })

  // Keep a highlighted passage (a statistic, a quote, a description) in your private knowledge.
  if (has('copy-selection') && !privateViews.has(view) && !params.isEditable && params.selectionText.trim().split(/\s+/).length >= 3) {
    items.push({ label: 'Absorb Selection', click: () => emit({ type: 'shortcut', action: 'absorb-selection' }) })
  }
  if (has('copy-selection')) items.push({ label: 'Copy', role: 'copy' })
  if (has('cut')) items.push({ label: 'Cut', role: 'cut' })
  if (has('paste')) items.push({ label: 'Paste', role: 'paste' })
  if (has('select-all')) items.push({ label: 'Select All', role: 'selectAll' })
  if (has('copy-selection') || has('cut') || has('paste') || has('select-all')) items.push({ type: 'separator' })

  if (has('copy-image')) {
    items.push({ label: 'Copy Image', click: () => view.webContents.copyImageAt(params.x, params.y) })
  }
  if (has('copy-image-address') && imageUrl) {
    items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(imageUrl) })
  }
  if (has('save-image') && imageUrl) {
    items.push({ label: 'Save Image to Downloads', click: () => view.webContents.downloadURL(imageUrl) })
  }
  if (has('copy-image') || has('copy-image-address') || has('save-image')) items.push({ type: 'separator' })

  items.push(...moreContextItems(view, params))
  if (!params.isEditable && !linkUrl && params.mediaType === 'none' && !params.selectionText.trim()) {
    items.push({ label: 'Save Page as PDF', accelerator: 'CmdOrCtrl+Alt+E', click: () => void runPdfExport(view) }, { type: 'separator' })
  }

  if (has('back')) items.push({ label: 'Back', click: () => view.webContents.navigationHistory.goBack() })
  if (has('forward')) items.push({ label: 'Forward', click: () => view.webContents.navigationHistory.goForward() })
  if (has('reload')) items.push({ label: 'Reload', click: () => view.webContents.reload() })
  if (has('inspect')) items.push({ type: 'separator' }, { label: 'Inspect', click: () => inspectPage(view, { x: params.x, y: params.y }) })
  return items.filter((item, index) => item.type !== 'separator' || (
    index > 0 && index < items.length - 1 && items[index - 1]?.type !== 'separator'
  ))
}

/**
 * Spelling suggestions, Search Web for the selection, Open Link in Private Tab, Save Link As,
 * Open Image in New Tab. Spelling goes first in the menu, as in other Mac apps.
 */
function moreContextItems(view: WebContentsView, params: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
  const isPrivate = privateViews.has(view)
  const extras = browserContextExtras({
    linkURL: params.linkURL,
    srcURL: params.srcURL,
    mediaType: params.mediaType,
    isEditable: params.isEditable,
    selectionText: params.selectionText,
    misspelledWord: params.misspelledWord,
    dictionarySuggestions: params.dictionarySuggestions,
    isPrivate,
  })
  const items: MenuItemConstructorOptions[] = []
  const linkUrl = safeHttpUrl(params.linkURL)?.toString()
  const imageUrl = safeHttpUrl(params.srcURL)?.toString()
  const openInTab = (url: string, privately: boolean): void => {
    const tab = createBrowserTab(url, true, privately)
    if (tab) void tab.webContents.loadURL(url).catch(() => undefined)
  }
  if (extras.openLinkInPrivateTab && linkUrl) items.push({ label: 'Open Link in Private Tab', click: () => openInTab(linkUrl, true) })
  if (extras.saveLinkAs && linkUrl) {
    items.push({ label: 'Save Link As…', click: () => {
      saveAsRequests.add(linkUrl)
      view.webContents.downloadURL(linkUrl)
    } })
  }
  if (extras.openImageInNewTab && imageUrl) items.push({ label: 'Open Image in New Tab', click: () => openInTab(imageUrl, isPrivate) })
  if (extras.searchSelection) {
    const query = extras.searchSelection
    items.push({ label: searchSelectionLabel(query), click: () => openInTab(resolveNavigationIntent({ kind: 'search', value: query }), isPrivate) })
  }
  if (items.length) items.push({ type: 'separator' })
  return items
}

/** Suggestions for a misspelled word, then Add to Dictionary: they go at the top of the menu. */
function spellingContextItems(view: WebContentsView, params: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
  const extras = browserContextExtras({
    linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isPrivate: false,
    isEditable: params.isEditable,
    misspelledWord: params.misspelledWord,
    dictionarySuggestions: params.dictionarySuggestions,
  })
  if (!extras.spelling) return []
  const { word, suggestions } = extras.spelling
  const items: MenuItemConstructorOptions[] = suggestions.length
    ? suggestions.map((suggestion) => ({ label: suggestion, click: () => view.webContents.replaceMisspelling(suggestion) }))
    : [{ label: 'No Guesses Found', enabled: false }]
  items.push({ label: 'Add to Dictionary', click: () => view.webContents.session.addWordToSpellCheckerDictionary(word) })
  items.push({ type: 'separator' })
  return items
}

function buildView(isPrivate = privateMode): WebContentsView {
  let frequencyNavigation = 0
  let frequencyLoadSucceeded = false
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...SAFE_DIALOG_PREFERENCES,
      // PDF links open in Chromium's built-in viewer without `plugins: true` (Electron 45; the
      // PDF_VIEWER feature check proves it), so plugins stay off.
      spellcheck: true,
      session: session.fromPartition(isPrivate ? PRIVATE_PARTITION : 'persist:intoponet-default'),
      // The sign-in helper for saved passwords; private tabs never get it.
      ...(isPrivate ? {} : { preload: join(__dirname, '../preload/page.js') }),
    },
  })
  if (isPrivate) privateViews.add(view)
  browsingData?.attachPage(view.webContents, () => privateViews.has(view))

  // Behind a page before it paints: light, or dark when pages are dark (no white flash at night).
  view.setBackgroundColor(pageAppearance.current === 'dark' || (pageAppearance.current === 'system' && nativeTheme.shouldUseDarkColors) ? '#202124' : '#ffffff')
  // Once a page is there, the canvas behind it is white as in any browser: a page that sets no
  // background of its own expects white, and one that is dark (color-scheme) gets a dark canvas from Chromium.
  view.webContents.once('dom-ready', () => { if (!view.webContents.isDestroyed()) view.setBackgroundColor('#ffffff') })
  view.webContents.setWebRTCIPHandlingPolicy(WEBRTC_POLICY)
  view.webContents.on('before-mouse-event', (_event, input) => {
    if (shouldCloseTabDockFromNativeMouse({
      isActivePage: pageView === view,
      fullWidth: browserFullWidth,
      dockOpen: tabDockOpen,
      eventType: input.type,
      held: tabDockHeld,
    })) {
      setBrowserTabDockOpen(false)
      emit({ type: 'tab-dock-state', open: false })
    }
    if (shouldHideChromeFromNativeMouse({
      isActivePage: pageView === view,
      fullWidth: browserFullWidth,
      revealed: chromeRevealed,
      held: chromeHeld,
      eventType: input.type,
    })) {
      setChromeRevealed(false)
      emit({ type: 'chrome-state', revealed: false })
    }
    if (pageView === view && input.type === 'mouseMove' && browserFullWidth && tabSidebar?.mode === 'hidden') {
      const atEdge = (input as { x?: number }).x !== undefined && ((input as { x: number }).x <= 4)
      if (!atEdge && sidebarEdgeTimer) {
        clearTimeout(sidebarEdgeTimer)
        sidebarEdgeTimer = null
      } else if (atEdge && !sidebarEdgeTimer) {
        sidebarEdgeTimer = setTimeout(() => {
          sidebarEdgeTimer = null
          emit({ type: 'tab-sidebar-edge' })
        }, 300)
      }
    }
    if (tabRailExpanded && pageView === view && (input.type === 'mouseMove' || input.type === 'mouseDown')) {
      tabRailExpanded = false
      emit({ type: 'tab-rail-state', expanded: false })
    }
  })
  // Browser keys pressed in a page: carried out here, so a page cannot swallow them. preventDefault
  // also keeps the menu bar from running the same key a second time.
  view.webContents.on('before-input-event', (event, input) => {
    // Esc always leaves a page's fullscreen (the page cannot keep it for itself).
    if (htmlFullScreenView === view && input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      void view.webContents.executeJavaScriptInIsolatedWorld(FULLSCREEN_WORLD_ID, [{ code: EXIT_FULLSCREEN_SCRIPT }]).catch(() => undefined)
      return
    }
    if (tabSwitcher.open) {
      // Releasing ⌃ shows the highlighted tab; Escape keeps the current one.
      if (input.type === 'keyUp' && input.key === 'Control') {
        endTabSwitcher('commit')
        return
      }
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        endTabSwitcher('cancel')
        return
      }
    }
    if (pageView !== view) return
    // Escape stops a page still loading; the page gets the key as well.
    if (isPlainEscape(input) && view.webContents.isLoading()) view.webContents.stop()
    const action = pageKeyAction(input, { developer: developerBuild() })
    if (!action) return
    if (action.kind === 'command' && TEXT_FIELD_FIRST.has(action.command.type)) {
      // The page keeps the key; the browser acts only when no text field (or editor frame) has focus.
      const command = action.command
      void view.webContents.executeJavaScriptInIsolatedWorld(KEYS_WORLD_ID, [{ code: FOCUS_TAKES_TYPING_SCRIPT }])
        .then((typing: unknown) => { if (typing !== true && pageView === view) runAppCommand(command) })
        .catch(() => undefined)
      return
    }
    event.preventDefault()
    if (action.kind === 'command') runAppCommand(action.command)
    else showShellShortcut(action.action)
  })
  // ⌘/Ctrl + scroll wheel zooms like ⌘+ and ⌘−.
  view.webContents.on('zoom-changed', (_event, direction) => {
    if (pageView === view) void handleBrowserCommand({ type: 'zoom', action: direction === 'in' ? 'in' : 'out' })
  })
  view.webContents.on('context-menu', (event, params) => {
    if (viewGone(view) || !window || window.isDestroyed()) return
    const template = [...spellingContextItems(view, params), ...contextMenuTemplate(view, params)]
    if (template.length === 0) return
    event.preventDefault()
    Menu.buildFromTemplate(template).popup({ window })
  })
  view.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (!mainFrame || inPlace) return
    leaveStartPage(view)
    translateService?.forgetPage(view.webContents.id)
    frequencyNavigation += 1
    frequencyLoadSucceeded = false
  })
  view.webContents.on('did-navigate', (_event, _url, responseCode) => {
    frequencyLoadSucceeded = responseCode >= 200 && responseCode < 400
  })
  view.webContents.on('did-fail-load', (_event, _code, _description, _url, mainFrame) => {
    if (mainFrame) frequencyLoadSucceeded = false
  })
  view.webContents.on('did-finish-load', () => {
    if (pageView !== view || !frequencyLoadSucceeded) return
    const url = view.webContents.getURL()
    const generation = frequencyNavigation
    if (!safeHttpUrl(url)) return
    // Read only rating declarations locally. These untrusted hints can exclude
    // content; their absence is never a certification that a page is suitable.
    // In an isolated world: the page's own scripts cannot see or tamper with the reader.
    void view.webContents.executeJavaScriptInIsolatedWorld(RATING_WORLD_ID, [{ code: `(() => {
      const values = [];
      for (const node of Array.from(document.querySelectorAll('meta[name="rating"], meta[itemprop="contentRating"], meta[property="og:restrictions:age"], [itemprop="contentRating"]')).slice(0, 20)) {
        values.push((node.getAttribute('content') || node.textContent || '').slice(0, 120));
      }
      for (const node of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 10)) {
        const source = (node.textContent || '').slice(0, 32000);
        for (const match of source.matchAll(/"contentRating"\\s*:\\s*"([^"\\n]{1,120})"/g)) values.push(match[1]);
      }
      return values.join(' | ').slice(0, 1000);
    })()` }]).then((rating: unknown) => {
      if (viewGone(view) || pageView !== view || !frequencyLoadSucceeded || generation !== frequencyNavigation || url !== view.webContents.getURL()) return
      // Private tabs and excluded sites leave no footprints and no interest signals.
      if (privateViews.has(view) || isExcludedSite(url, excludedSites)) return
      emit({ type: 'frequency-visit', url, title: view.webContents.getTitle().slice(0, 1000),
        rating: typeof rating === 'string' && rating ? rating.slice(0, 1000) : null,
        navigationId: `${view.webContents.id}:${generation}` })
    }).catch(() => { /* No activity is recorded when rating extraction fails. */ })
  })
  pageAppearance.watch(view.webContents)
  bindLeavePrompt(view.webContents, () => window, dialog.showMessageBoxSync)
  trackUserActivation(view.webContents, userActivation)
  view.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
    // A link to another app (mailto:, zoommtg:…) opened in a new window: asked, never a window.
    if (classifyExternalUrl(url).kind === 'external') {
      routeExternal(view.webContents, url)
      return { action: 'deny' }
    }
    // Only right after a click or key press in the page (or for a site always allowed pop-ups).
    const activated = userActivation.consume(view.webContents.id) || popupsAllowed(view.webContents, privateViews.has(view))
    const plan = popupDecision({ url, disposition, features }, popupLimiter, view.webContents.id, Date.now(), activated)
    if (plan.action === 'deny') {
      if (plan.withoutGesture) blockedPopup(view, url)
      else emit({ type: 'navigation-failed', url, reason: plan.reason })
      return { action: 'deny' }
    }
    if (plan.action === 'tab') {
      // Same privacy as the page that opened it.
      const tab = createBrowserTab(url, !plan.background, privateViews.has(view), true)
      if (tab) void tab.webContents.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    }
    // Sign-in style popup: a small real window that keeps window.opener (same session as its page).
    return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions(plan, window) }
  })
  view.webContents.on('did-create-window', (child) => wirePopupWindow(child, view))
  // Capture the id now: by the time 'destroyed' fires, view.webContents is gone.
  const contentsId = view.webContents.id
  viewContentsIds.set(view, contentsId)
  view.webContents.once('destroyed', () => {
    popupLimiter.forget(contentsId)
    externalOpener?.dropOwner(contentsId)
    passwords?.forget(contentsId)
    // The page closed itself (window.close()) or its contents went away: drop its tab, unless the
    // whole window is closing (then the tabs are kept to be restored next launch).
    if (shellClosing) return
    const tab = openTabs.find((item) => item.view === view)
    if (tab) discardTab(tab.id)
  })
  bindPermissionOwnerLifecycle(view.webContents, (owner) => sitePermissions?.dropOwner(owner))
  view.webContents.on('will-navigate', (event, url) => {
    if (safeHttpUrl(url)) return
    event.preventDefault()
    // mailto:, tel:, zoommtg:… ask "Open <app>?"; file:, javascript: and the like stay refused.
    routeExternal(view.webContents, url)
  })
  view.webContents.on('did-start-loading', () => {
    emitTabs()
    if (pageView === view) emitPanelState()
  })
  // The tab's speaker icon.
  view.webContents.on('audio-state-changed', () => emitTabs())
  view.webContents.on('did-stop-loading', () => {
    rememberTab(view)
    if (pageView !== view) return
    emitPanelState()
    // Any frame the per-frame events missed.
    void applyCosmeticFilters(view.webContents, { onlyNew: true })
  })
  view.webContents.on('did-frame-navigate', (_event, _url, _code, _status, isMainFrame, frameProcessId, frameRoutingId) => {
    forgetCosmeticFrame(view.webContents, isMainFrame, frameProcessId, frameRoutingId)
  })
  view.webContents.on('did-frame-finish-load', (_event, _isMainFrame, frameProcessId, frameRoutingId) => {
    if (pageView !== view) return
    const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
    if (frame) void applyCosmeticFilters(view.webContents, { only: frame })
  })
  // HTML fullscreen (video, games): the window goes fullscreen and the page view must fill it.
  view.webContents.on('enter-html-full-screen', () => {
    htmlFullScreenView = view
    applyPageViewBounds()
    // The page now covers the toolbar: say which site it is and how to leave.
    removeFullscreenNotice?.()
    removeFullscreenNotice = window && !window.isDestroyed() ? showFullscreenNotice(window, fullscreenSiteName(view.webContents.getURL())) : null
  })
  view.webContents.on('leave-html-full-screen', () => {
    if (htmlFullScreenView === view) htmlFullScreenView = null
    removeFullscreenNotice?.()
    removeFullscreenNotice = null
    applyPageViewBounds()
  })
  // Early as well, so a banner clicked before the page finishes loading already works.
  view.webContents.on('dom-ready', () => {
    if (pageView !== view) return
    void applyCosmeticFilters(view.webContents, { only: view.webContents.mainFrame })
  })
  view.webContents.on('did-navigate', (_event, url) => {
    applySiteZoom(view, url)
    setLoadError(view, null)
    rememberTab(view)
    protectionPages.commitNavigation(view.webContents.id, url)
    passwords?.navigated(view.webContents.id)
    if (pageView !== view) return
    emitPasswordState()
    lastKnownUrl = url
    schedulePersistentStateSave()
    emitPanelState()
    emitProtectionState()
  })
  view.webContents.on('did-navigate-in-page', (_event, url) => {
    rememberTab(view)
    if (pageView !== view) return
    lastKnownUrl = url
    schedulePersistentStateSave()
    emitPanelState()
  })
  view.webContents.on('page-title-updated', () => {
    rememberTab(view)
    if (pageView === view) emitPanelState()
  })
  view.webContents.on('page-favicon-updated', (_event, favicons) => {
    // Private tabs leave nothing in favicons.json.
    if (favicons[0] && !privateViews.has(view)) faviconCache?.remember(view.webContents.getURL(), favicons[0])
    updateTabIcon(view, favicons[0] ?? '')
  })
  view.webContents.on('found-in-page', (_event, result) => {
    if (pageView !== view) return
    emit({
      type: 'find-result',
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate,
    })
  })
  view.webContents.on(
    'did-fail-load',
    (_event, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame) return
      const tab = openTabs.find((item) => item.view === view)
      protectionPages.failNavigation(
        view.webContents.id,
        validatedUrl,
        view.webContents.getURL() || tab?.url || '',
      )
      // The tab shows its error page (with Retry) instead of a passing banner.
      if (showsErrorPage(code, validatedUrl)) {
        const certificate = isCertificateError(code) ? certificateErrors.take(view.webContents.id, validatedUrl) : undefined
        setLoadError(view, classifyLoadError({ code, description, url: validatedUrl, online: net.isOnline(), ...(certificate ? { certificate } : {}) }))
        return
      }
      if (code === -3 || pageView !== view) return
      emit({
        type: 'navigation-failed',
        url: validatedUrl,
        reason: navigationFailureReason(code, description),
      })
    },
  )
  view.webContents.on('render-process-gone', (_event, details) => {
    const tab = openTabs.find((item) => item.view === view)
    const currentUrl = view.webContents.getURL()
    const crashedUrl = safeHttpUrl(currentUrl) ? currentUrl : tab?.url || lastKnownUrl
    const mayAutoRecover = tab ? crashRecovery.recordCrash(tab.id) : false
    if (pageView === view) detachActive()
    if (pageView === view) pageView = null
    protectionPages.remove(view.webContents.id)
    emit({
      type: 'navigation-failed',
      url: crashedUrl,
      reason: mayAutoRecover
        ? `The page renderer stopped (${details.reason}). Reloading once.`
        : `The page renderer stopped (${details.reason}). Automatic reload is paused after repeated crashes. Use Reload to try again.`,
    })
    if (!tab || !safeHttpUrl(crashedUrl)) return
    const replacement = buildView(privateViews.has(view))
    tab.view = replacement
    tab.url = crashedUrl
    delete tab.loadError
    if (activeTabId === tab.id) {
      pageView = replacement
      lastKnownUrl = crashedUrl
      attachPageView()
      if (mayAutoRecover) void replacement.webContents.loadURL(crashedUrl)
    }
    emitTabs()
    // Close the crashed contents so its 'destroyed' cleanup runs and its listeners go (the tab now
    // holds the replacement, so this does not close the tab). After this event has finished.
    setImmediate(() => { if (!viewGone(view)) view.webContents.close() })
  })

  return view
}

/** A tab context menu choice (see tabMenu.ts). Closing goes through 'close-tab', as the close button does. */
async function runTabMenuAction(action: TabMenuAction, id: string): Promise<void> {
  const tab = openTabs.find((item) => item.id === id)
  if (!tab) return
  const live = !viewGone(tab.view)
  const url = live && safeHttpUrl(tab.view.webContents.getURL()) ? tab.view.webContents.getURL() : tab.url
  switch (action) {
    case 'reload':
      if (activeTabId === id) await handleBrowserCommand({ type: 'reload' })
      else if (live) tab.view.webContents.reload()
      break
    case 'duplicate': {
      if (!safeHttpUrl(url)) break
      const at = duplicateIndex(openTabs, id)
      // A private tab's duplicate stays private.
      const view = createBrowserTab(url, true, privateViews.has(tab.view))
      const copy = view && openTabs.find((item) => item.view === view)
      if (copy) await handleBrowserCommand({ type: 'move-tab', id: copy.id, toIndex: at })
      if (view) void view.webContents.loadURL(url).catch(() => undefined)
      break
    }
    case 'pin':
    case 'unpin':
      await handleBrowserCommand({ type: 'set-tab-pinned', id, pinned: action === 'pin' })
      break
    case 'mute':
    case 'unmute':
      await handleBrowserCommand({ type: 'set-tab-muted', id, muted: action === 'mute' })
      break
    case 'copy-link':
      if (safeHttpUrl(url)) clipboard.writeText(url)
      break
    case 'close': {
      // From the menu, a pinned tab is removed (its close button only unloads it).
      const showing = pageAttached && activeTabId === id
      const index = openTabs.findIndex((item) => item.id === id)
      discardTab(id)
      const next = openTabs[index] ?? openTabs[index - 1]
      if (showing && next) showTab(next.id)
      break
    }
    case 'go-home':
      await handleBrowserCommand({ type: 'tab-home', id })
      break
    case 'close-others':
    case 'close-right':
      for (const other of action === 'close-others' ? otherTabIds(openTabs, id) : tabIdsToRight(openTabs, id)) {
        await handleBrowserCommand({ type: 'close-tab', id: other })
      }
      break
  }
}

/** A shell shortcut for the app window's interface: it takes keyboard focus from the page first. */
function showShellShortcut(action: ShellShortcut): void {
  if (!window || window.isDestroyed()) return
  window.webContents.focus()
  emit({ type: 'shortcut', action })
}

/** A menu bar command, or the same key pressed inside a page. */
function runAppCommand(command: AppCommand): void {
  const route = routeAppCommand(command)
  if (route.kind === 'shell') return showShellShortcut(route.action)
  if (route.kind === 'host') {
    handleBrowserCommand(route.command).catch((error: unknown) => {
      console.error(`Intoponet: ${command.type} did not finish:`, error)
    })
    return
  }
  if (route.action === 'show-history') return openHistoryPane()
  if (route.action === 'inspect-page') {
    if (pageView && pageAttached && !viewGone(pageView) && !isStartView(pageView)) inspectPage(pageView)
    return
  }
  if (route.action === 'shell-devtools' && developerBuild() && window && !window.isDestroyed()) window.webContents.toggleDevTools()
}

/** Development runs (not the packaged app) also get the app window's own developer tools. */
function developerBuild(): boolean {
  return !app.isPackaged || !!process.env['ELECTRON_RENDERER_URL']
}

/** The page's developer tools, in their own window; with a point, that element is selected. */
function inspectPage(view: WebContentsView, at?: { x: number; y: number }): void {
  if (viewGone(view)) return
  const contents = view.webContents
  if (!contents.isDevToolsOpened()) contents.openDevTools({ mode: 'detach' })
  else if (!at) contents.devToolsWebContents?.focus()
  if (at) contents.inspectElement(Math.round(at.x), Math.round(at.y))
}

/** A closing tab joins Recently Closed (with its back/forward list), unless it is private or a start page. */
function rememberClosedTab(tab: OpenTab): void {
  if (tab.start || privateViews.has(tab.view)) return
  const live = !viewGone(tab.view)
  const liveUrl = live ? tab.view.webContents.getURL() : ''
  let history: { entries: Electron.NavigationEntry[]; index: number } | undefined
  if (live) {
    try {
      history = { entries: tab.view.webContents.navigationHistory.getAllEntries(), index: tab.view.webContents.navigationHistory.getActiveIndex() }
    } catch {
      history = undefined
    }
  }
  closedTabs.remember({
    url: safeHttpUrl(liveUrl) ? liveUrl : tab.url,
    title: (live ? tab.view.webContents.getTitle() : '') || tab.title,
    favicon: tab.favicon,
    isPrivate: false,
    ...(history ? { history } : {}),
  })
}

/** Reopens the newest closed tab (or the one asked for) with its back/forward list, and shows it. */
function reopenClosedTab(id?: string): void {
  const entry = closedTabs.take(id)
  if (!entry) return
  const view = createBrowserTab(entry.url, false, false)
  const tab = view && openTabs.find((item) => item.view === view)
  if (!view || !tab) return
  tab.title = entry.title
  tab.favicon = entry.favicon
  let loaded: Promise<void>
  if (entry.history) {
    restoringViews.add(view)
    loaded = view.webContents.navigationHistory.restore(entry.history).catch(() => view.webContents.loadURL(entry.url))
  } else {
    loaded = view.webContents.loadURL(entry.url)
  }
  void loaded.catch(() => undefined).finally(() => restoringViews.delete(view))
  showTab(tab.id)
  lastKnownUrl = entry.url
}

/** ⌘W: closes the tab being shown, then shows the tab that took its place, or the globe when none are left. */
function closeActiveTab(): void {
  if (!pageAttached || !activeTabId) return
  closeTab(activeTabId)
}

/** A normal tab opens each site at the zoom it had last time; pinch-to-zoom works on every page. */
function applySiteZoom(view: WebContentsView, url: string): void {
  if (viewGone(view)) return
  void view.webContents.setVisualZoomLevelLimits(1, 3).catch(() => undefined)
  if (privateViews.has(view) || !zoomStore) return
  // Zoomed while this page was still loading: that choice wins, and is kept for the site.
  if (zoomedWhileLoading.delete(view)) {
    zoomStore.set(url, view.webContents.getZoomFactor())
    return
  }
  const factor = zoomStore.get(url)
  if (Math.abs(view.webContents.getZoomFactor() - factor) > 0.001) view.webContents.setZoomFactor(factor)
}

/** Pages zoomed by the person before their current navigation committed (see applySiteZoom). */
const zoomedWhileLoading = new WeakSet<WebContentsView>()

/** Save Page As…: the page with its images and styles, into Downloads unless another place is chosen. */
// ---- Export as PDF ------------------------------------------------------------------------------

let pdfSettings: PdfExportSettings | null = null
let pdfJob: { cancelled: boolean } | null = null
const pdfSettingsFile = (): string => join(app.getPath('userData'), 'pdf-export.json')
/** PDFs saved here, listed under Bookmarks › PDFs (created on first use, after app is ready). */
let savedPdfList: SavedPdfList | null = null
const savedPdfs = (): SavedPdfList => (savedPdfList ??= new SavedPdfList(join(app.getPath('userData'), 'saved-pdfs.json'), trackedWrite))

function currentPdfSettings(): PdfExportSettings {
  if (pdfSettings) return pdfSettings
  try {
    pdfSettings = parsePdfSettings(JSON.parse(readFileSync(pdfSettingsFile(), 'utf8')))
  } catch {
    pdfSettings = { ...DEFAULT_PDF_SETTINGS }
  }
  return pdfSettings
}

function savePdfSettings(next: PdfExportSettings): void {
  pdfSettings = next
  void writeFileAtomic(pdfSettingsFile(), JSON.stringify(next)).catch(() => undefined)
}

/** One PDF at a time; a second click while one is being made is ignored. */
async function runPdfExport(view: WebContentsView | null = pageView, options?: PdfExportSettings): Promise<void> {
  if (options) savePdfSettings(options)
  if (pdfJob || !view || viewGone(view) || isStartView(view)) return
  const contents = view.webContents
  if (!safeHttpUrl(contents.getURL())) {
    emit({ type: 'pdf-export', event: { state: 'failed', reason: 'Only web pages can be saved as PDF.' } })
    return
  }
  const settings = currentPdfSettings()
  const isPrivate = privateViews.has(view)
  const job = { cancelled: false }
  pdfJob = job
  emit({ type: 'pdf-export', event: { state: 'working', step: 'preparing' } })
  try {
    const outcome = await exportPagePdf({
      contents,
      isPrivate,
      settings,
      countryCode: app.getLocaleCountryCode() || '',
      appVersion: app.getVersion(),
      isBlocked: (url, topLevelUrl) => protection.evaluate({ requestUrl: url, topLevelUrl, initiatorOrigin: null, resourceType: 'image', profileId: 'default', isPrivate }).action === 'block',
      adSelectors: protection.cosmeticRules(contents.getURL(), contents.getURL()).hideSelectors,
      cancelled: () => job.cancelled,
      progress: (step) => { if (!job.cancelled) emit({ type: 'pdf-export', event: { state: 'working', step } }) },
      destination: async (name) => {
        // Private tabs never write to Downloads on their own: the person picks where (and the name).
        if (isPrivate) {
          if (!window || window.isDestroyed()) return null
          const { canceled, filePath } = await dialog.showSaveDialog(window, {
            title: 'Export as PDF',
            defaultPath: join(downloadsDirectory(), name),
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
            properties: ['createDirectory', 'showOverwriteConfirmation'],
          })
          if (canceled || !filePath) return null
          return { path: filePath.toLowerCase().endsWith('.pdf') ? filePath : `${filePath}.pdf`, reserved: false, release: () => undefined }
        }
        const reservation = reserveDownloadPath(downloadsDirectory(), name)
        return { path: reservation.path, reserved: true, release: () => { reservation.cleanupIfEmpty() } }
      },
    })
    if (outcome.status === 'saved') {
      browsingData?.downloads.recordSaved({ filename: outcome.filename, url: outcome.url, path: outcome.path, bytes: outcome.bytes, isPrivate })
      if (!isPrivate) await savedPdfs().add({ path: outcome.path, filename: outcome.filename, title: outcome.title, url: outcome.url, pages: outcome.pages, bytes: outcome.bytes, mode: outcome.mode }).catch(() => undefined)
      emit({ type: 'pdf-export', event: { ...outcome, state: 'saved', groupId: isPrivate ? '' : settings.groupId, isPrivate } })
    } else if (outcome.status === 'cancelled') {
      emit({ type: 'pdf-export', event: { state: 'cancelled' } })
    } else {
      emit({ type: 'pdf-export', event: { state: 'failed', reason: outcome.reason } })
    }
  } finally {
    if (pdfJob === job) pdfJob = null
  }
}

/** A PDF this app saved (from a bookmark): only existing .pdf files, opened or shown in Finder. */
async function openSavedFile(path: string, reveal: boolean): Promise<void> {
  try {
    if (!statSync(path).isFile()) throw new Error()
  } catch {
    throw new Error('That PDF is no longer there.')
  }
  if (reveal) shell.showItemInFolder(path)
  else {
    const failure = await shell.openPath(path)
    if (failure) throw new Error(failure)
  }
}

async function savePageAs(): Promise<void> {
  const view = pageView
  if (!view || !pageAttached || viewGone(view) || isStartView(view) || !window || window.isDestroyed()) return
  const url = view.webContents.getURL()
  if (!safeHttpUrl(url)) return
  const filename = savePageFilename(view.webContents.getTitle(), url)
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: 'Save Page As',
    defaultPath: join(app.getPath('downloads'), filename),
    filters: [{ name: 'Web Page, Complete', extensions: ['html', 'htm'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (canceled || !filePath || viewGone(view)) return
  const name = basename(filePath)
  try {
    await view.webContents.savePage(filePath, 'HTMLComplete')
    emit({ type: 'download-finished', filename: name, path: filePath, state: 'completed' })
  } catch {
    emit({ type: 'download-finished', filename: name, path: '', state: 'interrupted' })
  }
}

/** The menu bar: rebuilt (cheaply, only when what it shows changed) as pages, tabs and modes change. */
const appMenu = createAppMenuController({
  state: appMenuState,
  run: runAppCommand,
  apply: (template) => Menu.setApplicationMenu(Menu.buildFromTemplate(template)),
})

function appMenuState(): AppMenuState {
  const view = pageView && !viewGone(pageView) && pageAttached ? pageView : null
  const hasPage = !!view && !isStartView(view)
  return {
    platform: process.platform,
    tabShowing: !!view && activeTabId !== null,
    hasPage,
    canGoBack: hasPage && view.webContents.navigationHistory.canGoBack(),
    canGoForward: hasPage && view.webContents.navigationHistory.canGoForward(),
    isLoading: hasPage && view.webContents.isLoading(),
    tabCount: openTabs.length,
    privateMode,
    recentlyClosed: closedTabs.list(),
    developer: developerBuild(),
  }
}

function createPageView(attach = true): WebContentsView {
  if (pageView) return pageView
  const view = buildView()
  const tab: OpenTab = { id: randomUUID(), url: lastKnownUrl, title: '', favicon: '', view }
  tab.lastShownAt = Date.now()
  openTabs.push(tab)
  activeTabId = tab.id
  pageView = view
  if (attach) attachPageView()
  emitTabs()
  return view
}

function setPanelBounds(bounds: BrowserPanelBounds): void {
  const contentSize = window?.getContentSize() ?? [1440, 940]
  const windowWidth = contentSize[0] ?? 1440
  const windowHeight = contentSize[1] ?? 940
  const x = Math.max(0, Math.round(bounds.x))
  const y = Math.max(0, Math.round(bounds.y))
  const maxWidth = Math.max(280, windowWidth - x)
  const maxHeight = Math.max(180, windowHeight - y)
  const safeBounds = {
    x,
    y,
    width: Math.min(maxWidth, Math.max(280, Math.floor(bounds.width))),
    height: Math.min(maxHeight, Math.max(180, Math.floor(bounds.height))),
  }
  lastBounds = safeBounds
  applyPageViewBounds()
  schedulePersistentStateSave()
}

function updateWindowButtons(): void {
  if (process.platform !== 'darwin' || !window || window.isDestroyed()) return
  window.setWindowButtonVisibility(windowButtonsVisible(browserFullWidth, pageAttached, chromeRevealed))
}

function setChromeRevealed(revealed: boolean, hold = false): void {
  chromeRevealed = revealed
  chromeHeld = revealed && hold
  updateWindowButtons()
}

function setBrowserFullWidth(enabled: boolean): void {
  browserFullWidth = enabled
  chromeRevealed = false
  chromeHeld = false
  updateWindowButtons()
  if (!enabled) {
    tabDockOpen = false
    tabDockHeld = false
  }
  if (dockTweenTimer) clearTimeout(dockTweenTimer)
  dockTweenTimer = null
  dockReserveNow = null
  applyPageViewBounds()
}

function setBrowserTabDockOpen(open: boolean, hold = false): void {
  const previousTarget = dockReserveTarget(browserFullWidth, tabDockOpen)
  tabDockOpen = browserFullWidth && pageAttached && open && openTabs.length > 0
  tabDockHeld = tabDockOpen && hold
  if (dockReserveTarget(browserFullWidth, tabDockOpen) !== previousTarget) tweenDockReserve(previousTarget)
}

async function handleBrowserCommand(
  command: BrowserHostCommand,
): Promise<
  | TabSidebarState
  | BrowserPanelSnapshot
  | ProtectionSnapshot
  | PageTabSnapshot[]
  | ClosedTabSnapshot[]
  | PrivateLibraryReadResult
  | PublicFieldStatus
  | PdfExportSettings
  | SavedPdfRecord[]
  | string
  | null
> {
  switch (command.type) {
    case 'open': {
      const url = resolveNavigationIntent(command.intent)
      // ⌘↵ / ⌥↵ from the address bar: always a fresh tab, behind or in front.
      if (command.disposition) {
        const view = createBrowserTab(url, command.disposition === 'foreground-tab')
        if (view) await view.webContents.loadURL(url)
        break
      }
      // From a new tab's start page, the page opens in that same tab.
      if (pageView && pageAttached && isStartView(pageView)) {
        const view = pageView
        leaveStartPage(view)
        lastKnownUrl = url
        await view.webContents.loadURL(url)
        break
      }
      // Reuse an open tab only when it matches the current mode (private tabs and normal tabs never mix).
      const existing = openTabs.find((tab) => !viewGone(tab.view) && privateViews.has(tab.view) === privateMode && samePage(tab.view.webContents.getURL() || tab.url, url))
      if (existing) {
        showTab(existing.id)
        break
      }
      const view = createBrowserTab(url)
      if (view) await view.webContents.loadURL(url)
      break
    }
    case 'new-tab':
      createStartTab()
      break
    case 'close':
      detachActive()
      schedulePersistentStateSave()
      emitTabs()
      break
    case 'restore':
      if (activeTabId) showTab(activeTabId)
      else if (openTabs[0]) showTab(openTabs[0].id)
      break
    case 'activate-tab':
      showTab(command.id)
      break
    case 'close-tab':
      closeTab(command.id)
      break
    case 'tab-home': {
      const tab = openTabs.find((item) => item.id === command.id)
      if (!tab?.home) break
      if (tab.asleep) {
        delete tab.asleep
        tab.url = tab.home
        showTab(tab.id)
      } else {
        showTab(tab.id)
        if (!viewGone(tab.view)) void tab.view.webContents.loadURL(tab.home).catch(() => undefined)
      }
      break
    }
    case 'tab-switcher':
      endTabSwitcher(command.action)
      break
    case 'cycle-tabs': {
      if (openTabs.length === 0) break
      if (tabSwitchOrder === 'recent') {
        stepTabSwitcher(command.direction)
        break
      }
      const index = Math.max(0, openTabs.findIndex((tab) => tab.id === activeTabId))
      const delta = command.direction === 'previous' ? -1 : 1
      const next = openTabs[(index + delta + openTabs.length) % openTabs.length]
      if (next) showTab(next.id)
      break
    }
    case 'move-tab':
      if (moveTab(openTabs, command.id, command.toIndex)) {
        emitTabs()
        schedulePersistentStateSave()
      }
      break
    case 'set-tab-pinned':
      if (setPinned(openTabs, command.id, command.pinned)) {
        // Pinning records where the tab is as its home; unpinning forgets it.
        const tab = openTabs.find((item) => item.id === command.id)
        if (tab && command.pinned) {
          const current = viewGone(tab.view) ? '' : tab.view.webContents.getURL()
          const home = safeHttpUrl(current) ? current : tab.url
          if (safeHttpUrl(home)) tab.home = home
        } else if (tab) delete tab.home
        emitTabs()
        schedulePersistentStateSave()
      }
      break
    case 'set-tab-muted': {
      const tab = openTabs.find((item) => item.id === command.id)
      if (tab && !viewGone(tab.view)) {
        tab.view.webContents.setAudioMuted(command.muted)
        emitTabs()
      }
      break
    }
    case 'tab-menu': {
      if (!window || window.isDestroyed() || !openTabs.some((tab) => tab.id === command.id)) break
      const menu = Menu.buildFromTemplate(tabMenuTemplate(tabSnapshots(), command.id, (action, id) => void runTabMenuAction(action, id)))
      menu.popup({ window, ...(command.x !== undefined && command.y !== undefined ? { x: command.x, y: command.y } : {}) })
      break
    }
    case 'get-tabs':
      return tabSnapshots()
    case 'close-active-tab':
      closeActiveTab()
      break
    case 'reopen-closed-tab':
      reopenClosedTab(command.id)
      break
    case 'get-closed-tabs':
      return closedTabs.list()
    case 'copy-page-address': {
      if (!pageView || viewGone(pageView) || isStartView(pageView)) break
      // The address the page is at; an error page shows the address that failed, not its own.
      const current = pageView.webContents.getURL()
      const tab = openTabs.find((entry) => entry.view === pageView)
      const address = /^https?:/i.test(current) ? current : tab?.url ?? current
      if (!/^(https?|file):/i.test(address)) break
      const text = command.clean ? cleanAddress(address) : address
      clipboard.writeText(text)
      emit({ type: 'address-copied', cleaned: text !== address })
      break
    }
    case 'select-tab': {
      const tab = command.index === -1 ? openTabs[openTabs.length - 1] : openTabs[command.index]
      if (tab) showTab(tab.id)
      break
    }
    case 'force-reload':
      if (pageView && !viewGone(pageView) && !isStartView(pageView)) pageView.webContents.reloadIgnoringCache()
      break
    case 'save-page':
      await savePageAs()
      return null
    case 'export-pdf':
      void runPdfExport(pageView, command.options)
      return null
    case 'cancel-pdf-export':
      if (pdfJob) pdfJob.cancelled = true
      return null
    case 'get-pdf-settings':
      return currentPdfSettings()
    case 'set-pdf-settings':
      savePdfSettings(command.options)
      return null
    case 'open-saved-file':
      await openSavedFile(command.path, command.reveal)
      return null
    case 'list-saved-pdfs':
      return savedPdfs().list()
    case 'forget-saved-pdf':
      await savedPdfs().forget(command.id)
      return null
    case 'navigate': {
      const target = safeHttpUrl(command.url)
      if (!target) throw new Error('Only HTTP and HTTPS destinations are supported.')
      const view = createPageView()
      leaveStartPage(view)
      const tab = openTabs.find((item) => item.view === view)
      if (tab) crashRecovery.manualRetry(tab.id)
      attachPageView()
      lastKnownUrl = target.toString()
      schedulePersistentStateSave()
      await view.webContents.loadURL(target.toString())
      break
    }
    case 'back':
      if (pageView?.webContents.navigationHistory.canGoBack()) {
        pageView.webContents.navigationHistory.goBack()
      }
      break
    case 'forward':
      if (pageView?.webContents.navigationHistory.canGoForward()) {
        pageView.webContents.navigationHistory.goForward()
      }
      break
    case 'reload': {
      if (!pageView) break
      const tab = openTabs.find((item) => item.view === pageView)
      const currentUrl = pageView.webContents.getURL()
      if (!currentUrl || currentUrl === 'about:blank') {
        if (tab && safeHttpUrl(tab.url)) {
          crashRecovery.manualRetry(tab.id)
          void pageView.webContents.loadURL(tab.url)
        }
      } else {
        pageView.webContents.reload()
      }
      break
    }
    case 'stop':
      pageView?.webContents.stop()
      break
    case 'find':
      if (pageView && command.query.trim()) {
        pageView.webContents.findInPage(command.query, {
          findNext: command.findNext,
          forward: command.forward,
        })
      }
      break
    case 'stop-find':
      pageView?.webContents.stopFindInPage('clearSelection')
      break
    case 'print':
      pageView?.webContents.print({})
      break
    case 'zoom': {
      if (!pageView || viewGone(pageView) || isStartView(pageView)) break
      const contents = pageView.webContents
      const next = command.action === 'reset' ? 1 : stepZoom(contents.getZoomFactor(), command.action)
      contents.setZoomFactor(next)
      if (contents.isLoading()) zoomedWhileLoading.add(pageView)
      // Remembered for the site (100% forgets it); private tabs leave nothing behind.
      if (!privateViews.has(pageView)) zoomStore?.set(contents.getURL(), next)
      break
    }
    case 'set-bounds':
      setPanelBounds(command.bounds)
      break
    case 'set-full-width':
      setBrowserFullWidth(command.enabled)
      return null
    case 'hold-page':
      setPageHeld(command.held)
      return null
    case 'set-chrome-revealed':
      setChromeRevealed(command.revealed, command.hold === true)
      return null
    case 'get-tab-sidebar':
      return tabSidebar
    case 'set-tab-sidebar':
      tabSidebar = command.sidebar
      schedulePersistentStateSave()
      break
    case 'set-tab-rail-expanded':
      tabRailExpanded = command.expanded
      return null
    case 'set-tab-dock-open':
      setBrowserTabDockOpen(command.open, command.hold === true)
      return null
    case 'get-state':
      break
    case 'get-protection':
      return protectionSnapshot()
    case 'set-site-protection': {
      const origin = currentOrigin()
      if (origin) {
        protection.setSiteEnabled(origin, 'default', command.enabled)
        persistExceptions()
      }
      if (pageView) void applyCosmeticFilters(pageView.webContents)
      const snapshot = protectionSnapshot()
      emitProtectionState()
      emitPanelState()
      return snapshot
    }
    case 'set-protection-categories': {
      protection.setCategoryEnabled('ad', command.ads)
      protection.setCategoryEnabled('tracker', command.trackers)
      persistExceptions()
      if (pageView) {
        void applyCosmeticFilters(pageView.webContents)
        pageView.webContents.reload()
      }
      const snapshot = protectionSnapshot()
      emitProtectionState()
      return snapshot
    }
    case 'read-private-library':
      return readSealedLibrary()
    case 'write-private-library':
      await writeSealedLibrary(command.payload)
      return null
    case 'delete-private-library':
      await deleteSealedLibrary()
      return null
    case 'get-field-snapshot':
      return cachedPublicField()
    case 'get-public-field-status':
      return publicFieldStatus()
    case 'get-news-digest':
      return newsService?.latest() ?? null
    case 'address-menu':
      await showAddressMenu(command.hasSelection)
      return null
    case 'get-place-trends':
      return newsService ? JSON.stringify(await newsService.trends({ countryCode: command.countryCode, ...(command.name ? { name: command.name } : {}), ...(command.aliases ? { aliases: command.aliases } : {}), ...(command.geonameId ? { geonameId: command.geonameId } : {}) })) : null
  }
  emitPanelState()
  return panelState()
}

function installApplicationMenu(): void {
  appMenu.refresh()
}

/** The page the app window must show: the dev server in development, the packaged index.html otherwise. */
function appShellUrl(): string {
  return process.env['ELECTRON_RENDERER_URL'] || pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

/** True only for the app window's own top frame showing the app's page (not a page it was tricked into loading). */
function isFromShell(event: IpcMainInvokeEvent): boolean {
  if (!window || window.isDestroyed() || event.sender !== window.webContents) return false
  const frame = event.senderFrame
  return !!frame && frame === window.webContents.mainFrame && isAppShellUrl(frame.url, appShellUrl())
}

/** ipcMain.handle for the app window's API: calls from anywhere else are refused. */
function handleFromShell(channel: string, handler: (event: IpcMainInvokeEvent, value: unknown) => unknown): void {
  ipcMain.handle(channel, (event, value: unknown) => {
    if (!isFromShell(event)) throw new Error('Not allowed.')
    return handler(event, value)
  })
}

/** The app's own session (the shell): copy-to-clipboard and fullscreen for the app page only. */
function wireShellSession(): void {
  const shellSession = session.defaultSession
  const allowed = (permission: string, url: string): boolean => SHELL_PERMISSIONS.has(permission) && isAppShellUrl(url, appShellUrl())
  shellSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed(permission, details.requestingUrl || contents.getURL()))
  })
  shellSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    return allowed(permission, contents?.getURL() || requestingOrigin)
  })
}

/** While the app window closes (or the app quits), its pages going away is not the user closing tabs. */
let shellClosing = false

function createWindow(): void {
  shellClosing = false
  stateWritesClosed = false
  // Pages whose contents went away while the last window was closed (macOS keeps the app running).
  for (const tab of openTabs.filter((item) => viewGone(item.view))) {
    openTabs.splice(openTabs.indexOf(tab), 1)
    if (activeTabId === tab.id) activeTabId = null
  }
  window = new BrowserWindow({
    minWidth: 900,
    minHeight: 620,
    width: 1440,
    height: 940,
    backgroundColor: '#061320',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // A reloaded shell cannot release a page it held before, nor see a screen recording it started.
  window.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    setPageHeld(false)
    captures?.shellReloaded()
  })

  // The window shows the app and nothing else: a dropped link or file, or a script changing
  // location, would otherwise load a page with the app's full API (passwords, private library…).
  const appUrl = appShellUrl()
  const keepShell = (event: Electron.Event, url: string): void => {
    if (!isAppShellUrl(url, appUrl)) event.preventDefault()
  }
  window.webContents.on('will-navigate', keepShell)
  window.webContents.on('will-redirect', keepShell)
  window.webContents.on('will-frame-navigate', (details) => {
    if (!isAppShellUrl(details.url, appUrl)) details.preventDefault()
  })
  // Links the app asks to open in a new window become tabs; nothing gets a window with the app's preload.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (safeHttpUrl(url)) {
      const tab = createBrowserTab(url)
      if (tab) void tab.webContents.loadURL(url).catch(() => undefined)
    }
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error('[app renderer]', details.message)
    })
  }

  // The window grows into fullscreen over an animation: keep a fullscreen page filling it.
  window.on('resize', () => {
    if (htmlFullScreenView && htmlFullScreenView === pageView) applyPageViewBounds()
  })
  window.on('close', () => { shellClosing = true })
  // Leaving the window (⌘Tab to another app) while switching tabs: go to the highlighted one.
  window.on('blur', () => endTabSwitcher('commit'))
  // Trackpad swipes between pages, when macOS sends them (Trackpad › More Gestures › "Swipe between
  // pages" set to swipe with three fingers, or two or three). Two-finger page scrolling is untouched.
  window.on('swipe', (_event, direction) => {
    if (!pageAttached || !pageView || viewGone(pageView) || isStartView(pageView)) return
    if (direction === 'left') void handleBrowserCommand({ type: 'back' })
    else if (direction === 'right') void handleBrowserCommand({ type: 'forward' })
  })
  window.on('closed', () => {
    if (persistenceTimer) clearTimeout(persistenceTimer)
    persistenceTimer = null
    // On quit, before-quit already wrote the final state; otherwise (macOS keeps running) save now,
    // in order after any save already on its way.
    if (!stateWritesClosed) savePersistentState().catch((error: unknown) => console.error('Could not save open tabs:', error))
    stateWritesClosed = true
    window = null
    pageView = null
    pageAttached = false
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---- Browsing: other apps' links, default browser, page appearance ----

function emitBrowsing(event: BrowsingEvent): void {
  if (window && !window.isDestroyed()) window.webContents.send(browsingChannels.event, event)
}

function browsingSettings(): BrowsingSettings {
  return {
    pageAppearance: pageAppearance.current,
    tabSleep: tabSleepAfter,
    tabSwitchOrder,
    defaultBrowser: {
      isDefault: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https'),
      // Only the installed app: from a development build macOS would register Electron itself.
      canSet: process.platform === 'darwin' && app.isPackaged,
    },
  }
}

function wireBrowsing(): void {
  const settingsFile = join(app.getPath('userData'), 'browsing-settings.json')
  const rememberedFile = join(app.getPath('userData'), 'external-apps.json')
  const readJson = (path: string): unknown => {
    try { return JSON.parse(readFileSync(path, 'utf8')) as unknown } catch { return null }
  }
  const stored = parseBrowsingSettingsFile(readJson(settingsFile))
  pageAppearance.set(stored.pageAppearance)
  tabSleepAfter = stored.tabSleep
  tabSwitchOrder = stored.tabSwitchOrder
  const saveSettings = (): Promise<void> => trackedWrite(settingsFile, JSON.stringify({ pageAppearance: pageAppearance.current, tabSleep: tabSleepAfter, tabSwitchOrder })).catch(() => undefined)
  externalOpener = new ExternalOpenBroker({
    emit: emitBrowsing,
    openExternal: (href) => shell.openExternal(href, { activate: true }),
    appName: (href) => {
      try { return app.getApplicationNameForProtocol(href).replace(/\.app$/i, '') } catch { return '' }
    },
    remembered: readJson(rememberedFile),
    save: (data) => { trackedWrite(rememberedFile, data).catch((error: unknown) => console.error('Could not save app links:', error)) },
  })
  handleFromShell(browsingChannels.command, async (_event, value: unknown) => {
    const command = parseBrowsingCommand(value)
    switch (command.type) {
      case 'external-decide':
        externalOpener?.decide(command.id, command.decision, command.always)
        return null
      case 'external-pending':
        return externalOpener?.list() ?? []
      case 'settings':
        return browsingSettings()
      case 'set-page-appearance':
        pageAppearance.set(command.appearance)
        await saveSettings()
        emitBrowsing({ type: 'settings', settings: browsingSettings() })
        return browsingSettings()
      case 'set-tab-sleep':
        tabSleepAfter = command.after
        await saveSettings()
        emitBrowsing({ type: 'settings', settings: browsingSettings() })
        return browsingSettings()
      case 'set-tab-switch-order':
        tabSwitchOrder = command.order
        await saveSettings()
        emitBrowsing({ type: 'settings', settings: browsingSettings() })
        return browsingSettings()
      case 'make-default-browser':
        if (browsingSettings().defaultBrowser.canSet) {
          // macOS asks the person to confirm (keep the current browser, or use Intoponet).
          app.setAsDefaultProtocolClient('http')
          app.setAsDefaultProtocolClient('https')
        }
        return browsingSettings()
    }
  })
}

/** A link or file from another app: a new tab, with the window brought forward. */
function openIncoming(target: IncomingTarget): void {
  if (!window || window.isDestroyed()) createWindow()
  if (target.kind === 'file') localFileGrants.grant(target.path)
  const view = createBrowserTab(target.url, true, privateMode, false, target.kind === 'file')
  if (view) void view.webContents.loadURL(target.url).catch(() => undefined)
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
}

/** One part of the app failing to start (a damaged settings file, say) must not keep the window from opening. */
function startup(part: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    console.error(`Intoponet: ${part} did not start:`, error)
  }
}

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: 'Intoponet',
    applicationVersion: app.getVersion(),
    copyright: 'Explore beyond the expected.\n© 2026 the Intoponet authors',
    website: 'https://intoponet.com',
  })
  try {
    app.configureHostResolver({ secureDnsMode: ENCRYPTED_DNS.mode, secureDnsServers: ENCRYPTED_DNS.servers })
    encryptedDnsActive = true
  } catch {
    encryptedDnsActive = false
  }
  await loadExceptions()
  startup('downloads and history', installDownloadsAndHistory)
  const restoredState = await loadPersistentState()
  if (restoredState) startup('restoring tabs', () => {
    lastKnownUrl = restoredState.url
    lastBounds = restoredState.bounds
    tabSidebar = restoredState.sidebar ?? null
    for (const saved of restoredState.tabs) {
      const view = buildView(false)
      // Restored tabs are unloaded until shown (their pages load on the first click), and look it.
      openTabs.push({ id: saved.id, url: saved.url, title: saved.title, favicon: '', view, asleep: {}, lastShownAt: Date.now(), ...(saved.pinned ? { pinned: true, home: saved.home ?? saved.url } : {}) })
    }
    openTabs.splice(0, openTabs.length, ...pinnedFirst(openTabs))
    const active =
      openTabs.find((tab) => samePage(tab.url, restoredState.url)) ?? openTabs[0]
    if (active) {
      delete active.asleep
      activeTabId = active.id
      pageView = active.view
      lastKnownUrl = active.url
    }
  })

  // The browser itself first: everything below may fail on its own without leaving the app without a window.
  handleFromShell(
    browserHostChannels.command,
    (_event, value: unknown) => handleBrowserCommand(parseBrowserHostCommand(value)),
  )
  startup('app session', wireShellSession)
  startup('menu', installApplicationMenu)
  startup('page zoom', () => {
    const zoomFile = join(app.getPath('userData'), 'site-zoom.json')
    zoomStore = new ZoomStore({
      read: () => (existsSync(zoomFile) ? readFileSync(zoomFile, 'utf8') : null),
      write: (data) => trackedWrite(zoomFile, data),
    })
  })
  startup('saved passwords', wirePasswords)
  startup('site permissions', () => {
    const normalPermissions = new SitePermissionStore(join(app.getPath('userData'), 'site-permissions.json'))
    sitePermissions = new SitePermissionBroker({
      store: (isPrivate) => (isPrivate ? privatePermissions : normalPermissions),
      emit: (event) => { if (window && !window.isDestroyed()) window.webContents.send(sitePermissionChannels.event, event) },
      systemAccess: (kind) => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess(kind) : Promise.resolve(true)),
    })
    handleFromShell(sitePermissionChannels.command, async (_event, value: unknown) => {
      const command = parseSitePermissionCommand(value)
      const store = pageView && privateViews.has(pageView) ? privatePermissions : normalPermissions
      if (command.type === 'decide') return sitePermissions!.decide(command.id, command.decision)
      if (command.type === 'pending') return sitePermissions!.list()
      if (command.type === 'reset') {
        sitePermissions!.reset(command.origin, Boolean(pageView && privateViews.has(pageView)), command.kind)
      }
      return store.get(command.origin)
    })
  })
  startup('page sessions', () => {
    wireDownloadSession()
    wireProtectionSession()
    // Private tabs get the same protections, permissions and download handling.
    wireDownloadSession(PRIVATE_PARTITION)
    wireProtectionSession(PRIVATE_PARTITION)
    // No TLS client certificate is ever sent on its own (Electron's default sends the first one).
    app.on('select-client-certificate', (event, contents, url, _list, callback) => {
      declineClientCertificate(event, callback)
      if (pageView && !viewGone(pageView) && pageView.webContents === contents) emit({ type: 'navigation-failed', url, reason: CLIENT_CERTIFICATE_NOTICE })
    })
  })

  let laya: LayaService | null = null
  startup('captures', () => {
    const captureLibrary = new CaptureLibrary(
      join(app.getPath('userData'), 'capture-library'),
      // Test runs point this at a temporary folder instead of ~/Pictures.
      process.env['INTOPONET_CAPTURE_ROOT'] || join(app.getPath('pictures'), 'Intoponet'),
      { trash: (path) => shell.trashItem(path) },
    )
    captures = new CaptureService(captureLibrary, { window: () => window, pageView: () => pageView, pageAttached: () => pageAttached })
    // Import anything saved by the earlier encrypted store, once.
    void migrateEncryptedCaptures(join(app.getPath('userData'), 'captures'), captureLibrary, async (sealed) => (await safeStorage.decryptStringAsync(sealed)).result)
      .catch(() => 0)
    protocol.handle(CAPTURE_SCHEME, (request) => captures!.respond(request))
    handleFromShell(captureChannels.command, (_event, value: unknown) => captures!.handle(parseCaptureCommand(value)))
  })
  startup('The Olds', () => {
    // The Olds: sourced history threads from Wikidata/Wikipedia (public lookups only).
    const olds = new OldsService({
      cacheDir: join(app.getPath('userData'), 'olds-cache'),
      // Headlines in other languages are translated on this Mac (when that language is installed) before matching.
      translateToEnglish: async (text, lang) => {
        const code = normalizeLanguage(lang)
        if (!code || code === 'en' || !translateService || !(await translateService.isInstalled(code))) return null
        const [english] = await translateService.translate(code, 'en', [text], false)
        return english ?? null
      },
      // Laya (when on) checks that a history topic means the same thing as the headline.
      meaning: (query, texts) => laya ? laya.similarities(query, texts) : Promise.resolve(null),
      embed: (texts) => laya ? laya.embedTexts(texts) : Promise.resolve(null),
      // Quality checks only: INTOPONET_OLDS_DEBUG=<file> records how each headline's candidates scored.
      ...(process.env.INTOPONET_OLDS_DEBUG ? { debug: (headline: string, candidates: unknown, searched: unknown) => appendFileSync(process.env.INTOPONET_OLDS_DEBUG!, `${JSON.stringify({ headline, candidates, searched })}\n`) } : {}),
    })
    // An outlet's earlier coverage: its own topic pages, then Wayback Machine snapshots of them.
    const outletArchive = new OutletArchive({ cacheDir: join(app.getPath('userData'), 'olds-cache') })
    handleFromShell(oldsChannels.command, (_event, value: unknown) => {
      const command = parseOldsCommand(value)
      return command.type === 'coverage' ? outletArchive.coverage(command.query) : olds.thread(command.query)
    })
  })
  startup('knowledge and Laya', () => {
    // Absorb + local knowledge: extracted on this device, encrypted with an OS-keychain key, never sent anywhere.
    const knowledgeDir = join(app.getPath('userData'), 'knowledge')
    const layaDir = join(app.getPath('userData'), 'laya')
    // The key loads on first use; a failure (Keychain locked or denied) is asked again next time.
    const knowledgeCrypto = retryingKnowledgeCrypto(() => loadKnowledgeCrypto(knowledgeDir, {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: (sealed) => safeStorage.decryptStringAsync(sealed),
    }, { relatedDataDirs: [join(layaDir, 'vectors')] }))
    const knowledge = new KnowledgeService({
      dir: knowledgeDir,
      crypto: knowledgeCrypto,
      getActivePage: () => (pageAttached && pageView ? pageView.webContents : null),
      isPrivatePage: (page) => openTabs.some((tab) => privateViews.has(tab.view) && !viewGone(tab.view) && tab.view.webContents === page),
      isExcluded: (url) => isExcludedSite(url, excludedSites),
      onChange: (change) => laya?.onKnowledgeChange(change),
    })
    handleFromShell(knowledgeChannels.command, (_event, value: unknown) => knowledge.handle(parseKnowledgeCommand(value)))
    // Laya: optional on-device meaning search over absorbed pages. Its Node worker
    // guards selected outbound APIs, but it is not OS-level network/filesystem isolated.
    laya = new LayaService({
      dir: layaDir,
      crypto: knowledgeCrypto,
      knowledge,
      openEmbedder: openLayaEmbedder,
      emit: (event) => { if (window && !window.isDestroyed()) window.webContents.send(layaChannels.event, event) },
    })
    handleFromShell(layaChannels.command, (_event, value: unknown) => laya!.handle(parseLayaCommand(value)))
    app.once('will-quit', () => { void laya?.close() })
    setTimeout(() => { void laya?.backfill().catch(() => undefined) }, 15_000).unref?.()
  })
  startup('privacy', () => {
    // Private browsing and backup exclusion for the private stores (PRD MEM-001, §8.4).
    const userDataPath = app.getPath('userData')
    const backupPaths = [privateLibraryPath(), join(userDataPath, 'knowledge'), join(userDataPath, 'laya'), join(userDataPath, 'personal')]
    const backupExclusionIntentPath = join(userDataPath, 'backup-exclusion.json')
    const excludedSitesFile = join(app.getPath('userData'), 'excluded-sites.json')
    try {
      const raw = JSON.parse(readFileSync(excludedSitesFile, 'utf8')) as unknown
      if (Array.isArray(raw)) excludedSites = raw.filter((site): site is string => typeof site === 'string').slice(0, 500)
    } catch {
      // None yet.
    }
    const privacyState = async (): Promise<PrivacyState> => ({
      excludedSites,
      privateMode,
      privateTabs: openTabs.filter((tab) => privateViews.has(tab.view)).length,
      backupExcluded: await backupExclusionStatus(backupPaths, readBackupExclusionIntent(backupExclusionIntentPath)),
      backupExclusionAvailable: backupExclusionAvailable(),
      backupExclusionRequested: readBackupExclusionIntent(backupExclusionIntentPath),
      backupPaths,
    })
    const emitPrivacy = async (): Promise<void> => {
      if (window && !window.isDestroyed()) window.webContents.send(privacyChannels.event, await privacyState())
    }
    const stopBackupExclusionWatch = watchBackupExclusionPaths(userDataPath, backupPaths, backupExclusionIntentPath, () => { void emitPrivacy() })
    app.once('will-quit', stopBackupExclusionWatch)
    handleFromShell(privacyChannels.command, async (_event, value: unknown) => {
      const command = parsePrivacyCommand(value)
      if (command.type === 'set-private-mode') {
        privateMode = command.on
        if (!command.on) {
          // Leaving private browsing closes private tabs and wipes their session.
          sitePermissions!.clear(true)
          for (const tab of openTabs.filter((item) => privateViews.has(item.view))) discardTab(tab.id)
          const privateSession = session.fromPartition(PRIVATE_PARTITION)
          await privateSession.clearStorageData().catch(() => undefined)
          await privateSession.clearCache().catch(() => undefined)
          browsingData?.privateBrowsingEnded()
          emitPanelState()
        }
        appMenu.schedule()
        await emitPrivacy()
      }
      if (command.type === 'set-excluded-sites') {
        excludedSites = command.sites
        try { await trackedWrite(excludedSitesFile, JSON.stringify(excludedSites)) } catch { /* applies this session */ }
        browsingData?.excludedSitesChanged()
        await emitPrivacy()
      }
      if (command.type === 'set-backup-exclusion') {
        try {
          await setBackupExclusion(backupPaths, command.on, backupExclusionIntentPath)
        } finally {
          await emitPrivacy()
        }
      }
      return privacyState()
    })
  })
  startup('beacons', () => {
    // Beacons: the only path by which a user-approved contribution leaves this Mac (PRD §4.6, §7).
    const beaconDir = join(app.getPath('userData'), 'beacons')
    const beacons = new BeaconPublisher({
      files: { key: join(beaconDir, 'device-key.sealed'), settings: join(beaconDir, 'settings.json'), published: join(beaconDir, 'published.json') },
      box: {
        available: () => safeStorage.isAsyncEncryptionAvailable(),
        seal: (text) => safeStorage.encryptStringAsync(text),
        open: async (sealed) => (await safeStorage.decryptStringAsync(sealed)).result,
      },
      defaultRegistry: process.env['INTOPONET_BEACON_REGISTRY'] || DEFAULT_BEACON_REGISTRY,
    })
    handleFromShell(beaconChannels.command, async (_event, value: unknown) => {
      const command = parseBeaconCommand(value)
      switch (command.type) {
        case 'state': return beacons.state()
        case 'set-registry': return beacons.setRegistry(command.url)
        case 'preview': return beacons.preview(command.draft)
        case 'publish': return beacons.publish(command.draft)
        case 'withdraw': return beacons.withdraw(command.id)
        case 'report': return beacons.report(command.url, command.kind, command.text)
        case 'read': return beacons.read({ ...(command.topic ? { topic: command.topic } : {}), ...(command.bbox ? { bbox: command.bbox } : {}) })
      }
    })
  })
  startup('feedback', () => {
    // Feedback: after an hour of active use the app asks once for a rating or a comment.
    // Only what the person writes, their rating and the app version are sent, and only when they press Send.
    const feedback = new FeedbackService(join(app.getPath('userData'), 'feedback.json'), app.getVersion())
    const feedbackTick = setInterval(() => {
      const inUse = !!window && !window.isDestroyed() && window.isVisible() && window.isFocused() && powerMonitor.getSystemIdleTime() < 120
      if (inUse) void feedback.addActiveTime(60_000)
    }, 60_000)
    feedbackTick.unref()
    handleFromShell('intoponet:feedback', (_event, value: unknown) => feedback.handle(parseFeedbackCommand(value)))
  })
  startup('site icons', () => {
    // Site icons for bookmarks: from visited pages or the site's own /favicon.ico, cached on this Mac.
    faviconCache = new FaviconCache(join(app.getPath('userData'), 'favicons.json'))
    handleFromShell('intoponet:favicons', (_event, value: unknown) => {
      if (!Array.isArray(value) || value.length > 300) throw new Error('Invalid hosts.')
      return faviconCache!.get(value.filter((host): host is string => typeof host === 'string' && isIconHost(host)))
    })
  })
  startup('article previews', () => {
    // Article previews for the sources carousel: each outlet's own image, writers and dates,
    // fetched without cookies; images reach the app as small JPEG data URLs.
    const articlePreviews = new ArticlePreviews((bytes, mime) => {
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) return bytes.byteLength < 900_000 ? { data: bytes, mime } : null
      const { width } = image.getSize()
      const fitted = width > 880 ? image.resize({ width: 880, quality: 'good' }) : image
      return { data: fitted.toJPEG(80), mime: 'image/jpeg' }
    // Through Chromium's own network stack (outlets refuse many plain clients), in an in-memory
    // profile of its own: no cookies or sign-ins from your browsing are sent.
    }, async (input, init) => {
      try {
        const response = await session.fromPartition('intoponet-article-previews').fetch(String(input), init as RequestInit)
        if (response.ok) return response
      } catch {
        // Fall through to a plain request.
      }
      return fetch(input, init)
    })
    handleFromShell('intoponet:article-preview', (_event, value: unknown) => {
      if (typeof value !== 'string' || value.length > 2048 || !previewableUrl(value)) return null
      return articlePreviews.get(value)
    })
  })
  startup('translation', () => {
    // Translation: Mozilla's on-device models, downloaded per language on request and pinned by
    // SHA-256. The engine runs in a worker with no network; text never leaves the device.
    const translateStore = new TranslateStore(join(app.getPath('userData'), 'translate'), (input, init) => fetch(input, init))
    translateService = new TranslateService({
      store: translateStore,
      engine: openTranslationEngine(translateStore),
      emit: (event) => { if (window && !window.isDestroyed()) window.webContents.send(translateChannels.event, event) },
      getActivePage: () => (pageAttached && pageView && !viewGone(pageView) ? pageView.webContents : null),
      isPrivatePage: (page) => !!pageView && pageView.webContents.id === page.id && privateViews.has(pageView),
    })
    handleFromShell(translateChannels.command, (_event, value: unknown) => translateService!.handle(parseTranslateCommand(value)))
  })
  // Whether the open page declares its article restricted (read-only; used to offer free coverage elsewhere).
  handleFromShell('intoponet:page-access', async () => {
    if (!pageAttached || !pageView || viewGone(pageView)) return null
    const url = pageView.webContents.getURL()
    if (!/^https?:/i.test(url)) return null
    try {
      return parseAccess(await pageView.webContents.executeJavaScriptInIsolatedWorld(ACCESS_WORLD_ID, [{ code: ACCESS_SCRIPT }]))
    } catch {
      return null
    }
  })
  let updateController: UpdateController | null = null
  startup('updates', () => {
    const updatesFile = join(app.getPath('userData'), 'updates.json')
    const controller = new UpdateController({
      enabled: __INTOPONET_MAC_UPDATE_URL__.length > 0,
      packaged: app.isPackaged,
      platform: process.platform,
      currentVersion: app.getVersion(),
      feedUrl: __INTOPONET_MAC_UPDATE_URL__,
      // Read releases.json through Chromium's network stack (system proxy, like Squirrel itself).
      latestVersion: (manifestUrl) => fetchCurrentRelease(manifestUrl, (input, init) => net.fetch(String(input), init)),
      adapter: app.isPackaged && process.platform === 'darwin' && __INTOPONET_MAC_UPDATE_URL__.length > 0 ? autoUpdater : undefined,
      emit: (status) => { if (window && !window.isDestroyed()) window.webContents.send(updateChannels.event, status) },
      // The automatic-check setting and last check time, kept between launches.
      preferences: {
        // Checked by the controller (a damaged value is dropped, not trusted).
        load: () => JSON.parse(readFileSync(updatesFile, 'utf8')) as { automatic: boolean; lastCheckedAt?: number },
        save: (preferences) => { trackedWrite(updatesFile, JSON.stringify(preferences)).catch((error: unknown) => console.error('Could not save update settings:', error)) },
      },
    })
    updateController = controller
    handleFromShell(updateChannels.command, (_event, value: unknown) => controller.handle(parseUpdateCommand(value)))
  })
  app.once('will-quit', () => { void translateService?.close() })
  startup('browsing', wireBrowsing)
  createWindow()
  startup('automatic updates', () => updateController?.startAutomatic())
  if (restoredState?.wasVisible && pageView && lastKnownUrl) {
    attachPageView()
    void pageView.webContents.loadURL(lastKnownUrl).catch(() => undefined)
  }
  emitTabs()
  // Links and files handed over by other apps (and this launch's own arguments) open as tabs now.
  startup('opening links from other apps', () => {
    for (const target of incomingTargetsFromArgs(process.argv, process.cwd(), readSmallFile)) incomingOpens.push(target)
    incomingOpens.ready(openIncoming)
  })

  startup('public field', () => {
    // Cached field now, then live refreshes (earthquakes/natural events every
    // 20 minutes; Wikipedia's daily most-read when a new day is published).
    const stopPublicField = startPublicFieldRefresh((snapshot) => {
      emit({ type: 'field-snapshot', payload: JSON.stringify(snapshot) })
    }, (status) => {
      emit({ type: 'public-field-status', status })
    })
    app.once('will-quit', stopPublicField)
  })

  startup('tab sleep', () => {
    // Checked twice a minute (more often when a check shortens minutes).
    const timer = setInterval(() => { void sleepIdleTabs() }, Math.min(30_000, Math.max(250, TAB_SLEEP_MINUTE_MS / 2)))
    timer.unref?.()
    app.once('will-quit', () => clearInterval(timer))
  })

  startup('news', () => {
    // What each country's own outlets are reporting (headlines and links only).
    newsService = startNewsService({
      userData: app.getPath('userData'),
      emit: (payload) => emit({ type: 'news-digest', payload }),
      digestBuilder: openDigestBuilder(),
    })
    app.once('will-quit', () => { void newsService?.stop() })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  console.error('Intoponet did not finish starting:', error)
  if (!window) createWindow()
})

/** Quitting waits (briefly) for saves already on their way, so the last library edit and tabs are kept. */
const QUIT_FLUSH_LIMIT_MS = 5_000
let quitFlushStarted = false

app.on('before-quit', (event) => {
  if (!app.isReady()) return
  shellClosing = true
  // A zoom changed just now is still waiting to be saved: start it so the flush below waits for it.
  void zoomStore?.flush().catch(() => undefined)
  // The news feed cache is saved once a minute; save the rest now so the next launch starts with today's news.
  const news = newsService
  newsService = null
  const newsFlush = news?.stop()
  if (!quitFlushStarted && (libraryWriter.pending || writesInFlight.size > 0 || newsFlush)) {
    // Once only: the second before-quit (from app.quit() below) goes straight through.
    quitFlushStarted = true
    event.preventDefault()
    const flushed = Promise.allSettled([libraryWriter.flush(), ...writesInFlight, ...(newsFlush ? [newsFlush] : [])])
    const limit = new Promise((resolve) => setTimeout(resolve, QUIT_FLUSH_LIMIT_MS))
    void Promise.race([flushed, limit]).finally(() => app.quit())
    return
  }
  if (stateWritesClosed) return
  writeFinalState()
  stateWritesClosed = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
