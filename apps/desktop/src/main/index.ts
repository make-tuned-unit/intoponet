import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFile, rm } from 'node:fs/promises'
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
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
  webContents,
  webFrameMain,
  nativeTheme,
  screen,
} from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { atomicWritesInFlight, pendingWrite, removeLeftoverTemporaries, removeSetAside, removeUnfinishedTemporaries, setAsideUnreadable, writeFileAtomic, writeFileAtomicSync } from './atomicFile'
import { isAppShellUrl, SHELL_PERMISSIONS } from './shellGuard'
import { LatestWriter, latestWritesInFlight } from './latestWriter'
import { waitForSaves } from './quitSaves'
import { UnreadSealedFile } from './unreadSealedFile'
import { fetchCurrentRelease, UpdateController } from './updates'
import { FeedbackService, parseFeedbackCommand } from './feedback'
import { PasswordVault } from './passwords/vault'
import { PasswordService, type PasswordPage } from './passwords/service'
import { passwordOrigin } from './passwords/origin'
import { parsePasswordCommand, passwordChannels, type PasswordEvent } from '../shared/passwords'
import { parsePasswordPageMessage, passwordPageChannels } from '../shared/passwordPage'
import { updateChannels, parseUpdateCommand } from '@intoponet/browser-api'
import { browserUserAgent } from './browserUserAgent'
import { capTitle, capUrl, coalesce, persistedActiveUrl, restoredActiveTab } from './tabState'
import { EXIT_FULLSCREEN_SCRIPT, FULLSCREEN_WORLD_ID, fullscreenSiteName, showFullscreenNotice } from './fullscreenNotice'
import { bindLeavePrompt, SAFE_DIALOG_PREFERENCES } from './leavePrompt'
import { fetchTabIcon, TabIconMemory } from './tabFavicon'
import { browsingChannels, parseBrowsingCommand, type LinkRoutesState, type BrowsingEvent, type ArchivedTabSnapshot, type TabFolderSnapshot, type TabGroupRequest, type TabGroupResult, type TidySuggestion, type BrowsingSettings, type LinksFromOtherApps, type PageLoadError, type TabArchiveAfter, type TabSidebarState, type TabSleepAfter, type TabSwitchOrder } from '@intoponet/browser-api'
import { ExternalOpenBroker, classifyExternalUrl } from './externalOpen'
import { CertificateErrorMemo, classifyLoadError, httpLoadError, isCertificateError, showsErrorPage, summarizeCertificate } from './errorPage'
import { IncomingBurst, IncomingOpenQueue, LocalFileGrants, incomingFileTarget, incomingTargetsFromArgs, incomingWebUrl, readSavedLinkFile, type IncomingTarget } from './incomingOpen'
import { PageAppearanceController } from './pageAppearance'
import { SWITCHER_KEYS_SCRIPT, switcherAnnouncement, switcherHtml, SWITCHER_ROW_HEIGHT, SWITCHER_ROWS, TabSwitcher, type SwitcherTab } from './tabSwitcher'
import { focusLinkScript, isLinkPreviewRequest, parsePreviewMessage, PREVIEW_FOCUS_LOOP_SCRIPT, PREVIEW_WORLD_ID, previewFrameHtml, previewHeading, previewLayout, previewSite, type PreviewRect } from './linkPreview'
import { collapseAdSlotsScript, UNCOLLAPSE_AD_SLOTS_SCRIPT } from './adCollapse'
import { archiveAfterMs, DEFAULT_TAB_ARCHIVE, TabArchive, type ArchivedTab } from './tabArchive'
import { addLinkRoute, moveLinkRoute, parseLinkRoutes, removeLinkRoute, routeFor, serializeLinkRoutes, siteOfWebUrl, updateLinkRoute, type LinkRoute } from './linkRoutes'
import { answerWithin, DEFAULT_TAB_SLEEP, parseBrowsingSettingsFile, parseLinksFromOtherApps, sleepAfterMs, tabsDueForSleep, TYPED_CHECK_MS, TYPED_FORM_SCRIPT } from './tabSleep'
import { QuickWindows, type QuickProtection } from './quickWindow'
import { ClosedWindowAudio } from './closedWindowAudio'
import { AUTO_PIP_WORLD_ID, ENTER_PIP_SCRIPT, EXIT_PIP_SCRIPT, NowPlaying, PAUSE_ALL_MEDIA_SCRIPT, PIP_LEFT_SCRIPT, TOGGLE_PLAYBACK_SCRIPT, type PipEnterResult } from './autoPip'
import { UnseenTabs } from './backgroundLoad'
import type { NowPlayingSnapshot } from '@intoponet/browser-api'
import { browserContextExtras, searchSelectionLabel } from './browserContextMenu'

declare const __INTOPONET_MAC_UPDATE_URL__: string

// Every renderer is sandboxed, whatever its own options say (a backstop: each window and view
// already asks for it). Must run before the app is ready; worker threads in main are unaffected.
app.enableSandbox()

// Sites see plain Chrome (some refuse "Electron" as an outdated browser).
app.userAgentFallback = browserUserAgent(app.userAgentFallback)

// WebRTC keeps to the default network route in every web contents as it is made (a sign-in popup
// a page opens included), so no kind of window can leave it out (networkPrivacy.ts).
app.on('web-contents-created', (_event, contents) => applyNetworkPrivacy(contents))

if (!app.isReady()) {
  app.commandLine.appendSwitch(
    'disable-features',
    'WebContentsForceDark,WebContentsForceDarkVariations',
  )
}

// ---- Links and files from other apps (default browser, Open With, a second launch) ----
/** What arrived before the window was ready opens once it is (see whenReady). */
const incomingOpens = new IncomingOpenQueue()
/**
 * More than 6 links within 3 seconds: the first 6 open and the rest wait for "Open the rest" in the app
 * window (incomingOpen.ts), so a flood never closes the shown workspace's tabs to make room.
 */
const incomingBurst = new IncomingBurst({
  open: (target) => openIncoming(target),
  changed: (held) => {
    // The notice is in the app window: it comes back if it was closed (links can go to quick windows).
    if (held) reopenWindow()
    emitBrowsing({ type: 'incoming-held', held })
  },
})
const quickWindows: QuickWindows = new QuickWindows({
  // A quick window is not part of a workspace: its page uses the shared sign-ins (or private).
  buildView: (isPrivate) => buildView(isPrivate, null),
  adopt: (view, url) => adoptQuickView(view, url),
  protection: quickProtection,
  workArea: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
  developer: () => developerBuild(),
  isPrivate: () => privateMode,
  pageLoaded: (view) => {
    void applyCosmeticFilters(view.webContents, { url: view.webContents.getURL() })
    scheduleAdCollapse(view.webContents.id)
  },
  changed: () => appMenu.schedule(),
  runInMain: (command) => runInMainWindow(command),
  alwaysOpenHere: (url, win, moveHere) => offerAlwaysOpenHere(url, win, moveHere),
})
/** Local files opened from Finder: the only files a tab may read (see servePageFiles). */
const localFileGrants = new LocalFileGrants()
// A saved link's file: never a pipe or device that would keep the app reading (incomingOpen.ts).
const readSmallFile = readSavedLinkFile
// An error nobody caught (a timer reading a page whose renderer has gone, say) must not stop the browser: without a
// listener Electron shows a blocking alert and the app answers nothing until it is dismissed. It is logged, and the
// app carries on with its tabs.
process.on('uncaughtException', (error) => {
  console.error('[intoponet] uncaught error in the main process:', error)
})
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
import { cachedPublicField, publicFieldStatus, retryPublicField, startPublicFieldRefresh } from './public-field'
import type { NewsService } from './news/newsService'
import { openNewsService } from './news/openNewsService'
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
import { createAppMenuController, menuCommandById, routeAppCommand, type AppCommand, type AppMenuState } from './appMenu'
import { boundedHistory, ClosedTabs, reopenPlace, type TabHistory, type TabPlace } from './closedTabs'
import { stepZoom, ZoomStore } from './zoomStore'
import { CANCEL_PICK_SCRIPT, hideCss, listItem, PICK_ELEMENT_SCRIPT, selectorProblem, siteOf, SiteTweakStore, SiteTweaks, tweakCss } from './siteTweaks'
import type { SiteTweakListItem, SiteTweakPick, SiteTweakSaveResult, SiteTweakState } from '@intoponet/browser-api'
import { isPdfDocument, savePageFilename } from './savePage'
import { TRACKER_STUB_SCRIPT } from './trackerStubs'
import { addressMenuTemplate, pasteAndGoText } from './addressMenu'
import { bindPermissionOwnerLifecycle, kindsFor, originOf, SitePermissionBroker, SitePermissionStore } from './sitePermissions'
import {
  DEFAULT_PARTITION,
  MAIN_WORKSPACE_ID,
  PRIVATE_PARTITION,
  TOUR_PARTITION,
  externalAppsFile,
  hasSeparateSignIns,
  identityScope,
  isWorkspaceIdentityId,
  pagePartition,
  partitionWorkspaceId,
  scopeWorkspaceId,
  signInsChange,
  sweepLeftoverIdentities,
  workspacePartition,
  workspacePartitionFolder,
  workspaceExternalAppsFile,
  workspacePermissionsFile,
  type IdentityScope,
} from './workspaceIdentity'
import { bindPopupCloseWithOwner, nestedPopupDecision, popupDecision, popupWindowOptions, PopupLimiter, trackUserActivation, UserActivation, guardPopupWindow } from './popups'
import { CLIENT_CERTIFICATE_NOTICE, declineClientCertificate, rejectCertificateErrorForSession } from './browserCertificatePolicy'
import { reserveDownloadPath, sanitizeDownloadFilename } from './downloadReservation'
import { downloadsDirectory, installBrowsingData, openHistoryPane, type BrowsingData } from './browsingData'
import { exportPagePdf } from './pdfExport/exportPdf'
import { PDF_WORLD_ID } from './pdfExport/pageScripts'
import { SavedPdfList } from './pdfExport/savedPdfs'
import { DEFAULT_PDF_SETTINGS, parsePdfSettings, type PdfExportSettings } from './pdfExport/settings'
import { CrashRecoveryPolicy, ShellReloadPolicy } from './crashRecovery'
import { framesOf, mainFrameOf } from './mainFrame'
import { restoreHistoryOrLoad } from './historyRestore'
import { BeaconPublisher } from './beacons/publisher'
import { DEFAULT_BEACON_REGISTRY } from './beacons/defaults'
import { applyNetworkPrivacy, ENCRYPTED_DNS, networkPrivacySnapshot, WEBRTC_POLICY } from './networkPrivacy'
let newsService: NewsService | null = null
let encryptedDnsActive = false
import { CaptureLibrary, migrateEncryptedCaptures } from './captureStore'
import { CaptureService } from './captureService'
import { CAPTURE_SCHEME, captureChannels, knowledgeChannels, layaChannels, parseLayaCommand, translateChannels, parseTranslateCommand, normalizeLanguage, privacyChannels, parsePrivacyCommand, isExcludedSite, type PrivacyState, sitePermissionChannels, parseSitePermissionCommand, beaconChannels, parseBeaconCommand, oldsChannels, parseCaptureCommand, parseKnowledgeCommand, parseOldsCommand } from '@intoponet/browser-api'
import { KnowledgeService } from './knowledge/service'
import { LayaService } from './laya/service'
import { openLayaEmbedder } from './laya/openEmbedder'
import { TranslateService } from './translate/service'
import { FaviconCache, isIconHost, SITE_ICON_PARTITION } from './faviconCache'
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
import { canNest, deleteFolder, duplicateIndex, folderDepth, folderedOrder, folderTreeOrder, MAX_FOLDER_DEPTH, MAX_FOLDERS, moveFolderedTab, moveTab, otherTabIds, pinnedFirst, revealFolder, setPinned, setTabFolder, tabIdsToRight, type TabFolder } from './tabOrder'
import { planGrouping, snapshotGrouping, undoGrouping, UNDO_GROUPING_MS, type GroupingSnapshot } from './tabGrouping'
import { keepPairsWhole, suggestGroups, tidyCandidates, tidyText } from './tabTidy'
import { dot } from './laya/retrieval'
import { tabMenuTemplate, type TabMenuAction, type TabMenuSplit } from './tabMenu'
import { canSplit, keepOutOfPairs, pairMoveTarget, partnerOf, repairSplits, setSplitRatio, splitBounds, splitPreviewArea, splitWith, storableRatio, unsplit, DEFAULT_SPLIT_RATIO, type SplitLayout, type SplitSide, type TabSplit } from './splitPages'
import { compareCountryName, compareLabelFor, landedCompare, savedCompareOf, tabCompareFor, type CompareSideInput, type TabCompare } from './compare'
import { liveTabFlags } from './tabState'
import { groupSavedFolders, parseSavedWorkspaces, savedWorkspaceOf, WorkspaceSet, type RemovedWorkspace, type SavedWorkspace, type SavedWorkspaces } from './workspaces'
import { BrowserImportService, wireBrowserImport } from './browserImport/service'
import { heldAddresses, type FolderPlan, type ImportedTab, type WorkspaceImportPlan } from './browserImport/plan'
import { importRoot } from './browserImport/sources'
import {
  browserHostChannels,
  type BrowserHostCommand,
  type BrowserHostEvent,
  type BrowserPanelBounds,
  type BrowserPanelSnapshot,
  type ClosedTabSnapshot,
  type PageTabSnapshot,
  type SplitPanelSnapshot,
  type SplitSideSnapshot,
  type SavedPdfRecord,
  type PrivateLibraryReadResult,
  type ShellShortcut,
  type ProtectionSnapshot,
  type PublicFieldStatus,
  type WorkspaceCommand,
  type WorkspacesState,
  type WorkspaceSwitch,
  MAX_FAVOURITES,
  MAX_WORKSPACES,
  WORKSPACE_COMMAND_TYPES,
  parseBrowserHostCommand,
  resolveNavigationIntent,
} from '@intoponet/browser-api'
import {
  LocalProtectionEngine,
  ProtectionPageContextStore,
} from '@intoponet/protection-engine'

let window: BrowserWindow | null = null
let pageView: WebContentsView | null = null
/** The other side of a split, attached beside pageView (null unless the shown tab is side by side). */
let companionView: WebContentsView | null = null
/** A tab dragged over a page edge: the side it would take (splitPages.ts). */
let splitPreviewSide: SplitSide | null = null
/**
 * Page views whose main frame is starting a new document, until the view stops loading. Not until a document is
 * ready: an earlier document can finish (its dom-ready, its load) while a newer navigation is still on its way.
 */
const loadingDocument = new WeakSet<WebContentsView>()
/** Media a tab opened out of sight started by itself: paused (remembered on the element) until the tab is shown. */
const UNSEEN_MEDIA = "Symbol.for('intoponet.unseen-media')"
const PAUSE_UNSEEN_MEDIA = `(() => { for (const media of document.querySelectorAll('video, audio')) if (!media.paused) { media[${UNSEEN_MEDIA}] = true; media.pause() } })()`
const RESUME_UNSEEN_MEDIA = `(() => { for (const media of document.querySelectorAll('video, audio')) if (media[${UNSEEN_MEDIA}]) { delete media[${UNSEEN_MEDIA}]; media.play().catch(() => {}) } })()`
function runInEveryFrame(contents: Electron.WebContents, code: string): void {
  if (contents.isDestroyed()) return
  for (const frame of framesOf(contents)) {
    if (!frame.detached) void frame.executeJavaScript(code).catch(() => undefined)
  }
}
/** Tabs opened out of sight: they load as fast as a shown tab, and silently until shown (backgroundLoad.ts). */
const unseenTabs = new UnseenTabs<Electron.WebContents>({
  pause: (contents) => runInEveryFrame(contents, PAUSE_UNSEEN_MEDIA),
  resume: (contents) => runInEveryFrame(contents, RESUME_UNSEEN_MEDIA),
})
/** Pages muted because the app window closed, until the person acts in them (closedWindowAudio.ts). */
const closedWindowAudio = new ClosedWindowAudio<Electron.WebContents>()
let translateService: TranslateService | null = null
/** Saved passwords (sealed on this Mac); null until the app is ready. */
let passwords: PasswordService | null = null
// Site permissions: asked in a bar, remembered per site (private tabs: in memory until private browsing ends).
// Each workspace with separate sign-ins keeps its own answers (workspaceIdentity.ts: the scope).
let sitePermissions: SitePermissionBroker | null = null
const privatePermissions = new SitePermissionStore(null)
let normalPermissions: SitePermissionStore | null = null
const workspacePermissionStores = new Map<string, SitePermissionStore>()
/** Sites the user never wants absorbed or remembered (Privacy › Sites to leave out). */
let excludedSites: string[] = []
let privateMode = false
const privateViews = new WeakSet<WebContentsView>()
/**
 * Tabs that leave no trace (the guided tour's page): no history visit or recent page, never in Recently
 * closed or Archived tabs, never saved with the open tabs, no remembered icon. Their pages run in a temporary
 * session of their own (TOUR_PARTITION), emptied when the last of them closes.
 */
const untrackedViews = new WeakSet<WebContentsView>()
const tourPages = new Set<number>()
function tourPageOpened(view: WebContentsView): void {
  untrackedViews.add(view)
  const id = view.webContents.id
  tourPages.add(id)
  view.webContents.once('destroyed', () => {
    tourPages.delete(id)
    if (tourPages.size > 0) return
    // Its cookies, site storage and cache go with it (the session itself lasts until the app quits, in memory only).
    const tour = session.fromPartition(TOUR_PARTITION)
    void tour.clearStorageData().catch(() => undefined)
    void tour.clearCache().catch(() => undefined)
    void tour.clearAuthCache().catch(() => undefined)
  })
}
/** The workspace a page view belongs to (null: none, as in a quick window), and the partition it was built with. */
const viewWorkspaces = new WeakMap<WebContentsView, string | null>()
const viewPartitions = new WeakMap<WebContentsView, string>()
/** Sessions that already have the download and protection handlers (each partition once). */
const wiredPartitions = new Set<string>()
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
/** The tabs of the workspace shown, and private tabs (which belong to no workspace). */
const openTabs: OpenTab[] = []
/** Workspaces (workspaces.ts): openTabs and tabFolders hold the shown one's tabs and folders; the others are parked. */
let workspaces = new WorkspaceSet<OpenTab>()
/** A workspace deleted moments ago: Undo brings it back (its tabs stay open, unseen) until the timer closes them. */
let deletedWorkspace: { removed: RemovedWorkspace<OpenTab>; timer: ReturnType<typeof setTimeout> } | null = null
/** Every saved workspace was read at startup (never with the state file missing, unreadable or set aside). */
let savedWorkspacesLoaded = false
/** Every tab in every workspace, and private tabs. */
function allTabs(): OpenTab[] {
  return [...openTabs, ...workspaces.parkedTabs()]
}
function tabOfView(view: WebContentsView | null): OpenTab | undefined {
  if (!view) return undefined
  return openTabs.find((tab) => tab.view === view) ?? workspaces.parkedTabs().find((tab) => tab.view === view)
}
/** The tab (in any workspace) whose page this is; undefined for a page in its own window. */
function tabOfContents(contents: Electron.WebContents): OpenTab | undefined {
  return allTabs().find((tab) => !viewGone(tab.view) && tab.view.webContents === contents)
}
let lastBounds: BrowserPanelBounds = { x: 40, y: 104, width: 900, height: 600 }
/** The shell has reported the page area at least once (until then lastBounds is only a default or a saved guess). */
let panelBoundsReported = false
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
  /**
   * Woken, restored or reopened, its page is loading and has no title of its own yet: `title` (the one
   * it was saved with) is shown meanwhile, not the address Chromium reports (liveTitle).
   */
  keepTitle?: true
  /** When the tab was last shown or left (for sleeping background tabs and recent-order switching). */
  lastShownAt?: number
  /** The sidebar folder it is in (unpinned tabs only). */
  folderId?: string
  /** Floating in picture-in-picture (Settings › Browsing: video follows you); docked again when shown. */
  pictureInPicture?: boolean
  /** Side by side with its partner tab (splitPages.ts); both tabs carry the same ratio. */
  split?: TabSplit
  /** Opened by Compare (compare.ts): its outlet and country, shown while the page stays on the article's site. */
  compare?: TabCompare
}

/** Video follows you (Settings › Browsing): a tab left while its video plays floats that video. */
let autoPictureInPicture = false
/** What plays in which tab, for the now-playing control (autoPip.ts). */
const nowPlaying = new NowPlaying()

/** Asks before a page opens another app (externalOpen.ts); null until the app is ready. */
let externalOpener: ExternalOpenBroker | null = null
/** Pages follow the Mac's light/dark appearance unless Settings says otherwise (pageAppearance.ts). */
const pageAppearance = new PageAppearanceController('system')
/** Certificate problems, kept until the failed load that follows shows them. */
const certificateErrors = new CertificateErrorMemo()

type SavedTab = { id: string; url: string; title: string; pinned?: boolean; home?: string; folderId?: string; workspaceId: string; split?: TabSplit; compare?: TabCompare }

/** browser-state.v1.json (the file keeps its name); version 3 added workspaces (see workspaces.ts). */
type PersistentBrowserState = {
  version: 3
  url: string
  bounds: BrowserPanelBounds
  wasVisible: boolean
  /** Every workspace's tabs, each naming its workspace. */
  tabs: SavedTab[]
  /** The tab sidebar's mode and width (absent until first changed). */
  sidebar?: TabSidebarState
  /** Sidebar folders of every workspace; saved tabs name theirs by folderId. */
  folders?: Array<TabFolder & { workspaceId: string }>
  workspaces: SavedWorkspace[]
  activeWorkspaceId: string
  favourites?: SavedWorkspaces['favourites']
}

/** What a saved state brings back: tabs and folders by workspace, and the workspaces themselves. */
type RestoredBrowserState = {
  url: string
  bounds: BrowserPanelBounds
  wasVisible: boolean
  tabs: SavedTab[]
  sidebar?: TabSidebarState
  folders: Map<string, TabFolder[]>
  workspaces: SavedWorkspaces
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

/**
 * A tab's page title, or '' when there is none to show yet: no page, or a woken, restored or reopened
 * page still without a title of its own (keepTitle), whose saved `title` stands in rather than the
 * address Chromium reports meanwhile. Callers fall back to `tab.title`.
 */
function liveTitle(tab: OpenTab): string {
  if (viewGone(tab.view) || (tab.keepTitle && tab.title)) return ''
  return tab.view.webContents.getTitle()
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
  const shownId = workspaces.activeId
  const untracked = new Set(openTabs.filter((tab) => untrackedViews.has(tab.view)).map((tab) => tab.id))
  const shown: SavedTab[] = tabSnapshots().filter((tab) => !tab.isPrivate && !tab.isStartPage && !untracked.has(tab.id)).map((tab) => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    ...(tab.pinned ? { pinned: true } : {}),
    ...(tab.pinned && tab.home ? { home: tab.home } : {}),
    ...(tab.folderId ? { folderId: tab.folderId } : {}),
    ...(splitOfTab(tab.id) ? { split: splitOfTab(tab.id)! } : {}),
    ...(compareOfTab(tab.id) ? { compare: compareOfTab(tab.id)! } : {}),
    workspaceId: shownId,
  }))
  const parked: SavedTab[] = []
  const folders: Array<TabFolder & { workspaceId: string }> = tabFolders.map((folder) => ({ ...folder, workspaceId: shownId }))
  const records: SavedWorkspace[] = []
  for (const workspace of workspaces.workspaces) {
    const held = workspace.id === shownId ? null : workspaces.parkedOf(workspace.id)
    const lastTab = held ? held.activeTabId : openTabs.some((tab) => tab.id === activeTabId && !privateViews.has(tab.view) && !untrackedViews.has(tab.view)) ? activeTabId : null
    records.push({ ...workspace, ...(lastTab ? { activeTabId: lastTab } : {}) })
    if (!held) continue
    for (const folder of held.folders) folders.push({ ...folder, workspaceId: workspace.id })
    for (const tab of held.tabs) {
      if (tab.start || untrackedViews.has(tab.view)) continue
      const live = !viewGone(tab.view)
      const current = live ? tab.view.webContents.getURL() : ''
      const url = capUrl(safeHttpUrl(current) ? current : tab.url)
      if (!safeHttpUrl(url)) continue
      parked.push({
        id: tab.id,
        url,
        title: capTitle(liveTitle(tab) || tab.title),
        ...(tab.pinned ? { pinned: true } : {}),
        ...(tab.pinned && tab.home ? { home: capUrl(tab.home) } : {}),
        ...(tab.folderId && !tab.pinned ? { folderId: tab.folderId } : {}),
        ...(tab.split ? { split: { ...tab.split } } : {}),
        ...(tab.compare ? { compare: { ...tab.compare } } : {}),
        workspaceId: workspace.id,
      })
    }
  }
  return {
    version: 3,
    // The open page only when it is a saved tab: a private page's address never reaches the disk.
    url: persistedActiveUrl(shown, activeTabId, lastKnownUrl),
    bounds: lastBounds,
    wasVisible: pageAttached,
    tabs: [...shown, ...parked],
    ...(tabSidebar ? { sidebar: tabSidebar } : {}),
    ...(folders.length ? { folders } : {}),
    workspaces: records,
    activeWorkspaceId: shownId,
    ...(workspaces.favourites.length ? { favourites: workspaces.favourites.map((favourite) => ({ ...favourite })) } : {}),
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

/** Saved folders: well-formed ones only, parents that exist, no loops, nothing too deep. */
function parseSavedFolders(value: unknown): TabFolder[] {
  if (!Array.isArray(value)) return []
  const folders: TabFolder[] = []
  for (const entry of value.slice(0, MAX_FOLDERS)) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record['id'] !== 'string' || record['id'].length === 0 || record['id'].length > 80 || typeof record['name'] !== 'string') continue
    const name = record['name'].replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80)
    if (!name || folders.some((folder) => folder.id === record['id'])) continue
    folders.push({
      id: record['id'],
      name,
      parentId: typeof record['parentId'] === 'string' ? record['parentId'] : null,
      ...(record['collapsed'] === true ? { collapsed: true } : {}),
      ...(typeof record['storyId'] === 'string' && record['storyId'].length > 0 && record['storyId'].length <= 80 ? { storyId: record['storyId'] } : {}),
    })
  }
  // A parent that is missing (or a loop) puts the folder at the top level.
  const ids = new Set(folders.map((folder) => folder.id))
  for (const folder of folders) if (folder.parentId && (!ids.has(folder.parentId) || folderDepth(folders, folder.id) > 6 || !folderTreeOrder(folders).includes(folder.id))) folder.parentId = null
  return folders
}

/** A saved split: a partner and a side (with the pair's ratio). Anything else is dropped. */
function savedSplitOf(value: unknown): { split?: TabSplit } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const partnerId = record['partnerId']
  const side = record['side']
  if (typeof partnerId !== 'string' || partnerId.length === 0 || partnerId.length > 80) return {}
  if (side !== 'left' && side !== 'right') return {}
  const ratio = typeof record['ratio'] === 'number' ? storableRatio(record['ratio']) : DEFAULT_SPLIT_RATIO
  return { split: { partnerId, side, ratio } }
}

async function loadPersistentState(): Promise<RestoredBrowserState | null> {
  let text: string
  try {
    text = await readFile(stateFilePath(), 'utf8')
  } catch {
    return null // First launch: nothing saved yet.
  }
  const restored = parsePersistentState(text)
  // Saved tabs and workspaces that cannot be read are kept aside, never replaced by the next save.
  if (!restored) setAsideUnreadable(stateFilePath())
  return restored
}

function parsePersistentState(text: string): RestoredBrowserState | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const candidate = parsed as Record<string, unknown>
    if (
      (candidate['version'] !== 1 && candidate['version'] !== 2 && candidate['version'] !== 3) ||
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
    // Versions 1 and 2 had no workspaces: everything they kept goes into "Main".
    const saved = parseSavedWorkspaces(candidate)
    const tabs: SavedTab[] = Array.isArray(candidate['tabs'])
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
              ...(record['pinned'] !== true && typeof record['folderId'] === 'string' && record['folderId'].length <= 80 ? { folderId: record['folderId'] } : {}),
              ...(record['pinned'] === true && typeof record['home'] === 'string' && record['home'].length <= 8_192 && safeHttpUrl(record['home']) ? { home: record['home'] } : {}),
              workspaceId: savedWorkspaceOf(record, saved.workspaces),
              ...savedSplitOf(record['split']),
              ...(savedCompareOf(record['compare']) ? { compare: savedCompareOf(record['compare'])! } : {}),
            },
          ]
        })
      : url
        ? [{ id: randomUUID(), url, title: '', workspaceId: saved.activeId }]
        : []
    let sidebar: TabSidebarState | undefined
    try {
      const parsedSidebar = parseBrowserHostCommand({ type: 'set-tab-sidebar', sidebar: candidate['sidebar'] })
      if (parsedSidebar.type === 'set-tab-sidebar') sidebar = parsedSidebar.sidebar
    } catch { /* never set, or damaged: the default */ }
    const folders = new Map<string, TabFolder[]>()
    for (const [workspaceId, group] of groupSavedFolders(candidate['folders'], saved.workspaces)) folders.set(workspaceId, parseSavedFolders(group))
    return {
      url,
      bounds: boundsCommand.bounds,
      wasVisible: candidate['wasVisible'],
      tabs,
      ...(sidebar ? { sidebar } : {}),
      folders,
      workspaces: saved,
    }
  } catch {
    return null
  }
}

function panelState(): BrowserPanelSnapshot {
  const base = pagePanelState()
  const split = splitPanelState()
  const preview = splitPreviewState()
  return {
    ...base,
    ...(split ? { split } : {}),
    ...(preview ? { splitPreview: preview } : {}),
  }
}

function pagePanelState(): BrowserPanelSnapshot {
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
  // Nothing committed yet: a new tab before its first page arrives, a page whose renderer crashed (or
  // kept crashing, waiting blank for Reload). The toolbar shows the address it is loading or will load
  // (pendingUrl); `url` stays the page that has arrived, which is what the shell asks about the shown
  // page for (site tweaks, permissions, passwords…), except a page waiting for Reload after crashing,
  // which is still that page.
  const tab = openTabs.find((item) => item.view === pageView)
  const pending = tab && !contents.getURL() && safeHttpUrl(tab.url) ? tab : undefined
  const crashed = pending && !crashRecovery.canAutoRecover(pending.id) ? pending : undefined
  return {
    url: capUrl(crashed ? crashed.url : contents.getURL()),
    title: capTitle(pending ? pending.title || contents.getTitle() : (tab && liveTitle(tab)) || tab?.title || contents.getTitle()),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    isLoading: contents.isLoading(),
    isVisible: pageAttached,
    isPrivate: privateViews.has(pageView),
    ...(untrackedViews.has(pageView) ? { untracked: true } : {}),
    zoomFactor: Number(contents.getZoomFactor().toFixed(3)),
    ...(pending ? { isPending: true as const, pendingUrl: capUrl(pending.url) } : {}),
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

/** The now-playing control's tab (every tab, the one in front included), or null when nothing plays. */
function nowPlayingSnapshot(): NowPlayingSnapshot | null {
  return nowPlaying.snapshot(activeTabId, (tabId) => {
    // Every workspace's tabs: a video in a workspace not shown keeps playing and stays listed.
    const tab = allTabs().find((item) => item.id === tabId)
    if (!tab || viewGone(tab.view)) return null
    const contents = tab.view.webContents
    return { title: capTitle(liveTitle(tab) || tab.title || capUrl(tab.url)), muted: contents.isAudioMuted() && !closedWindowAudio.silenced(contents) }
  })
}
const emitNowPlaying = coalesce(() => emit({ type: 'now-playing', nowPlaying: nowPlayingSnapshot() }))

/**
 * Pauses every video and audio playing in the app window's pages (every workspace's tabs, a link
 * preview), in all their frames. Nothing plays again by itself: the person starts it.
 */
function pauseAllMedia(): void {
  const views = [...allTabs().map((tab) => tab.view), ...(linkPreview ? [linkPreview.view] : [])]
  // What pausing cannot reach (a Web Audio player, a player in a closed shadow root) is silenced with its page.
  closedWindowAudio.windowClosed(allTabs().filter((tab) => !viewGone(tab.view)).map((tab) => tab.view.webContents))
  for (const view of views) {
    if (viewGone(view)) continue
    // The page's own frame in an isolated world (the page cannot override pause there); its frames as they are.
    void view.webContents.executeJavaScriptInIsolatedWorld(AUTO_PIP_WORLD_ID, [{ code: PAUSE_ALL_MEDIA_SCRIPT }]).catch(() => undefined)
    let frames: Electron.WebFrameMain[] = []
    try {
      frames = view.webContents.mainFrame.framesInSubtree
    } catch {
      frames = []
    }
    for (const frame of frames) {
      if (frame === view.webContents.mainFrame || frame.isDestroyed()) continue
      void frame.executeJavaScript(PAUSE_ALL_MEDIA_SCRIPT).catch(() => undefined)
    }
  }
}

/** A tab's media started or stopped (the control lists it while it plays). */
function setTabPlaying(view: WebContentsView, playing: boolean): void {
  const tab = tabOfView(view)
  if (!tab) return
  nowPlaying.update(tab.id, { playing }, Date.now())
  emitNowPlaying()
}

function exceptionsFilePath(): string {
  return join(app.getPath('userData'), 'protection-exceptions.json')
}

function currentOrigin(): string {
  return originOfUrl(lastKnownUrl)
}

function originOfUrl(value: string): string {
  if (!value) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

/** A quick window's protection counts and site pause, as the protection bar reads them for a tab. */
function quickProtection(view: WebContentsView): QuickProtection {
  if (viewGone(view)) return { blocked: 0, protectionOn: true }
  const counts = protectionPages.counters(view.webContents.id)
  const origin = originOfUrl(view.webContents.getURL())
  return {
    blocked: counts.blockedAds + counts.blockedTrackers,
    protectionOn: origin ? protection.isSiteEnabled(origin, 'default') : true,
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
    // First launch or unreadable file — default-on. An unreadable one is kept aside, not saved over.
    setAsideUnreadable(exceptionsFilePath())
  }
}

const cosmeticStyleId = 'intoponet-cosmetic'

function cosmeticInjection(css: string, styleId = cosmeticStyleId): string {
  return `(() => {
    const id = ${JSON.stringify(styleId)};
    const existing = document.getElementById(id);
    const css = ${JSON.stringify(css)};
    // A page whose Content-Security-Policy forbids inline styles leaves the style element without a
    // sheet. The same rules then go in a constructed sheet, which that policy does not cover.
    const slot = Symbol.for(id);
    const adopted = document[slot];
    const unadopt = () => {
      if (!adopted) return;
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== adopted);
      delete document[slot];
    };
    if (!css) {
      existing?.remove();
      unadopt();
      return;
    }
    const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style');
    style.id = id;
    style.textContent = css;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    if (style.sheet) {
      unadopt();
      return;
    }
    try {
      const sheet = adopted || new CSSStyleSheet();
      sheet.replaceSync(css);
      if (!adopted) Object.defineProperty(document, slot, { value: sheet, configurable: true });
      if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {}
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
  options: { only?: Electron.WebFrameMain | null; onlyNew?: boolean; /** The page's address when it is not the tab showing (a link preview). */ url?: string } = {},
): Promise<void> {
  try {
    if (contents.isDestroyed()) return
    const pageUrl = options.url ?? lastKnownUrl
    const origin = options.url === undefined ? currentOrigin() : (() => { try { return new URL(options.url).origin } catch { return '' } })()
    const rules =
      origin && !protection.isSiteEnabled(origin, 'default')
        ? null
        : protection.cosmeticRules(pageUrl, pageUrl)
    // A site's hidden elements (SITE_TWEAKS) ride the same style element, also when protection is paused for the site.
    const css = [rules?.cssRules.join('\n') ?? '', hideCss(siteHiddenSelectors(contents, pageUrl))].filter(Boolean).join('\n')
    // With protection on, blocked tracker globals get quiet stand-ins so the page's own buttons don't throw.
    const script = rules ? `${cosmeticInjection(css)};${TRACKER_STUB_SCRIPT}` : `${cosmeticInjection(css)};${UNCOLLAPSE_AD_SLOTS_SCRIPT}`
    const frames = options.only ? [options.only] : framesOf(contents)
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

// ---- Make a site yours (SITE_TWEAKS; the logic is in siteTweaks.ts) -------------------------------

/** Isolated world for the element picker (and its cancel): the page's own scripts cannot see either. */
const SITE_TWEAK_WORLD_ID = 1317
/** The site tweaks as saved (and, for a private tab, as changed in that tab). Null before the store starts. */
let siteTweaks: SiteTweaks | null = null
/** The element picked on each page, hidden for a preview until it is saved or cancelled. */
const previewSelectors = new Map<number, string>()
/** The style tweak inserted in each page (its insertCSS key), so it can be replaced or removed. */
/** The style element a site's style tweak lives in (see applySiteStyle). */
const siteStyleElementId = 'intoponet-site-style'

/** The web contents of every private page (tabs and link previews alike), so tweaks know not to save. */
const privateWebContents = new WeakSet<Electron.WebContents>()

/** The selectors hidden on a page at `url`: its site's (when tweaks are on) and the element being previewed. */
function siteHiddenSelectors(contents: Electron.WebContents, url: string): string[] {
  const selectors: string[] = []
  const site = siteOf(url)
  const tweak = site && siteTweaks ? siteTweaks.get(site, privateWebContents.has(contents)) : null
  if (tweak?.enabled) selectors.push(...tweak.hidden)
  const preview = previewSelectors.get(contents.id)
  if (preview) selectors.push(preview)
  return selectors
}

/**
 * The site's style tweak (width, font, colours, the person's own CSS) on the page's main frame, as one
 * style element that is replaced on every change and removed when there is none. This is the same
 * mechanism as the protection rules. insertCSS is not used: in this Electron build removeInsertedCSS
 * resolves but the inserted rule stays, so a turned-off or changed style could never be taken back.
 * The CSS is only ever the text of a style element; no page script runs it.
 */
async function applySiteStyle(view: WebContentsView): Promise<void> {
  if (viewGone(view)) return
  const contents = view.webContents
  if (contents.isDestroyed()) return
  const site = siteOf(contents.getURL())
  const tweak = site && siteTweaks ? siteTweaks.get(site, privateViews.has(view)) : null
  const css = tweak ? tweakCss(tweak) : ''
  const frame = mainFrameOf(contents)
  if (!frame || frame.detached) return
  await frame.executeJavaScript(cosmeticInjection(css, siteStyleElementId)).catch(() => undefined)
}

/** After a change to a site's tweaks: the style on each open tab of that site, and the hidden elements on the shown page. */
function refreshSiteTweaks(site: string): void {
  // Every tab, parked workspace tabs included, and the link preview card (an ordinary page view).
  const views = [...allTabs().map((tab) => tab.view), ...(linkPreview ? [linkPreview.view] : [])]
  for (const view of views) {
    if (!viewGone(view) && siteOf(view.webContents.getURL()) === site) void applySiteStyle(view)
  }
  if (pageView && !viewGone(pageView) && siteOf(pageView.webContents.getURL()) === site) void applyCosmeticFilters(pageView.webContents)
  if (linkPreview && !viewGone(linkPreview.view) && siteOf(linkPreview.view.webContents.getURL()) === site) {
    void applyCosmeticFilters(linkPreview.view.webContents, { url: linkPreview.view.webContents.getURL() })
  }
}

/** The site the shown page belongs to, and whether it is a private tab. */
function shownSiteTweakSite(): { site: string | null; isPrivate: boolean } {
  if (!pageView || viewGone(pageView)) return { site: null, isPrivate: false }
  return { site: siteOf(pageView.webContents.getURL()), isPrivate: privateViews.has(pageView) }
}

/** Where a command acts: the site it names (Settings, always saved tweaks), else the shown page's site. */
function siteTweakTarget(site?: string): { site: string; isPrivate: boolean } | null {
  if (site) return { site, isPrivate: false }
  const shown = shownSiteTweakSite()
  return shown.site ? { site: shown.site, isPrivate: shown.isPrivate } : null
}

function siteTweakState(): SiteTweakState {
  const { site, isPrivate } = shownSiteTweakSite()
  return { site, tweak: site && siteTweaks ? siteTweaks.get(site, isPrivate) : null, isPrivate }
}

/** The element picker on the shown page: resolves with the selector the person clicked, previewed (hidden) until saved or cancelled. */
async function pickSiteElement(): Promise<SiteTweakPick> {
  if (!pageView || viewGone(pageView)) return { selector: null, error: 'Open a web page first.' }
  const contents = pageView.webContents
  if (!siteOf(contents.getURL())) return { selector: null, error: 'Site tweaks work on web pages.' }
  contents.focus()
  const picked: unknown = await contents.executeJavaScriptInIsolatedWorld(SITE_TWEAK_WORLD_ID, [{ code: PICK_ELEMENT_SCRIPT }]).catch(() => null)
  // Chosen, stopped or cancelled: the keyboard goes back to the panel (its Save, or Hide an element…), not left in the page.
  if (window && !window.isDestroyed()) window.webContents.focus()
  if (typeof picked !== 'string' || contents.isDestroyed()) return { selector: null }
  if (selectorProblem(picked)) return { selector: null, error: 'That element cannot be hidden.' }
  previewSelectors.set(contents.id, picked)
  void applyCosmeticFilters(contents)
  return { selector: picked }
}

/** Addresses of blocked ad frames, pictures and media, per page, so their empty boxes can be hidden. */
const blockedAdAddresses = new Map<number, { urls: string[]; timer: ReturnType<typeof setTimeout> | null }>()

/** Hides the space blocked ads leave behind (adCollapse.ts), in every frame, soon (batched). */
function scheduleAdCollapse(contentsId: number, url?: string, delay = 250): void {
  let entry = blockedAdAddresses.get(contentsId)
  if (!entry) blockedAdAddresses.set(contentsId, (entry = { urls: [], timer: null }))
  if (url && !entry.urls.includes(url)) entry.urls = [...entry.urls, url].slice(-200)
  if (entry.timer) return
  const pending = entry
  pending.timer = setTimeout(() => {
    pending.timer = null
    const contents = webContents.fromId(contentsId)
    if (!contents || contents.isDestroyed()) {
      blockedAdAddresses.delete(contentsId)
      return
    }
    const origin = (() => { try { return new URL(contents.getURL()).origin } catch { return '' } })()
    if (!origin.startsWith('http') || !protection.isSiteEnabled(origin, 'default') || !protection.cosmeticRules('', '').hideSelectors.length) return
    const script = collapseAdSlotsScript(pending.urls)
    // (Not contents.mainFrame: this timer can come after the page's renderer crashed, and reading it throws then.)
    for (const frame of framesOf(contents)) {
      if (!frame.detached) void frame.executeJavaScript(script).catch(() => undefined)
    }
  }, delay)
}

function wireProtectionSession(partition = DEFAULT_PARTITION): void {
  const guest = session.fromPartition(partition)
  guest.webRequest.onBeforeRequest((details, callback) => {
    // A quick window's page is attributed to it as a tab's page is.
    const routed = routeProtectionRequest(protection, protectionPages, details, [...(linkPreview ? [...allTabs(), { url: linkPreview.url, view: linkPreview.view }] : allTabs()), ...quickWindows.protectionTabs()])
    if (!routed) {
      callback({})
      return
    }
    const { webContentsId, decision } = routed
    if (decision.action === 'block') {
      if (pageView?.webContents.id === webContentsId) emitProtectionState()
      quickWindows.protectionChanged(webContentsId)
      // A blocked ad frame, picture or video leaves an empty box: hide it once it is in the page.
      if (webContentsId >= 0 && ['subFrame', 'image', 'media', 'object'].includes(details.resourceType)) scheduleAdCollapse(webContentsId, details.url)
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
  if (companionView) companionView.setVisible(pageViewShown(companionView))
}

/**
 * A panel the shell draws over the page (Settings, Knowledge, Absorb, a capture's crop, the tour): the page
 * stays hidden until the shell shows it again, through any re-layout meanwhile (the sidebar opening, a
 * resize, the page finishing loading), and whichever tab comes to the front.
 */
let pageCovered = false

function setPageCovered(covered: boolean): void {
  pageCovered = covered
  if (pageView && pageAttached) pageView.setVisible(pageViewShown(pageView))
  if (companionView) companionView.setVisible(pageViewShown(companionView))
}

/** The page view is drawn unless the shell draws over it (start page, error page, held, covered by a panel). */
function pageViewShown(view: WebContentsView): boolean {
  return !pageHeld && !pageCovered && !isStartView(view) && !openTabs.some((tab) => tab.view === view && tab.loadError)
}

function attachPageView(): void {
  if (!window || !pageView || pageAttached) return
  window.contentView.addChildView(pageView)
  // A start-page tab keeps its (blank) view hidden so the shell's start page shows and takes input.
  pageView.setVisible(pageViewShown(pageView))
  applyPageViewBounds()
  pageAttached = true
  syncCompanion()
  raiseLinkPreview()
  updateWindowButtons()
  schedulePersistentStateSave()
  emitPanelState()
}

/** The page area for the shown tab: the panel rect, less the tab dock's reservation. */
function pageAreaBounds(): BrowserPanelBounds {
  const viewportHeight = window?.getContentSize()[1] ?? lastBounds.y + lastBounds.height
  return pageViewBoundsForDock(lastBounds, viewportHeight, browserFullWidth, tabDockOpen, dockReserveNow ?? undefined)
}

/** The shown pair laid out in `area`: which side has focus, and the two tabs. Null unless two tabs are side by side on screen. */
function shownSplit(area: BrowserPanelBounds): { layout: SplitLayout; focused: SplitSide; focusedTab: OpenTab; otherTab: OpenTab } | null {
  if (!companionView || !pageView) return null
  const focusedTab = openTabs.find((tab) => tab.view === pageView)
  const otherTab = openTabs.find((tab) => tab.view === companionView)
  const side = focusedTab?.split?.side
  if (!focusedTab || !otherTab || !side) return null
  return { layout: splitBounds(area, focusedTab.split!.ratio), focused: side, focusedTab, otherTab }
}

function applyPageViewBounds(): void {
  if (!pageView) return
  if (htmlFullScreenView === pageView && window) {
    const [width = 0, height = 0] = window.getContentSize()
    pageView.setBounds({ x: 0, y: 0, width, height })
    // A page in full screen covers the window: the other side of its split waits out of sight.
    companionView?.setVisible(false)
    return
  }
  const area = pageAreaBounds()
  const pair = shownSplit(area)
  // A companion without a valid pair (its tab gone, the focus moved on) must not stay on screen with a stale rect.
  if (companionView && !pair) {
    removeFromWindow(companionView)
    companionView = null
  }
  if (pair && companionView) {
    const focusedRect = pair.focused === 'left' ? pair.layout.left : pair.layout.right
    const otherRect = pair.focused === 'left' ? pair.layout.right : pair.layout.left
    // Before the shell has reported its page area, the rects are only defaults: nothing shows yet.
    const ready = panelBoundsReported
    pageView.setBounds(focusedRect)
    companionView.setBounds(otherRect)
    pageView.setVisible(ready && pageViewShown(pageView))
    companionView.setVisible(ready && pageViewShown(companionView))
    return
  }
  // A tab dragged over an edge: the page gives up that half so the shell can offer the drop there.
  if (splitPreviewSide && !companionView) {
    pageView.setBounds(splitPreviewArea(area, splitPreviewSide).page)
    return
  }
  pageView.setBounds(area)
  // Back to one page: it is shown again if a split had hidden it.
  if (pageAttached) pageView.setVisible(pageViewShown(pageView))
}

/**
 * Keeps the other side of the shown tab's split attached beside the page, or takes it away when the
 * shown tab is no longer side by side. A side that was asleep wakes as it comes back on screen.
 */
function syncCompanion(): void {
  const focusedTab = pageAttached ? openTabs.find((tab) => tab.view === pageView) : undefined
  const partner = focusedTab ? partnerOf(openTabs, focusedTab) : undefined
  const want = partner && !viewGone(partner.view) ? partner.view : null
  const host = window && !window.isDestroyed() ? window : null
  if (companionView && companionView !== want && companionView !== pageView) removeFromWindow(companionView)
  companionView = want
  if (want && host) {
    unseenTabs.shown(want.webContents)
    if (!host.contentView.children.includes(want)) host.contentView.addChildView(want)
    // Asleep, or blank since its page crashed off screen: it loads again as the shown tab would.
    if (partner && (partner.asleep || !partner.view.webContents.isLoading())) wakeTab(partner)
    want.setVisible(pageViewShown(want))
    raiseLinkPreview()
  }
  applyPageViewBounds()
}

/** Ends the pair `tab` is in: both tabs are ordinary again, and the side that has the screen keeps it. */
function endSplit(tab: OpenTab): void {
  if (!tab.split) return
  unsplit(openTabs, tab.id)
  syncCompanion()
  emitTabs()
  emitPanelState()
  schedulePersistentStateSave()
}

/** Tabs moved, were pinned or changed folder: a pair that no longer sits together comes apart. */
function tabsRearranged(): void {
  repairSplits(openTabs)
  syncCompanion()
}

/** A pair moved by one of its tabs moves together: the partner goes beside it, on the side it holds. */
function keepPairTogether(tab: OpenTab): void {
  const partner = partnerOf(openTabs, tab)
  if (!partner) return
  const rest = openTabs.filter((item) => item !== partner)
  const at = rest.indexOf(tab) + (tab.split!.side === 'left' ? 1 : 0)
  openTabs.splice(0, openTabs.length, ...rest.slice(0, at), partner, ...rest.slice(at))
}

/** The partner of the shown tab, when it is side by side with one. */
function shownSplitPartner(): OpenTab | undefined {
  const shown = openTabs.find((tab) => tab.id === activeTabId)
  return shown ? partnerOf(openTabs, shown) : undefined
}

/** The split a tab is in (for the saved state, and the tab list). */
function splitOfTab(id: string): TabSplit | undefined {
  return openTabs.find((tab) => tab.id === id)?.split
}

/** The Compare record of a tab in any workspace (for the saved state). */
function compareOfTab(id: string): TabCompare | undefined {
  return allTabs().find((tab) => tab.id === id)?.compare
}

/** Pages side by side, for the panel: each side's tab and origin, the focused side, and the layout. */
function splitPanelState(): SplitPanelSnapshot | undefined {
  const pair = shownSplit(pageAreaBounds())
  if (!pair) return undefined
  const snapshots = tabSnapshots()
  const sideOf = (tab: OpenTab): SplitSideSnapshot => {
    const snapshot = snapshots.find((item) => item.id === tab.id)
    const url = snapshot?.url ?? ''
    const compare = compareLabelFor(tab.compare, url)
    return {
      id: tab.id,
      url,
      title: snapshot?.title ?? '',
      secure: safeHttpUrl(url)?.protocol === 'https:',
      ...(compare ? { compare } : {}),
      // Drawn by the shell in that side's half (its view is hidden), focused or not.
      ...(tab.loadError ? { loadError: tab.loadError } : {}),
      ...(tab.start ? { isStartPage: true as const } : {}),
    }
  }
  const left = pair.focused === 'left' ? pair.focusedTab : pair.otherTab
  const right = pair.focused === 'left' ? pair.otherTab : pair.focusedTab
  return {
    left: sideOf(left),
    right: sideOf(right),
    focused: pair.focused,
    ratio: pair.layout.ratio,
    divider: pair.layout.divider,
    headers: { left: pair.layout.leftHeader, right: pair.layout.rightHeader },
    sides: { left: pair.layout.left, right: pair.layout.right },
  }
}

/** The drop zone while a tab is dragged over an edge of the page (only when nothing is split yet). */
function splitPreviewState(): { side: SplitSide; zone: BrowserPanelBounds } | undefined {
  if (!splitPreviewSide || companionView || !pageView || !pageAttached) return undefined
  return { side: splitPreviewSide, zone: splitPreviewArea(pageAreaBounds(), splitPreviewSide).zone }
}

/**
 * Pages side by side (⌃⇧=, the tab menu, a tab dropped on the page's edge). `id` (default: the shown
 * tab) takes `side` (left by default); its partner is the named tab, else the next tab that can pair,
 * else a new tab on the start page, which takes the focus so it can be filled in. The tab `id` names
 * keeps the focus otherwise.
 */
function splitTabs(command: { id?: string; partnerId?: string; side?: SplitSide }): void {
  const tab = openTabs.find((item) => item.id === (command.id ?? activeTabId))
  if (!tab || tab.split) return
  if (tab.start || tab.loadError) throw new Error('Open a page in this tab first, then put it side by side.')
  const side = command.side ?? 'left'
  let partner: OpenTab | undefined
  if (command.partnerId) {
    partner = openTabs.find((item) => item.id === command.partnerId)
    if (!partner) throw new Error('That tab is gone.')
    if (partner.start || partner.loadError) throw new Error('Open a page in that tab first, then put it side by side.')
  } else {
    const at = openTabs.indexOf(tab)
    partner = openTabs.find((other, index) => index > at && canSplit(tab, other) && !other.split && !other.start && !other.loadError)
  }
  let created = false
  if (!partner) {
    // A new tab is ordinary and unfolded, and must be in the same privacy as this one.
    if (tab.pinned || tab.folderId || privateViews.has(tab.view) !== privateMode) {
      throw new Error('There is no tab to put beside this one. Open a new tab, or pick the tab in the menu.')
    }
    if (openTabs.length >= MAX_TABS) throw new Error(`${MAX_TABS} tabs are already open. Close a tab and try again.`)
    createStartTab()
    partner = openTabs[openTabs.length - 1]!
    created = true
  }
  if (!splitWith(openTabs, tab.id, partner.id, side)) {
    throw new Error('Those tabs cannot sit side by side: both must be private or both not, both pinned or both not, and in the same folder.')
  }
  splitPreviewSide = null
  if (pageAttached) showTab(created ? partner.id : tab.id)
  emitTabs()
  emitPanelState()
  schedulePersistentStateSave()
}

/** Compare tabs whose article has not loaded yet: where it first lands is the outlet's site (landedCompare). */
const compareLanding = new WeakSet<OpenTab>()

/** A country's name for a Compare label (the Mac's language), or the code when there is no name. */
function countryNameFor(code: string): string | undefined {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Compare (COMPARE_COVERAGE): two outlets' articles for one story, as two new tabs in the shown
 * workspace, split with the left one on the left. Both are private when private mode is on.
 */
function openCompare(command: { story: { id: string; title: string }; left: CompareSideInput; right: CompareSideInput }): void {
  const leftCompare = tabCompareFor(command.left, command.story, compareCountryName(command.left, countryNameFor))
  const rightCompare = tabCompareFor(command.right, command.story, compareCountryName(command.right, countryNameFor))
  if (!leftCompare || !rightCompare) throw new Error('Those articles cannot be opened.')
  if (openTabs.length + 2 > MAX_TABS) throw new Error(`${MAX_TABS} tabs are already open. Close a tab and try again.`)
  const leftView = createBrowserTab(command.left.url, false, privateMode)
  const rightView = createBrowserTab(command.right.url, false, privateMode)
  const left = tabOfView(leftView)
  const right = tabOfView(rightView)
  if (!left || !right) throw new Error('Those articles cannot be opened.')
  left.compare = leftCompare
  right.compare = rightCompare
  compareLanding.add(left)
  compareLanding.add(right)
  if (!splitWith(openTabs, left.id, right.id, 'left')) throw new Error('Those tabs cannot sit side by side.')
  // The left side loads when it is shown; the right side loads now, in the background.
  void right.view.webContents.loadURL(command.right.url).catch(() => undefined)
  showTab(left.id)
  emitTabs()
  emitPanelState()
  schedulePersistentStateSave()
}

/**
 * One side of the Compare pair on screen shows another outlet's article for its story (its own was gone):
 * the side keeps its place and its tab, and takes the other outlet's label.
 */
function compareOtherOutlet(command: { side: SplitSide; other: CompareSideInput }): void {
  const pair = shownSplit(pageAreaBounds())
  const tab = !pair ? undefined : pair.focused === command.side ? pair.focusedTab : pair.otherTab
  if (!tab?.compare || viewGone(tab.view)) throw new Error('That side is not comparing an article.')
  const target = safeHttpUrl(command.other.url)
  const compare = target ? tabCompareFor(command.other, { id: tab.compare.storyId, title: tab.compare.storyTitle }, compareCountryName(command.other, countryNameFor)) : null
  if (!target || !compare) throw new Error('That article cannot be opened.')
  tab.compare = compare
  compareLanding.add(tab)
  void tab.view.webContents.loadURL(target.toString()).catch(() => undefined)
  emitPanelState()
  schedulePersistentStateSave()
}

/** The tab menu's split items for a tab: its partner, or the tabs it could pair with now. */
function tabSplitChoices(target: OpenTab | undefined, id: string): TabMenuSplit | undefined {
  if (!target) return undefined
  const snapshots = tabSnapshots()
  const titleOf = (tab: OpenTab): string => snapshots.find((item) => item.id === tab.id)?.title || tab.url || 'New tab'
  const partner = partnerOf(openTabs, target)
  return {
    partner: partner ? { id: partner.id, title: titleOf(partner) } : null,
    candidates: openTabs
      .filter((other) => other.id !== id && !other.split && !other.start && !other.loadError && canSplit(target, other))
      .map((other) => ({ id: other.id, title: titleOf(other) })),
    split: (partnerId) => void handleBrowserCommand({ type: 'split-tab', id, ...(partnerId ? { partnerId } : {}) }).catch(() => undefined),
    unsplit: () => void handleBrowserCommand({ type: 'unsplit-tab', id }).catch(() => undefined),
  }
}

/** Ends the pair the tab (default: the shown one) is in. */
function unsplitTabCommand(id?: string): void {
  const tab = openTabs.find((item) => item.id === (id ?? activeTabId))
  if (tab) endSplit(tab)
}

/**
 * Whether the app window's own page (not a web page in it) took the keyboard last: told by focus events, so it
 * holds whether or not the window is in front.
 */
let shellHasKeyboard = false

/** Makes the side (left or right) of the shown pair the focused one, as its header or a click does. */
function focusSplitSide(side: SplitSide): void {
  const target = openTabs.find((tab) => tab.split?.side === side && (tab.view === pageView || tab.view === companionView))
  if (!target) return
  // The side already focused: its header still gives that page the keyboard (from the app window's controls).
  if (target.view !== pageView) showTab(target.id)
  // A start or error page is the shell's, drawn over a hidden view: the keyboard stays with the shell.
  if (!viewGone(target.view) && !target.start && !target.loadError) target.view.webContents.focus()
}

/** The divider moved: the shown pair's ratio (both tabs keep it). */
function setShownSplitRatio(ratio: number): void {
  const tab = openTabs.find((item) => item.id === activeTabId)
  if (!tab || !setSplitRatio(openTabs, tab.id, ratio)) return
  applyPageViewBounds()
  schedulePersistentStateSave()
  emitPanelState()
}

/** A tab is dragged over an edge of the page (or away): the page makes room for the drop zone. */
function setSplitPreview(side: SplitSide | null): void {
  if (splitPreviewSide === side) return
  splitPreviewSide = side
  applyPageViewBounds()
  emitPanelState()
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
    fileEmpty: existsSync(privateLibraryPath()) && statSync(privateLibraryPath()).size === 0,
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
      // Flushed to disk before it replaces the old file, like every other saved file.
      write: (data) => writeFileAtomicSync(passwordVaultPath(), data),
    },
  )
}

function passwordPage(view: WebContentsView): PasswordPage {
  const contents = view.webContents
  return {
    id: contents.id,
    isPrivate: privateViews.has(view),
    // A workspace with separate sign-ins offers only its own logins; everywhere else, the shared ones.
    workspaceId: privateViews.has(view) ? null : scopeWorkspaceId(scopeOfView(view)),
    origin: () => { const frame = mainFrameOf(contents); return frame ? passwordOrigin(frame.url) : null },
    fill: (message) => {
      mainFrameOf(contents)?.send(passwordPageChannels.fill, message)
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
    const tab = allTabs().find((item) => !viewGone(item.view) && item.view.webContents === event.sender)
    if (!tab || !event.senderFrame || event.senderFrame !== mainFrameOf(event.sender)) return
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
  const error = tabOfView(view)?.loadError
  return error ? { loadError: error } : {}
}

/** Show (or, with null, take away) a tab's error page. */
function setLoadError(view: WebContentsView, error: PageLoadError | null): void {
  const tab = tabOfView(view)
  if (!tab || (!error && !tab.loadError)) return
  if (error) tab.loadError = error
  else {
    delete tab.loadError
    tab.autoRetried = false
  }
  if (pageView === view && pageAttached) view.setVisible(pageViewShown(view))
  // The other side of a split on screen too: hidden while it fails, shown again once its page loads.
  if (companionView === view && panelBoundsReported) view.setVisible(pageViewShown(view))
  if (pageView === view || companionView === view) emitPanelState()
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

/** Every session a page can use gets the download and protection handlers, once each (a workspace's own included). */
function ensurePageSession(partition: string): void {
  if (wiredPartitions.has(partition)) return
  wiredPartitions.add(partition)
  wireDownloadSession(partition)
  wireProtectionSession(partition)
}

/** The partition a page view was built with (the shared one when none was recorded). */
function partitionOfView(view: WebContentsView): string {
  return viewPartitions.get(view) ?? DEFAULT_PARTITION
}

/** Whose permissions and saved logins a page view uses: private, the shared identity, or its workspace's own. */
function scopeOfView(view: WebContentsView): IdentityScope {
  return identityScope(partitionOfView(view))
}

/** The workspace a page view is in (null: none, as in a quick window). */
function workspaceOfView(view: WebContentsView): string | null {
  return viewWorkspaces.get(view) ?? null
}

/** The site permission store for a scope: memory for private tabs, the shared file, or a workspace's own file. */
function permissionStoreFor(isPrivate: boolean, scope: string): SitePermissionStore {
  if (isPrivate) return privatePermissions
  const id = scopeWorkspaceId(scope)
  if (!id) return normalPermissions!
  let store = workspacePermissionStores.get(id)
  if (!store) {
    store = new SitePermissionStore(join(app.getPath('userData'), workspacePermissionsFile(id)))
    workspacePermissionStores.set(id, store)
  }
  return store
}

function wireDownloadSession(partition = DEFAULT_PARTITION): void {
  const browsing = session.fromPartition(partition)
  const isPrivate = partition === PRIVATE_PARTITION
  // The session's own identity: a workspace's prompts and answers never cross into another's.
  const scope = identityScope(partition)
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
    // A workspace with its own sign-ins is named in the bar, which may show while another workspace is in front.
    const ownWorkspace = scopeWorkspaceId(scope)
    const workspace = ownWorkspace ? workspaces.get(ownWorkspace)?.name : undefined
    // The tab that asked is named in the bar when another tab is in front.
    const asking = tabOfContents(contents)
    sitePermissions.request({ origin: originOf(details.requestingUrl || contents.getURL()), topOrigin: originOf(contents.getURL()), kinds: kindsFor(permission, mediaTypes), isPrivate, owner: contents.id, scope, ...(workspace ? { workspace } : {}), ...(asking ? { tab: { id: asking.id, title: asking.title } } : {}) }, callback)
  })
  browsing.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    const mediaType = (details as { mediaType?: string }).mediaType
    const kinds = kindsFor(permission, mediaType === 'video' ? ['video'] : mediaType === 'audio' ? ['audio'] : [])
    const topOrigin = contents ? originOf(contents.getURL()) : originOf((details as { embeddingOrigin?: string }).embeddingOrigin ?? '')
    return sitePermissions?.check(originOf(requestingOrigin), kinds, isPrivate, topOrigin, scope) === true
  })
  // The guided tour's page needs no permission: its session refuses every request without asking
  // (it would otherwise ask, and answer, in the shared identity's name).
  const tour = partition === TOUR_PARTITION
  if (tour) {
    browsing.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browsing.setPermissionCheckHandler(() => false)
  }
  refuseCertificateErrors(browsing)
  servePageFiles(browsing)
  browsing.setSpellCheckerEnabled(true)
  if (process.platform !== 'darwin') {
    // macOS uses its own spell checker and languages; elsewhere, the person's preferred languages.
    const available = new Set(browsing.availableSpellCheckerLanguages)
    const preferred = app.getPreferredSystemLanguages().flatMap((code) => [code, code.split('-')[0] ?? code]).filter((code) => available.has(code))
    if (preferred.length) browsing.setSpellCheckerLanguages([...new Set(preferred)].slice(0, 3))
  }
  // Nor any download: refused before it starts, so nothing reaches the disk or the downloads list.
  if (tour) {
    browsing.on('will-download', (event) => event.preventDefault())
    return
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

/**
 * Page sessions whose certificate errors are refused, with one app listener for all of them (one per
 * session stayed on the app after its workspace was deleted).
 */
const certificateRefusingSessions = new Set<Electron.Session>()
function refuseCertificateErrors(browsing: Electron.Session): void {
  if (certificateRefusingSessions.size === 0) {
    app.on('certificate-error', (event, webContents, url, error, certificate, callback, isMainFrame) => {
      if (!certificateRefusingSessions.has(webContents.session)) return
      // Refused, as before; the error page shows what was wrong with the certificate.
      if (rejectCertificateErrorForSession(event, webContents, webContents.session, callback) && isMainFrame !== false) {
        certificateErrors.remember(webContents.id, url, summarizeCertificate(certificate, error))
      }
    })
  }
  certificateRefusingSessions.add(browsing)
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

/** The sign-in scope of a page's session (a workspace's own, or the shared one): whose answers it uses. */
function identityScopeOfSession(target: Electron.Session): IdentityScope {
  for (const partition of wiredPartitions) if (session.fromPartition(partition) === target) return identityScope(partition)
  return identityScope(DEFAULT_PARTITION)
}

/** A page (or its popup) wants to open another app: ask first (externalOpen.ts), with its workspace's own "Always allow" answers. */
function routeExternal(contents: Electron.WebContents, href: string): void {
  if (!externalOpener || contents.isDestroyed()) return
  const isPrivate = contents.session === session.fromPartition(PRIVATE_PARTITION)
  const result = externalOpener.request({ href, pageUrl: contents.getURL(), isPrivate, owner: contents.id, scope: identityScopeOfSession(contents.session) })
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
    normalPartition: DEFAULT_PARTITION,
    privatePartition: PRIVATE_PARTITION,
    // Clearing browsing data clears every workspace's own sign-ins too (a removed one until its Undo ends).
    workspacePartitions: () => [...workspaces.workspaces, ...(deletedWorkspace ? [deletedWorkspace.removed.workspace] : [])]
      .filter((workspace) => hasSeparateSignIns(workspace))
      .map((workspace) => workspacePartition(workspace.id)),
    seal: {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (text) => safeStorage.encryptStringAsync(text),
      decrypt: async (sealed) => (await safeStorage.decryptStringAsync(sealed)).result,
      encryptSync: (text) => safeStorage.encryptString(text),
      availableSync: () => safeStorage.isEncryptionAvailable(),
    },
    onDownloadDone: (entry) => emit({ type: 'download-finished', ...entry }),
    // The site icon file names the sites it holds icons for: deleted history must not stay readable there.
    onVisitsForgotten: (since) => { void faviconCache?.forgetSince(since) },
    onHistoryCleared: (since) => {
      tabArchive.deleteSince(since)
      savedTabArchive.removed((entry) => entry.archivedAt >= since)
      removeSetAside(tabArchiveFile())
      saveTabArchive()
    },
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
    const tab = tabOfView(view)
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
      title: tab.start ? 'New tab' : capTitle(liveTitle(tab) || tab.title || capUrl(tab.url)),
      favicon: tab.favicon,
      active: tab.id === activeTabId,
      isPrivate: privateViews.has(tab.view),
      ...(tab.start ? { isStartPage: true } : {}),
      ...liveTabFlags(live ? tab.view.webContents : null, tab, live && (unseenTabs.mutedUntilShown(tab.view.webContents) || closedWindowAudio.silenced(tab.view.webContents))),
      ...(tab.pinned && tab.home ? { home: capUrl(tab.home), ...(awayFromHome(safeHttpUrl(currentUrl) ? currentUrl : tab.url, tab.home) ? { awayFromHome: true } : {}) } : {}),
      ...(tab.asleep ? { asleep: true } : {}),
      ...(tab.lastShownAt ? { lastShownAt: tab.lastShownAt } : {}),
      ...(tab.folderId && !tab.pinned ? { folderId: tab.folderId } : {}),
      ...(tab.split ? { split: { partnerId: tab.split.partnerId, side: tab.split.side } } : {}),
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

/** The tab is about to load a page (`url`): stop drawing the start page and show the view. */
function leaveStartPage(view: WebContentsView, url?: string): void {
  const tab = tabOfView(view)
  if (!tab?.start) return
  tab.start = false
  // Until its first page commits, the tab and the toolbar show the address it is loading.
  if (url && safeHttpUrl(url)) tab.url = url
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
  const tab = tabOfView(view)
  if (!tab) return
  const url = view.webContents.getURL()
  // Not the address standing in for a woken page's title that has not arrived (liveTitle).
  const title = liveTitle(tab)
  if (safeHttpUrl(url)) tab.url = url
  if (title) tab.title = title
  emitTabs()
}

/** A tab's view is about to load its saved page (woken, restored, reopened, back after a crash): its saved title stands in until the page has its own. */
function keepSavedTitle(tab: OpenTab): void {
  if (tab.title) tab.keepTitle = true
}

/** The page has a title of its own, or has finished loading without one (its address is its title then, as Chromium has it). */
function pageTitleSettled(view: WebContentsView): void {
  const tab = tabOfView(view)
  if (tab) delete tab.keepTitle
}

function detachActive(): void {
  captures?.pageChanged('tab-changed', pageView)
  // A link preview opened from the page going away goes with it (one opened from the globe stays).
  // Deferred, as showTab does: this can run inside one of the preview's own events.
  const preview = linkPreview
  if (preview?.opener && (preview.opener === pageView || preview.opener === companionView)) {
    setImmediate(() => { if (linkPreview === preview) closeLinkPreview(false) })
  }
  if (window && pageView && pageAttached) {
    if (!viewGone(pageView)) pageView.webContents.stopFindInPage('clearSelection')
    window.contentView.removeChildView(pageView)
    pageAttached = false
    updateWindowButtons()
  }
  // The other side of a split goes with the page that was shown.
  if (companionView) removeFromWindow(companionView)
  companionView = null
}

/** Takes a view out of the window, if it is in it (a view that is gone or never added is left alone). */
function removeFromWindow(view: WebContentsView): void {
  if (!window || window.isDestroyed()) return
  if (window.contentView.children.includes(view)) window.contentView.removeChildView(view)
}

/**
 * Video follows you: the tab being left floats its largest playing video in picture-in-picture
 * (asked in its page; a refusal leaves playback where it was). Only with the setting on.
 */
function floatLeavingTab(view: WebContentsView): void {
  const tab = tabOfView(view)
  if (!autoPictureInPicture || !tab || tab.start || tab.loadError || tab.asleep || viewGone(view)) return
  void view.webContents.executeJavaScriptInIsolatedWorld(AUTO_PIP_WORLD_ID, [{ code: ENTER_PIP_SCRIPT }], true)
    .then((result: PipEnterResult) => {
      if (result !== 'entered') return
      // Shown again before the answer came back: it is docked already.
      if (activeTabId === tab.id) {
        void view.webContents.executeJavaScriptInIsolatedWorld(AUTO_PIP_WORLD_ID, [{ code: EXIT_PIP_SCRIPT }], true).catch(() => undefined)
        return
      }
      tab.pictureInPicture = true
      nowPlaying.update(tab.id, { pip: true }, Date.now())
      emitNowPlaying()
      watchFloatingWindow(tab, view)
    })
    .catch(() => undefined)
}

/**
 * The small window can close without the app: the person closes it, or uses its back-to-tab button.
 * The tab then no longer floats (it may sleep or be archived again, and the control stops saying so).
 */
function watchFloatingWindow(tab: OpenTab, view: WebContentsView): void {
  void view.webContents.executeJavaScriptInIsolatedWorld(AUTO_PIP_WORLD_ID, [{ code: PIP_LEFT_SCRIPT }])
    .then(() => {
      if (tab.view !== view || !tab.pictureInPicture) return
      delete tab.pictureInPicture
      nowPlaying.update(tab.id, { pip: false }, Date.now())
      emitNowPlaying()
    })
    .catch(() => undefined)
}

/** Docks a tab's floating video (the tab is shown again). */
function dockFloatingTab(tab: OpenTab): void {
  if (!tab.pictureInPicture) return
  delete tab.pictureInPicture
  nowPlaying.update(tab.id, { pip: false }, Date.now())
  if (!viewGone(tab.view)) void tab.view.webContents.executeJavaScriptInIsolatedWorld(AUTO_PIP_WORLD_ID, [{ code: EXIT_PIP_SCRIPT }], true).catch(() => undefined)
}

function showTab(id: string): WebContentsView | null {
  const tab = openTabs.find((item) => item.id === id)
  if (!tab) return null
  const preview = linkPreview
  if (preview) setImmediate(() => { if (linkPreview === preview) closeLinkPreview(false) })
  const partner = partnerOf(openTabs, tab)
  // The tab is one side of a pair already on screen: only the focus moves, nothing detaches or reloads.
  const sameSplit = pageAttached && companionView !== null && (companionView === tab.view || (partner !== undefined && companionView === partner.view))
  if (pageView && pageView !== tab.view && !sameSplit) {
    floatLeavingTab(pageView)
    detachActive()
  }
  const now = Date.now()
  const previous = openTabs.find((item) => item.id === activeTabId)
  // A moment before the tab shown now: with the same time on both, tab search (which lists tabs most recently
  // shown first) put whichever came first in the tab list on top, the tab just left or the one in front.
  if (previous && previous !== tab) previous.lastShownAt = now - 1
  tab.lastShownAt = now
  if (partner) partner.lastShownAt = now
  activeTabId = tab.id
  pageView = tab.view
  unseenTabs.shown(tab.view.webContents)
  const selectedUrl = tab.view.webContents.getURL()
  lastKnownUrl = safeHttpUrl(selectedUrl) ? selectedUrl : tab.url
  attachPageView()
  // Returning to a tab docks its floating video again.
  dockFloatingTab(tab)
  syncCompanion()
  emitTabs()
  emitPanelState()
  emitNowPlaying()
  emitProtectionState()
  emitPasswordState()
  // A tab that loaded in the background missed its cosmetic rules and tracker stand-ins.
  if (!tab.start && !tab.view.webContents.isLoading()) void applyCosmeticFilters(tab.view.webContents)
  wakeTab(tab)
  return tab.view
}

/** A tab shown again after sleeping (or restored): its page comes back where it was, or loads. */
function wakeTab(tab: OpenTab): void {
  const current = tab.view.webContents.getURL()
  const sleep = tab.asleep
  if (sleep) {
    delete tab.asleep
    emitTabs()
  }
  if (sleep?.history && (!current || current === 'about:blank')) {
    // Woken where it was: back/forward list and scroll position (page state) restored.
    restoreTabHistory(tab, sleep.history)
  } else if ((!current || current === 'about:blank') && safeHttpUrl(tab.url) && !restoringViews.has(tab.view) && crashRecovery.canAutoRecover(tab.id)) {
    loadBlankTab(tab)
  }
}

/**
 * A tab whose view is blank loads its page: where it was when its renderer crashed (back/forward
 * list and scroll restored, as a sleeping tab wakes), else at its address.
 */
function loadBlankTab(tab: OpenTab): void {
  const history = crashRecovery.takeHistory(tab.id)
  if (history) return restoreTabHistory(tab, history)
  keepSavedTitle(tab)
  void tab.view.webContents.loadURL(tab.url).catch(() => undefined)
}

/**
 * A tab's blank view gets its back/forward list back (historyRestore.ts). Its address loads instead
 * only when the list could not be restored at all and nothing has navigated since: a page that failed
 * shows its error page, and a newer navigation (a click, an address typed meanwhile) is never undone.
 */
function restoreTabHistory(tab: OpenTab, history: TabHistory): void {
  const view = tab.view
  restoringViews.add(view)
  keepSavedTitle(tab)
  void restoreHistoryOrLoad({
    restore: () => view.webContents.navigationHistory.restore(history),
    navigatedSince: () => {
      if (viewGone(view)) return true
      const now = view.webContents.getURL()
      return now !== '' && now !== 'about:blank'
    },
    load: () => {
      keepSavedTitle(tab)
      return view.webContents.loadURL(tab.url)
    },
  }).finally(() => restoringViews.delete(view))
}

/** A pinned tab is away from home once it is on another site (moving around the same site is not leaving). */
function awayFromHome(current: string, home: string): boolean {
  const here = safeHttpUrl(current)
  const there = safeHttpUrl(home)
  if (!here || !there) return false
  const site = (host: string): string => host.replace(/^www\./, '')
  return site(here.hostname) !== site(there.hostname)
}

/** Folders in the tab sidebar (tabOrder.ts), saved with the tabs. */
let tabFolders: TabFolder[] = []

function emitTabFolders(rename?: string): void {
  emit({ type: 'tab-folders', folders: tabFolders.map((folder) => ({ ...folder })), ...(rename ? { rename } : {}) })
}

function newFolderName(): string {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? 'New folder' : `New folder ${n}`
    if (!tabFolders.some((folder) => folder.name === name)) return name
  }
}

/** A new folder (at the top, or inside `parentId`) holding these tabs. */
function createTabFolder(name: string, parentId: string | null, tabIds: string[], rename = false): TabFolder | null {
  if (tabFolders.length >= MAX_FOLDERS) return null
  const folder: TabFolder = { id: randomUUID(), name, parentId: null }
  tabFolders.push(folder)
  if (parentId && canNest(tabFolders, folder.id, parentId)) folder.parentId = parentId
  for (const id of tabIds) setTabFolder(openTabs, tabFolders, id, folder.id)
  openTabs.splice(0, openTabs.length, ...folderedOrder(openTabs, tabFolders))
  emitTabFolders(rename ? folder.id : undefined)
  emitTabs()
  schedulePersistentStateSave()
  return folder
}

/** The latest grouping, kept for Undo for two minutes (tabGrouping.ts). Cleared when the shown workspace changes. */
let lastGrouping: { undoId: string; at: number; snapshot: GroupingSnapshot } | null = null

/** Put loose tabs into folders (tabGrouping.ts). Pinned and private tabs, and pairs side by side, stay where they are. */
function groupTabs(groups: TabGroupRequest[]): TabGroupResult {
  const plan = planGrouping({
    tabs: openTabs.map((tab) => ({ id: tab.id, pinned: tab.pinned, isPrivate: privateViews.has(tab.view), folderId: tab.folderId, split: tab.split })),
    folders: tabFolders,
    groups,
    maxFolders: MAX_FOLDERS,
    newId: randomUUID,
  })
  // Nothing to move (the tabs closed or left while Tidy's preview was open, or the folder limit): say so, with no Undo.
  if (plan.folderOf.size === 0) throw new Error(tabFolders.length >= MAX_FOLDERS ? `At most ${MAX_FOLDERS} folders.` : 'Those tabs are no longer open here.')
  const snapshot = snapshotGrouping(openTabs, tabFolders, plan.created)
  tabFolders = plan.folders
  for (const tab of openTabs) {
    const folderId = plan.folderOf.get(tab.id)
    if (folderId) tab.folderId = folderId
  }
  openTabs.splice(0, openTabs.length, ...folderedOrder(openTabs, tabFolders))
  const undoId = randomUUID()
  lastGrouping = { undoId, at: Date.now(), snapshot }
  emitTabFolders()
  tabsRearranged()
  emitTabs()
  schedulePersistentStateSave()
  // What was moved, not what was asked for: the notice says so.
  return { undoId, moved: plan.folderOf.size, folders: new Set(plan.folderOf.values()).size }
}

function undoGroupTabs(undoId: string): void {
  const last = lastGrouping
  if (!last || last.undoId !== undoId || Date.now() - last.at > UNDO_GROUPING_MS) throw new Error('Nothing to undo.')
  lastGrouping = null
  undoGrouping(openTabs, tabFolders, last.snapshot)
  emitTabFolders()
  tabsRearranged()
  emitTabs()
  schedulePersistentStateSave()
}

/** Laya for Tidy: set once Laya is made (its service is made later in startup). */
let tidyLaya: LayaService | null = null

const TIDY_LAYA_OFF = 'Tidy uses Laya, which runs on this Mac. Turn it on in Settings › Laya.'

/** Tidy's suggestions (tabTidy.ts): computed on this Mac, nothing moves. */
async function tidyTabsSuggest(): Promise<TidySuggestion> {
  const laya = tidyLaya
  if (!laya) return { available: false, reason: TIDY_LAYA_OFF }
  const status = await laya.status()
  if (!status.enabled) return { available: false, reason: TIDY_LAYA_OFF }
  if (!status.model.downloaded) return { available: false, reason: 'Laya’s model is not downloaded yet. Turn Laya on in Settings › Laya to download it.' }
  // Only web tabs that are loose, not private, reach the model: their titles and hosts, nothing else.
  const candidates = tidyCandidates(tabSnapshots())
  if (candidates.length < 2) return { available: true, groups: [] }
  const texts = candidates.map(tidyText)
  // Quality checks only: INTOPONET_TIDY_DEBUG=<file> records exactly what the model was given.
  if (process.env.INTOPONET_TIDY_DEBUG) appendFileSync(process.env.INTOPONET_TIDY_DEBUG, `${JSON.stringify({ texts })}\n`)
  const vectors = await laya.embedTexts(texts)
  if (!vectors) return { available: false, reason: 'Laya could not read these tabs right now.' }
  if (process.env.INTOPONET_TIDY_DEBUG) appendFileSync(process.env.INTOPONET_TIDY_DEBUG, `${JSON.stringify({ similarity: vectors.map((a) => vectors.map((b) => Number(dot(a, b).toFixed(3)))) })}\n`)
  return { available: true, groups: keepPairsWhole(suggestGroups(vectors, candidates), candidates) }
}

// ---- Workspaces (workspaces.ts) ----------------------------------------------------------------

/** How long a deleted workspace can be brought back before its tabs close. */
const WORKSPACE_UNDO_MS = 10_000

/** Tabs a workspace holds, as its row in the sidebar counts them (new, empty tabs and private tabs never count). */
function workspaceTabCount(id: string): number {
  const tabs = id === workspaces.activeId ? openTabs.filter((tab) => !privateViews.has(tab.view)) : workspaces.parkedOf(id)?.tabs ?? []
  return tabs.filter((tab) => !tab.start).length
}

function workspacesState(): WorkspacesState {
  const pending = deletedWorkspace?.removed
  return workspaces.snapshot(workspaceTabCount, pending ? { id: pending.workspace.id, name: pending.workspace.name, tabCount: pending.parked.tabs.filter((tab) => !tab.start).length } : null)
}

function emitWorkspaces(switchedMs?: number): void {
  emit({ type: 'workspaces', state: workspacesState(), ...(switchedMs !== undefined ? { switchedMs: Math.round(switchedMs * 10) / 10 } : {}) })
  appMenu.schedule()
}

/**
 * Shows another workspace: the shown one's tabs and folders are parked as they are (loaded pages
 * stay loaded, sleeping ones asleep) and the other's come back. Only the tab it last showed is shown
 * (and so loaded, if it slept); its other tabs are not touched. Private tabs stay where they are.
 */
function switchWorkspace(target: WorkspaceSwitch): boolean {
  const started = performance.now()
  const workspace = workspaces.resolve(target)
  if (!workspace || workspace.id === workspaces.activeId) return false
  if (tabSwitcher.open) endTabSwitcher('cancel')
  // A link preview is the shown workspace's page (its sign-ins): it closes, even over the globe, so Open as Tab cannot bring it into another.
  if (linkPreview) closeLinkPreview(false)
  const showing = pageAttached
  const privateTabs = openTabs.filter((tab) => privateViews.has(tab.view))
  const leaving = openTabs.filter((tab) => !privateViews.has(tab.view))
  const shownTab = leaving.find((tab) => tab.id === activeTabId)
  const next = workspaces.switchTo(workspace.id, { tabs: leaving, folders: tabFolders, activeTabId: shownTab?.id ?? null })
  if (!next) return false
  // What was shown goes out of sight (a private page too: the workspace asked for is what shows).
  const previous = openTabs.find((tab) => tab.id === activeTabId)
  if (previous) previous.lastShownAt = Date.now()
  // Leaving the workspace floats its playing video, as leaving a tab does (video follows you).
  if (pageView) floatLeavingTab(pageView)
  detachActive()
  pageView = null
  activeTabId = null
  openTabs.splice(0, openTabs.length, ...next.tabs, ...privateTabs)
  // A floating video of a tab in the workspace now shown docks, unless its tab is the one shown (showTab docks that).
  for (const tab of openTabs) if (tab.id !== next.activeTabId) dockFloatingTab(tab)
  tabFolders = next.folders
  lastGrouping = null
  const show = next.tabs.find((tab) => tab.id === next.activeTabId) ?? next.tabs.find((tab) => !tab.asleep) ?? next.tabs[0]
  if (showing) {
    if (show) showTab(show.id)
    // An empty workspace opens on a new tab, so the sidebar (and its way back) stays.
    else createStartTab()
  } else if (show) {
    // The globe is in front: the workspace's tab is ready to show, but nothing loads until it is.
    activeTabId = show.id
    pageView = show.view
    lastKnownUrl = show.url
  } else lastKnownUrl = ''
  emitTabFolders()
  emitTabs()
  emitPanelState()
  emitProtectionState()
  emitWorkspaces(performance.now() - started)
  emitNowPlaying()
  schedulePersistentStateSave()
  return true
}

/** The tabs a deleted workspace held are closed for good (Undo can no longer bring them back). */
function finishWorkspaceDelete(): void {
  const pending = deletedWorkspace
  if (!pending) return
  clearTimeout(pending.timer)
  deletedWorkspace = null
  for (const tab of pending.removed.parked.tabs) {
    crashRecovery.forget(tab.id)
    const contentsId = viewContentsIds.get(tab.view)
    if (contentsId !== undefined) {
      protectionPages.remove(contentsId)
      translateService?.forgetPage(contentsId)
    }
    if (!viewGone(tab.view)) tab.view.webContents.close()
  }
  // A workspace with its own sign-ins takes them with it, once Undo can no longer bring it back.
  // Quitting waits for this (before-quit), or its cookies and logins would outlive it on disk.
  if (hasSeparateSignIns(pending.removed.workspace)) {
    const forgetting = forgetWorkspaceIdentity(pending.removed.workspace.id).catch(() => undefined)
    writesInFlight.add(forgetting)
    void forgetting.finally(() => writesInFlight.delete(forgetting))
  }
  emitWorkspaces()
}

function deleteWorkspace(id: string): void {
  if (!workspaces.get(id)) throw new Error('That workspace is gone.')
  if (workspaces.workspaces.length < 2) throw new Error('The last workspace cannot be deleted.')
  // Only one Undo at a time: an earlier deletion is now final.
  finishWorkspaceDelete()
  if (id === workspaces.activeId) {
    const at = workspaces.workspaces.findIndex((workspace) => workspace.id === id)
    const neighbour = workspaces.workspaces[at + 1] ?? workspaces.workspaces[at - 1]
    if (neighbour) switchWorkspace({ id: neighbour.id })
  }
  const removed = workspaces.remove(id)
  if (!removed) return
  deletedWorkspace = { removed, timer: setTimeout(finishWorkspaceDelete, WORKSPACE_UNDO_MS) }
  deletedWorkspace.timer.unref?.()
  emitWorkspaces()
  schedulePersistentStateSave()
}

function undoWorkspaceDelete(): void {
  const pending = deletedWorkspace
  if (!pending) return
  clearTimeout(pending.timer)
  deletedWorkspace = null
  if (!workspaces.restore(pending.removed)) {
    deletedWorkspace = pending
    finishWorkspaceDelete()
    throw new Error('The workspace could not be brought back.')
  }
  switchWorkspace({ id: pending.removed.workspace.id })
  emitWorkspaces()
  schedulePersistentStateSave()
}

/** Asks in front of the window, as a sheet (the Touch ID prompt does the same). True when the person goes ahead. */
async function confirmInWindow(options: { message: string; detail: string; button: string }): Promise<boolean> {
  const dialogOptions = { type: 'question' as const, buttons: [options.button, 'Cancel'], defaultId: 0, cancelId: 1, message: options.message, detail: options.detail }
  const { response } = window && !window.isDestroyed() ? await dialog.showMessageBox(window, dialogOptions) : await dialog.showMessageBox(dialogOptions)
  return response === 0
}

/** The tabs of a workspace: the shown one's (without private tabs) or a parked one's. */
function tabsOf(workspaceId: string): OpenTab[] {
  if (workspaceId === workspaces.activeId) return openTabs.filter((tab) => !privateViews.has(tab.view))
  return workspaces.parkedOf(workspaceId)?.tabs ?? []
}

/**
 * A tab's page moves to the partition its workspace now uses: a loaded page is put to sleep (its
 * history kept, its cookies not), and a sleeping or start tab gets a view in the new partition.
 * The tab must not be the one showing (rebuildWorkspaceTabs and moveTabToWorkspace arrange that).
 */
function repartitionTab(tab: OpenTab): void {
  if (tab.pictureInPicture) delete tab.pictureInPicture
  if (!tab.start && !tab.asleep && !viewGone(tab.view)) {
    unloadTab(tab, { keepHistory: true })
    return
  }
  const old = tab.view
  tab.view = buildView(privateViews.has(old), workspaceOfView(old), untrackedViews.has(old))
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
 * A workspace's sign-ins changed (on, off, or cleared): its pages are put to sleep and built again
 * in the partition now in use, and the page in front wakes where it was. `beforeWake` runs once
 * the old pages are closed and before anything wakes (clearing the old data goes there). Nothing
 * outside the workspace is touched.
 */
async function rebuildWorkspaceTabs(workspaceId: string, beforeWake?: () => Promise<void>): Promise<void> {
  const tabs = tabsOf(workspaceId)
  const front = workspaceId === workspaces.activeId ? tabs.find((tab) => tab.view === pageView) : undefined
  const showing = pageAttached
  if (front) {
    // Off the screen first: a split's other side goes with it (it is rebuilt, and comes back with its pair).
    detachActive()
    pageView = null
    activeTabId = null
  }
  if (linkPreview && tabs.some((tab) => tab.view === linkPreview!.opener)) closeLinkPreview(false)
  for (const tab of [...tabs]) repartitionTab(tab)
  emitTabs()
  if (beforeWake) await beforeWake()
  if (front) {
    if (showing) showTab(front.id)
    else {
      activeTabId = front.id
      pageView = front.view
      lastKnownUrl = front.url
    }
  }
  emitTabs()
  emitPanelState()
  emitWorkspaces()
  schedulePersistentStateSave()
}

/** Deletes a partition's cookies, site storage, cache and HTTP sign-ins (its pages are never live while this runs). */
async function clearPartitionData(partition: string): Promise<void> {
  const target = session.fromPartition(partition)
  await target.clearStorageData().catch(() => undefined)
  await target.clearCache().catch(() => undefined)
  // A site's own sign-in box (HTTP authentication) is remembered apart from its cookies.
  await target.clearAuthCache().catch(() => undefined)
  // Open connections too: a site would otherwise see the signed-out pages arrive on the signed-in ones' connection.
  // (Not while a download through it is still coming in: closing would cut it off.)
  if (!browsingData?.downloads.receiving(partition)) await target.closeAllConnections().catch(() => undefined)
}

/**
 * A workspace's own site permissions and "Always allow" answers for other apps: prompts still waiting
 * end, and its answers are deleted from disk.
 */
function forgetWorkspacePermissions(workspaceId: string): void {
  sitePermissions?.clear(false, `ws:${workspaceId}`)
  workspacePermissionStores.delete(workspaceId)
  externalOpener?.forgetScope(`ws:${workspaceId}`)
  for (const file of [workspacePermissionsFile, workspaceExternalAppsFile]) {
    try {
      rmSync(join(app.getPath('userData'), file(workspaceId)), { force: true })
    } catch {
      // Nothing to remove.
    }
  }
}

/**
 * Everything a workspace keeps apart: its sign-ins and site data, its permissions and its saved logins.
 * `leftover`: found at startup with no page of this run using it, so its partition's folder is deleted
 * outright instead of being opened to be cleared.
 */
async function forgetWorkspaceIdentity(workspaceId: string, leftover = false): Promise<void> {
  forgetWorkspacePermissions(workspaceId)
  if (leftover) await rm(join(app.getPath('userData'), 'Partitions', workspacePartitionFolder(workspaceId)), { recursive: true, force: true }).catch(() => undefined)
  else await clearPartitionData(workspacePartition(workspaceId))
  await passwords?.forgetWorkspace(workspaceId).catch(() => undefined)
}

/** Names in a folder of the profile (none when it is not there). */
function namesIn(folder: string): string[] {
  try {
    return readdirSync(folder)
  } catch {
    return []
  }
}

/**
 * At startup: sign-ins, site data, permission answers and saved logins of a workspace that is gone or
 * no longer keeps its own, left when the app stopped before clearing them (a crash or force-quit in a
 * deletion's Undo window). Only once the saved workspaces loaded (workspaceIdentity.ts). Quitting waits for it.
 */
function sweepLeftoverSignIns(): void {
  const userData = app.getPath('userData')
  const opened = (id: string): boolean => [...wiredPartitions].some((partition) => partitionWorkspaceId(partition)?.toLowerCase() === id.toLowerCase())
  const sweep = sweepLeftoverIdentities(savedWorkspacesLoaded, {
    workspaces: () => [...workspaces.workspaces, ...(deletedWorkspace ? [deletedWorkspace.removed.workspace] : [])],
    partitionInUse: opened,
    partitionFolders: () => namesIn(join(userData, 'Partitions')),
    profileFiles: () => namesIn(userData),
    loginWorkspaceIds: () => passwords?.workspaceIds().catch(() => []) ?? Promise.resolve([]),
    forget: (id) => forgetWorkspaceIdentity(id, true),
  }).catch((error: unknown) => {
    console.error('Could not remove leftover sign-ins:', error)
    return []
  })
  writesInFlight.add(sweep)
  void sweep.finally(() => writesInFlight.delete(sweep))
}

/** Workspace actions menu: "Separate sign-ins" on or off (the shell has confirmed). */
async function setSeparateSignIns(workspaceId: string, separate: boolean): Promise<void> {
  const workspace = workspaces.get(workspaceId)
  if (!workspace) throw new Error('That workspace is gone.')
  if (separate && workspaceId === MAIN_WORKSPACE_ID) throw new Error('Main always shares its sign-ins.')
  // A hand-edited id that cannot name a partition: refused before the setting changes, so its tabs keep a session.
  if (separate && !isWorkspaceIdentityId(workspaceId)) throw new Error('This workspace cannot keep its own sign-ins.')
  if (hasSeparateSignIns(workspace) === separate) return
  workspaces.update(workspaceId, { separateSignIns: separate })
  if (separate) ensurePageSession(workspacePartition(workspaceId))
  // Turning it off deletes the workspace's own sign-ins, site data, permissions and saved logins once its pages are closed.
  await rebuildWorkspaceTabs(workspaceId, separate ? undefined : () => forgetWorkspaceIdentity(workspaceId))
}

/** "Clear sign-ins and site data…": only a workspace with separate sign-ins has any, and only its own are cleared. */
async function clearWorkspaceSignIns(workspaceId: string): Promise<void> {
  if (!hasSeparateSignIns(workspaces.get(workspaceId))) throw new Error('This workspace shares its sign-ins. Turn on Separate sign-ins first.')
  await rebuildWorkspaceTabs(workspaceId, () => clearPartitionData(workspacePartition(workspaceId)))
}

/**
 * Moves a tab of the shown workspace into another one (out of its folder: folders belong to a workspace).
 * When the two use different sign-ins, the person is told the tab reloads signed out, and it comes
 * back asleep in the new one: its history is kept, its cookies are not.
 */
async function moveTabToWorkspace(tabId: string, workspaceId: string): Promise<void> {
  const tab = openTabs.find((item) => item.id === tabId)
  if (!tab || privateViews.has(tab.view)) throw new Error('Private tabs are not part of any workspace.')
  if (workspaceId === workspaces.activeId || !workspaces.get(workspaceId)) return
  const from = workspaces.active()
  const to = workspaces.get(workspaceId)!
  const reloads = signInsChange(from, to)
  if (reloads) {
    const go = await confirmInWindow({
      message: `This tab will reload signed out in ${to.name}`,
      detail: `Sign-ins and site data stay with ${from.name}. The tab keeps its history.`,
      button: 'Move Tab',
    })
    // The answer took a while: the tab may have closed or the workspace changed meanwhile.
    if (!go || openTabs.indexOf(tab) < 0 || workspaces.activeId !== from.id) return
  }
  const index = openTabs.indexOf(tab)
  if (tab.split) endSplit(tab)
  if (activeTabId === tabId) {
    const next = openTabs.find((other, at) => at > index && !privateViews.has(other.view)) ?? [...openTabs.slice(0, index)].reverse().find((other) => !privateViews.has(other.view))
    if (next && pageAttached) showTab(next.id)
    else {
      detachActive()
      pageView = null
      activeTabId = null
    }
  }
  openTabs.splice(openTabs.indexOf(tab), 1)
  delete tab.folderId
  tab.lastShownAt = Date.now()
  viewWorkspaces.set(tab.view, workspaceId)
  workspaces.addToParked(workspaceId, tab)
  if (reloads) repartitionTab(tab)
  emitTabs()
  emitPanelState()
  emitWorkspaces()
  schedulePersistentStateSave()
}

/** A favourite opens in the shown workspace: its tab if one is at that page, otherwise a new one. */
async function openFavourite(id: string): Promise<void> {
  const favourite = workspaces.visibleFavourites().find((item) => item.id === id)
  if (!favourite) throw new Error('That favourite is gone.')
  const existing = openTabs.find((tab) => !viewGone(tab.view) && privateViews.has(tab.view) === privateMode && samePage(tab.view.webContents.getURL() || tab.url, favourite.url))
  if (existing) {
    showTab(existing.id)
    return
  }
  const view = createBrowserTab(favourite.url)
  if (view) await view.webContents.loadURL(favourite.url).catch(() => undefined)
}

async function handleWorkspaceCommand(command: WorkspaceCommand): Promise<WorkspacesState> {
  switch (command.type) {
    case 'get-workspaces':
      break
    case 'create-workspace': {
      const { type: _type, ...look } = command
      const workspace = workspaces.create(look)
      if (!workspace) throw new Error(`At most ${MAX_WORKSPACES} workspaces.`)
      switchWorkspace({ id: workspace.id })
      emitWorkspaces()
      schedulePersistentStateSave()
      break
    }
    case 'update-workspace': {
      const { type: _type, id, separateSignIns, ...changes } = command
      if (separateSignIns !== undefined) await setSeparateSignIns(id, separateSignIns)
      if (workspaces.update(id, changes) || separateSignIns !== undefined) {
        emitWorkspaces()
        schedulePersistentStateSave()
      }
      break
    }
    case 'clear-workspace-sign-ins':
      await clearWorkspaceSignIns(command.id)
      emitWorkspaces()
      schedulePersistentStateSave()
      break
    case 'move-workspace':
      if (workspaces.move(command.id, command.toIndex)) {
        emitWorkspaces()
        schedulePersistentStateSave()
      }
      break
    case 'delete-workspace':
      deleteWorkspace(command.id)
      break
    case 'undo-delete-workspace':
      undoWorkspaceDelete()
      break
    case 'switch-workspace': {
      const { type: _type, ...target } = command
      switchWorkspace(target)
      break
    }
    case 'move-tab-to-workspace':
      await moveTabToWorkspace(command.tabId, command.workspaceId)
      break
    case 'add-favourite': {
      const tab = openTabs.find((item) => item.id === command.tabId)
      if (!tab || privateViews.has(tab.view)) throw new Error('Private tabs cannot become favourites.')
      const live = !viewGone(tab.view)
      const url = live && safeHttpUrl(tab.view.webContents.getURL()) ? tab.view.webContents.getURL() : tab.url
      if (!safeHttpUrl(url)) throw new Error('Only web pages can be favourites.')
      if (!workspaces.addFavourite(capUrl(url), capTitle(liveTitle(tab) || tab.title), command.shared)) throw new Error(`At most ${MAX_FAVOURITES} favourites.`)
      emitWorkspaces()
      schedulePersistentStateSave()
      break
    }
    case 'update-favourite':
      if (workspaces.setFavouriteShared(command.id, command.shared)) {
        emitWorkspaces()
        schedulePersistentStateSave()
      }
      break
    case 'remove-favourite':
      if (workspaces.removeFavourite(command.id)) {
        emitWorkspaces()
        schedulePersistentStateSave()
      }
      break
    case 'open-favourite':
      await openFavourite(command.id)
      break
  }
  return workspacesState()
}

/** The tab sidebar's mode and width, saved with the tabs (null until first changed). */
let tabSidebar: TabSidebarState | null = null
/** Full width with the sidebar hidden: the pointer resting at the left edge of the page brings it back. */
let sidebarEdgeTimer: ReturnType<typeof setTimeout> | null = null

/** How long an unpinned tab goes unseen before it closes into Archived tabs (off unless chosen). */
let tabArchiveAfter: TabArchiveAfter = DEFAULT_TAB_ARCHIVE
/** Where links from other apps open (Settings › Browsing): a tab, or a quick window (quickWindow.ts). */
let linksFromOtherApps: LinksFromOtherApps = 'tab'
const tabArchive = new TabArchive()
/** Archived tabs are kept like history: sealed on disk (in memory only when the Mac cannot seal). */
const tabArchiveFile = (): string => join(app.getPath('userData'), 'personal', 'tab-archive.v1.seal')
let tabArchiveLoaded = false
/** Archived tabs saved before, while the Keychain is unavailable: read once it is, merged with this run's. */
const savedTabArchive = new UnreadSealedFile<ArchivedTab>({
  exists: () => existsSync(tabArchiveFile()),
  available: () => safeStorage.isEncryptionAvailable(),
  read: (keep) => tabArchive.load(safeStorage.decryptString(readFileSync(tabArchiveFile())), keep),
  setAside: () => { setAsideUnreadable(tabArchiveFile()) },
  // What it held is merged in: shown and saved with this run's archived tabs.
  onRead: () => saveTabArchive(),
})
const tabArchiveWriter = new LatestWriter<string>(async (payload) => {
  if (!safeStorage.isEncryptionAvailable()) return
  // Archived tabs that could not be read at startup are read now, before anything is written over them.
  if (savedTabArchive.isUnread) {
    if (!(await savedTabArchive.settle())) return
    payload = tabArchive.serialize()
  }
  mkdirSync(dirname(tabArchiveFile()), { recursive: true })
  await writeFileAtomic(tabArchiveFile(), safeStorage.encryptString(payload))
})
function saveTabArchive(): void {
  emit({ type: 'archived-tabs-changed' })
  if (!tabArchiveLoaded) return
  void tabArchiveWriter.save(tabArchive.serialize()).catch((error: unknown) => console.error('Could not save archived tabs:', error))
}
function loadTabArchive(): void {
  try {
    // Archived tabs that cannot be read are kept aside, never replaced by the next save. Without encryption
    // (the Keychain unavailable) they are read later, once they can be, and nothing is written over them until then.
    if (existsSync(tabArchiveFile())) {
      if (!safeStorage.isEncryptionAvailable()) savedTabArchive.markUnread()
      else if (!tabArchive.load(safeStorage.decryptString(readFileSync(tabArchiveFile())))) setAsideUnreadable(tabArchiveFile())
    }
  } catch (error) {
    console.error('Could not read archived tabs:', error)
    setAsideUnreadable(tabArchiveFile())
  } finally {
    tabArchiveLoaded = true
  }
}
/** Checks may shorten an "hour" so archiving can be seen in seconds; the app itself never sets this. */
const TAB_ARCHIVE_HOUR_MS = Math.max(50, Number(process.env['INTOPONET_TAB_ARCHIVE_HOUR_MS']) || 3_600_000)

/** Closes a tab into Archived tabs with its back/forward list (it does not go to Recently closed). */
function archiveTab(tab: OpenTab): ArchivedTab | null {
  const history = closingHistory(tab)
  const liveUrl = !viewGone(tab.view) ? tab.view.webContents.getURL() : ''
  const entry = tabArchive.add({
    url: safeHttpUrl(liveUrl) ? liveUrl : tab.url,
    title: liveTitle(tab) || tab.title,
    favicon: tab.favicon,
    // Only the shown workspace's tabs are archived.
    workspaceId: workspaces.activeId,
    ...(tab.folderId ? { folderId: tab.folderId } : {}),
    ...(history ? { history } : {}),
  })
  if (entry) discardTab(tab.id, false)
  return entry
}

/** Reopens archived tabs where they were (reopenTab): one is shown, in its workspace; several come back asleep, in the background. */
function reopenArchivedTabs(ids: string[]): void {
  const show = ids.length === 1
  for (const id of ids) {
    const entry = tabArchive.take(id)
    if (entry) reopenTab(entry, show)
  }
  emitTabs()
  saveTabArchive()
  schedulePersistentStateSave()
}

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
      title: tab.start ? 'New tab' : liveTitle(tab) || tab.title,
      url: tab.start ? '' : (live && safeHttpUrl(tab.view.webContents.getURL()) ? tab.view.webContents.getURL() : tab.url),
      favicon: tab.favicon,
      lastShownAt: tab.lastShownAt ?? 0,
      isPrivate: privateViews.has(tab.view),
      partnerId: partnerOf(openTabs, tab)?.id,
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
  emit({ type: 'tab-switcher', open: true, selected: switcherAnnouncement(chosen), position: step.index + 1, count: step.order.length })
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

// ---- Link preview (linkPreview.ts): a page in a card over the page or the globe ----

type LinkPreview = {
  /** The previewed page: an ordinary page view (same session as its opener), not yet a tab. */
  view: WebContentsView
  /** The card's frame: backdrop, title bar and buttons, filling the window under the page. */
  frame: WebContentsView
  /** The link as it was clicked (focus goes back to it). */
  url: string
  /** The page the link was in; null for the app window (a headline on the globe). */
  opener: WebContentsView | null
  isPrivate: boolean
  /** Stops watching the app window and the page underneath for focus. */
  unwatch: () => void
}
let linkPreview: LinkPreview | null = null

/** Where the card is centred: the page when one is showing, otherwise the whole window. */
function linkPreviewArea(): PreviewRect {
  if (pageView && pageAttached && !viewGone(pageView)) return pageView.getBounds()
  const [width = 1440, height = 940] = window?.getContentSize() ?? []
  return { x: 0, y: 0, width, height }
}

function layoutLinkPreview(): void {
  const preview = linkPreview
  if (!preview || !window || window.isDestroyed()) return
  const [width = 0, height = 0] = window.getContentSize()
  const { card, page } = previewLayout(linkPreviewArea())
  preview.frame.setBounds({ x: 0, y: 0, width, height })
  preview.view.setBounds(page)
  if (viewGone(preview.frame)) return
  const style = { left: `${card.x}px`, top: `${card.y}px`, width: `${card.width}px`, height: `${card.height}px` }
  void preview.frame.webContents.executeJavaScript(`(() => { const card = document.getElementById('link-preview-card'); if (card) Object.assign(card.style, ${JSON.stringify(style)}); return true })()`).catch(() => undefined)
}

/** Keeps the card above a page view that was just added to the window. */
function raiseLinkPreview(): void {
  if (!linkPreview || !window || window.isDestroyed()) return
  window.contentView.addChildView(linkPreview.frame)
  window.contentView.addChildView(linkPreview.view)
}

/** The title bar follows the page (its title once known, and its site). */
function updateLinkPreviewFrame(): void {
  const preview = linkPreview
  if (!preview || viewGone(preview.view) || viewGone(preview.frame)) return
  const url = preview.view.webContents.getURL() || preview.url
  const heading = previewHeading(preview.view.webContents.getTitle(), url)
  void preview.frame.webContents.executeJavaScript(`window.previewUpdate && window.previewUpdate(${JSON.stringify(heading)}, ${JSON.stringify(previewSite(url))}); true`).catch(() => undefined)
}

/** Tab past the page's last control (or ⇧Tab before its first) goes to the title bar, not out of the card. */
function armLinkPreviewFocusLoop(preview: LinkPreview): void {
  if (linkPreview !== preview || viewGone(preview.view)) return
  void preview.view.webContents.executeJavaScriptInIsolatedWorld(PREVIEW_WORLD_ID, [{ code: PREVIEW_FOCUS_LOOP_SCRIPT }])
    .then((direction: unknown) => {
      if (linkPreview !== preview || viewGone(preview.frame)) return
      preview.frame.webContents.focus()
      void preview.frame.webContents.executeJavaScript(`window.previewFocus && window.previewFocus(${JSON.stringify(direction === 'backward' ? 'last' : 'first')}); true`).catch(() => undefined)
      armLinkPreviewFocusLoop(preview)
    })
    .catch(() => undefined)
}

/**
 * ⇧-click, Preview Link, or a headline previewed from the globe: the page opens in a card over
 * the page (or the globe), in the opener's session; the app window's own headlines use the
 * current browsing mode. A link ⇧-clicked inside the card opens in the card.
 */
function openLinkPreview(urlValue: string, opener: WebContentsView | null): boolean {
  const target = safeHttpUrl(urlValue)
  if (!target || !window || window.isDestroyed()) return false
  const url = target.toString()
  if (linkPreview && opener === linkPreview.view) {
    void linkPreview.view.webContents.loadURL(url).catch(() => undefined)
    return true
  }
  if (linkPreview) closeLinkPreview(false)
  if (tabSwitcher.open) endTabSwitcher('cancel')
  const isPrivate = opener ? privateViews.has(opener) : privateMode
  // The preview is the opener's workspace's page: its sign-ins, not another's.
  const view = buildView(isPrivate, opener ? workspaceOfView(opener) : workspaces.activeId)
  view.setBorderRadius(8)
  // A page of our own with a little script: it only reports clicks and keys (as console lines).
  const frame = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } })
  frame.setBackgroundColor('#00000000')
  frame.webContents.on('will-navigate', (event) => event.preventDefault())
  frame.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const preview: LinkPreview = { view, frame, url, opener, isPrivate, unwatch: () => undefined }
  linkPreview = preview
  const current = (): boolean => linkPreview === preview
  const contentsId = view.webContents.id

  frame.webContents.on('console-message', (details) => {
    if (!current()) return
    const action = parsePreviewMessage(details.message)
    if (action === 'close') closeLinkPreview()
    else if (action === 'open-as-tab') openLinkPreviewAsTab()
    else if (action === 'focus-page-start' || action === 'focus-page-end') view.webContents.focus()
  })
  // Escape and ⌘W close the card (before the page or the menu bar see them).
  const keys = (event: Electron.Event, input: Electron.Input): void => {
    if (!current() || input.type !== 'keyDown') return
    const action = pageKeyAction(input, { developer: developerBuild() })
    const closeKey = action?.kind === 'command' && action.command.type === 'close-tab'
    const escape = input.key === 'Escape' && !input.meta && !input.control && !input.alt && htmlFullScreenView !== view
    if (!closeKey && !escape) return
    event.preventDefault()
    closeLinkPreview()
  }
  view.webContents.on('before-input-event', keys)
  frame.webContents.on('before-input-event', keys)

  // The same protection as a tab: blocked requests (wireProtectionSession), hidden ads and empty ad space.
  view.webContents.on('dom-ready', () => {
    if (!current()) return
    const ready = mainFrameOf(view.webContents)
    if (ready) void applyCosmeticFilters(view.webContents, { only: ready, url: view.webContents.getURL() })
    armLinkPreviewFocusLoop(preview)
  })
  view.webContents.on('did-frame-finish-load', (_event, _isMainFrame, frameProcessId, frameRoutingId) => {
    if (!current()) return
    const loaded = webFrameMain.fromId(frameProcessId, frameRoutingId)
    if (loaded) void applyCosmeticFilters(view.webContents, { only: loaded, url: view.webContents.getURL() })
  })
  view.webContents.on('did-stop-loading', () => {
    if (!current()) return
    void applyCosmeticFilters(view.webContents, { onlyNew: true, url: view.webContents.getURL() })
    scheduleAdCollapse(contentsId)
    scheduleAdCollapse(contentsId, undefined, 2_500)
    updateLinkPreviewFrame()
  })
  view.webContents.on('page-title-updated', () => { if (current()) updateLinkPreviewFrame() })
  view.webContents.on('did-navigate', () => { if (current()) updateLinkPreviewFrame() })
  view.webContents.on('did-navigate-in-page', () => { if (current()) updateLinkPreviewFrame() })
  // The page's first document may replace the view that had focus: keep it in the card.
  view.webContents.once('did-navigate', () => {
    if (current() && !viewGone(frame) && !frame.webContents.isFocused()) view.webContents.focus()
  })
  view.webContents.on('render-process-gone', () => { if (current()) closeLinkPreview(false) })
  view.webContents.once('destroyed', () => { if (current()) closeLinkPreview(false) })

  // Focus is trapped in the card: if the app window or the page underneath takes it (the window coming
  // back to the front, a click that slipped through), it goes back to the part of the card that had it.
  // Shortcuts that move on to the app (⌘L, ⌘T…) close the card first (showShellShortcut).
  let lastFocus: 'page' | 'frame' = 'page'
  view.webContents.on('focus', () => { if (current()) lastFocus = 'page' })
  frame.webContents.on('focus', () => { if (current()) lastFocus = 'frame' })
  const shell = window.webContents
  const under = pageView && pageAttached && !viewGone(pageView) ? pageView.webContents : null
  const elsewhere = (): void => {
    setImmediate(() => {
      if (!current() || viewGone(view) || viewGone(frame)) return
      if (lastFocus === 'frame') frame.webContents.focus()
      else view.webContents.focus()
    })
  }
  shell.on('focus', elsewhere)
  under?.on('focus', elsewhere)
  preview.unwatch = () => {
    if (!shell.isDestroyed()) shell.off('focus', elsewhere)
    if (under && !under.isDestroyed()) under.off('focus', elsewhere)
  }

  const [width = 0, height = 0] = window.getContentSize()
  const { card, page } = previewLayout(linkPreviewArea())
  frame.setBounds({ x: 0, y: 0, width, height })
  view.setBounds(page)
  window.contentView.addChildView(frame)
  window.contentView.addChildView(view)
  void frame.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(previewFrameHtml({ card, title: '', url, isPrivate }))}`).catch(() => undefined)
  void view.webContents.loadURL(url).catch(() => undefined)
  view.webContents.focus()
  appMenu.schedule()
  return true
}

/** Escape, a click outside, ⌘W or Close: the card goes, and focus goes back to the link (or the headline). */
function closeLinkPreview(restoreFocus = true): void {
  const preview = linkPreview
  if (!preview) return
  linkPreview = null
  preview.unwatch()
  if (window && !window.isDestroyed()) {
    window.contentView.removeChildView(preview.view)
    window.contentView.removeChildView(preview.frame)
  }
  if (!viewGone(preview.frame)) preview.frame.webContents.close()
  const contentsId = viewContentsIds.get(preview.view)
  if (contentsId !== undefined) {
    protectionPages.remove(contentsId)
    blockedAdAddresses.delete(contentsId)
  }
  if (!viewGone(preview.view)) preview.view.webContents.close()
  appMenu.schedule()
  if (!restoreFocus) return
  const opener = preview.opener
  if (opener && opener === pageView && pageAttached && !viewGone(opener)) {
    opener.webContents.focus()
    void opener.webContents.executeJavaScriptInIsolatedWorld(PREVIEW_WORLD_ID, [{ code: focusLinkScript(preview.url) }]).catch(() => undefined)
  } else if (window && !window.isDestroyed()) {
    window.webContents.focus()
  }
}

/** Open as Tab: the very same page (and its back list) becomes a tab and is shown. */
function openLinkPreviewAsTab(): void {
  const preview = linkPreview
  if (!preview) return
  if (viewGone(preview.view)) return closeLinkPreview(false)
  linkPreview = null
  preview.unwatch()
  const view = preview.view
  if (window && !window.isDestroyed()) {
    window.contentView.removeChildView(view)
    window.contentView.removeChildView(preview.frame)
  }
  if (!viewGone(preview.frame)) preview.frame.webContents.close()
  view.setBorderRadius(0)
  makeRoomForTab()
  const live = view.webContents.getURL()
  const tab: OpenTab = { id: randomUUID(), url: safeHttpUrl(live) ? live : preview.url, title: view.webContents.getTitle(), favicon: '', view }
  openTabs.push(tab)
  showTab(tab.id)
  // The icon it already reported, now that it is a tab.
  const icon = tabIconWanted.get(view)
  if (icon) updateTabIcon(view, icon)
  view.webContents.focus()
  schedulePersistentStateSave()
  appMenu.schedule()
}

/** Puts background tabs that have been out of sight long enough to sleep (see tabSleep.ts). */
async function sleepIdleTabs(): Promise<void> {
  if (sleepingNow) return
  sleepingNow = true
  try {
    const now = Date.now()
    // Tidy away: unpinned tabs unseen for the archive time close into Archived tabs (never private ones,
    // never with sound, a call, a download or typed text; history footprints must be on).
    const archiveMs = archiveAfterMs(tabArchiveAfter, TAB_ARCHIVE_HOUR_MS)
    if (archiveMs !== null && (browsingData?.history.policy.footprints ?? true)) {
      const archived: ArchivedTab[] = []
      for (const tab of [...openTabs]) {
        if (tab.id === activeTabId || tab.view === companionView || tab.pinned || tab.start || tab.loadError || tab.pictureInPicture || privateViews.has(tab.view) || untrackedViews.has(tab.view) || now - (tab.lastShownAt ?? now) < archiveMs) continue
        const live = !viewGone(tab.view) && !tab.asleep
        if (live) {
          const contents = tab.view.webContents
          if (contents.isCurrentlyAudible() || capturingContents.has(contents.id) || browsingData?.downloads.activeForPage(String(contents.id))) continue
          const typed = await answerWithin(contents.executeJavaScriptInIsolatedWorld(KEYS_WORLD_ID, [{ code: TYPED_FORM_SCRIPT }]), TYPED_CHECK_MS, true)
          if (typed !== false) continue
        }
        if (tab.id === activeTabId || !openTabs.includes(tab)) continue
        const entry = archiveTab(tab)
        if (entry) archived.push(entry)
      }
      if (archived.length) {
        emit({ type: 'tabs-archived', ids: archived.map((entry) => entry.id), titles: archived.map((entry) => entry.title || entry.url) })
        saveTabArchive()
      }
    }
    // Every workspace's tabs sleep alike (a workspace not shown is out of sight too).
    const due = tabsDueForSleep(allTabs().map((tab) => {
      const live = !viewGone(tab.view)
      const contentsId = live ? tab.view.webContents.id : -1
      return {
        id: tab.id,
        // Both sides of a split on screen are in use, not idle.
        active: tab.id === activeTabId || (live && tab.view === companionView),
        asleep: !!tab.asleep || !live,
        start: !!tab.start || !!tab.loadError,
        lastShownAt: tab.lastShownAt ?? now,
        audible: live && tab.view.webContents.isCurrentlyAudible(),
        pictureInPicture: tab.pictureInPicture === true,
        capturing: capturingContents.has(contentsId),
        downloading: live && (browsingData?.downloads.activeForPage(String(contentsId)) ?? false),
      }
    }), now, sleepAfterMs(tabSleepAfter, TAB_SLEEP_MINUTE_MS))
    for (const id of due) {
      const tab = allTabs().find((item) => item.id === id)
      if (!tab || viewGone(tab.view)) continue
      // Typed text not yet sent keeps a tab awake (it would be lost); so does a page that will not answer.
      const typed = await answerWithin(tab.view.webContents.executeJavaScriptInIsolatedWorld(KEYS_WORLD_ID, [{ code: TYPED_FORM_SCRIPT }]), TYPED_CHECK_MS, true)
      if (typed !== false || tab.id === activeTabId || tab.view === companionView || tab.asleep) continue
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
  if (tab.start || tab.asleep || viewGone(tab.view) || pageView === tab.view || companionView === tab.view) return
  nowPlaying.forget(tab.id)
  // Its media stops with its page: the now-playing control no longer lists it.
  emitNowPlaying()
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
  const nextUrl = options.url ?? (safeHttpUrl(liveUrl) ? liveUrl : tab.url)
  // Sent home from another page (a pinned tab closed while away): that page's title is not its home's.
  tab.title = samePage(nextUrl, safeHttpUrl(liveUrl) ? liveUrl : tab.url) ? liveTitle(tab) || tab.title : ''
  tab.url = nextUrl
  delete tab.loadError
  // The tab holds the replacement first, so closing the old page does not close the tab.
  tab.view = buildView(privateViews.has(old), workspaceOfView(old), untrackedViews.has(old))
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
  // Closing a side of a pair ends the pair first; the other side goes back to full size and, if this one had the screen, takes it.
  const partner = partnerOf(openTabs, tab)
  if (partner) {
    const focused = pageAttached && activeTabId === id
    endSplit(tab)
    if (focused) showTab(partner.id)
  }
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

function discardTab(id: string, remember = true): void {
  const index = openTabs.findIndex((tab) => tab.id === id)
  // The workspace it is closed in, so Recently closed can bring it back there.
  const workspaceId = index >= 0 ? workspaces.activeId : workspaces.workspaceOfParkedTab(id)
  // A tab in a workspace not shown (its page closed itself, say) goes from there.
  const tab = index >= 0 ? openTabs.splice(index, 1)[0] : workspaces.takeParkedTab(id)
  if (!tab) return
  if (index < 0) emitWorkspaces()
  nowPlaying.forget(tab.id)
  emitNowPlaying()
  if (remember) rememberClosedTab(tab, workspaceId)
  crashRecovery.forget(tab.id)
  // Its partner, if any, is whole again (its side of the split goes with this tab).
  if (tab.split) {
    const partner = openTabs.find((other) => other.id === tab.split!.partnerId)
    if (partner?.split?.partnerId === tab.id) delete partner.split
    delete tab.split
  }
  if (pageView === tab.view) {
    detachActive()
    pageView = null
    activeTabId = null
    lastKnownUrl = ''
    tabDockOpen = false
  } else if (companionView === tab.view) {
    syncCompanion()
  }
  const contentsId = viewContentsIds.get(tab.view)
  if (contentsId !== undefined) {
    protectionPages.remove(contentsId)
    translateService?.forgetPage(contentsId)
  }
  if (!viewGone(tab.view)) tab.view.webContents.close()
  // The last tab waiting for the network to come back is gone: stop checking for it.
  if (tab.loadError?.autoRetry) watchForNetwork()
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
  const scope = scopeOfView(opener)
  const asking = tabOfView(opener)
  sitePermissions.request({ origin: originOf(contents.getURL()), kinds: ['popups'], isPrivate, owner: contents.id, scope, ...(asking ? { tab: { id: asking.id, title: asking.title } } : {}) }, (granted) => {
    if (!granted || viewGone(opener) || !popupLimiter.allow(contents.id)) return
    const tab = createBrowserTab(target.toString(), true, isPrivate, true, false, opener)
    if (tab) void tab.webContents.loadURL(target.toString()).catch(() => undefined)
  })
}

/** Whether this site was always allowed pop-ups (the bar's "Always for this site"). */
function popupsAllowed(contents: Electron.WebContents, isPrivate: boolean, scope = 'default'): boolean {
  return sitePermissions?.check(originOf(contents.getURL()), ['popups'], isPrivate, null, scope) === true
}
const crashRecovery = new CrashRecoveryPolicy<TabHistory>()

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
  // The same protection as a tab: blocked ads hidden, and quiet stand-ins for blocked trackers
  // (a sign-in button that calls gtag() would otherwise throw and do nothing).
  const popup = child.webContents
  popup.on('dom-ready', () => { const ready = mainFrameOf(popup); if (ready) void applyCosmeticFilters(popup, { only: ready, url: popup.getURL() }) })
  popup.on('did-frame-navigate', (_event, _url, _code, _status, isMainFrame, frameProcessId, frameRoutingId) => {
    forgetCosmeticFrame(popup, isMainFrame, frameProcessId, frameRoutingId)
  })
  popup.on('did-frame-finish-load', (_event, _isMainFrame, frameProcessId, frameRoutingId) => {
    const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
    if (frame) void applyCosmeticFilters(popup, { only: frame, url: popup.getURL() })
  })
  popup.on('did-stop-loading', () => { void applyCosmeticFilters(popup, { onlyNew: true, url: popup.getURL() }) })
  const childContentsId = child.webContents.id
  trackUserActivation(child.webContents, userActivation)
  child.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
    const activated = userActivation.consume(childContentsId)
    const plan = nestedPopupDecision({ url, disposition, features }, popupLimiter, childContentsId, Date.now(), activated)
    if (plan.action === 'deny') {
      if (!plan.withoutGesture) emit({ type: 'navigation-failed', url, reason: plan.reason })
      return { action: 'deny' }
    }
    const tab = createBrowserTab(url, true, privateViews.has(opener), true, false, opener)
    if (tab) void tab.webContents.loadURL(url).catch(() => undefined)
    return { action: 'deny' }
  })
  child.webContents.once('destroyed', () => popupLimiter.forget(childContentsId))
  bindPopupCloseWithOwner(child, opener.webContents)
}

/**
 * A new tab in the shown workspace, or, when `opener` is a page of another workspace, in that one
 * (parked, unseen): a popup's tab is in its opener's workspace, with that workspace's sign-ins.
 */
function createBrowserTab(urlValue: string, activate = true, isPrivate = privateMode, openedByPage = false, localFile = false, opener: WebContentsView | null = null, untracked = false): WebContentsView | null {
  // A local file only when it was opened from Finder or another app (see openIncoming).
  const url = safeHttpUrl(urlValue) ?? (localFile && urlValue.startsWith('file:') ? new URL(urlValue) : null)
  if (!url) return null
  // A page never closes your tabs to make room for its own.
  if (openedByPage && openTabs.length >= MAX_TABS) {
    emit({ type: 'navigation-failed', url: url.toString(), reason: `A page tried to open another tab, but ${MAX_TABS} tabs are already open. Close a tab and try again.` })
    return null
  }
  const home = !isPrivate && opener && !viewGone(opener) ? workspaceOfView(opener) ?? workspaces.activeId : workspaces.activeId
  if (!workspaces.get(home)) return null
  makeRoomForTab()
  const view = buildView(isPrivate && !untracked, home, untracked)
  const tab: OpenTab = { id: randomUUID(), url: url.toString(), title: '', favicon: '', view }
  tab.lastShownAt = Date.now()
  if (!activate || home !== workspaces.activeId) unseenTabs.opened(view.webContents)
  if (home !== workspaces.activeId) {
    // Its page is in another workspace: the tab waits there (loaded, as a parked tab is) until that workspace is shown.
    workspaces.addToParked(home, tab)
    emitWorkspaces()
    schedulePersistentStateSave()
    return view
  }
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
      const newView = createBrowserTab(linkUrl, true, privateViews.has(view), false, false, view)
      if (newView) void newView.webContents.loadURL(linkUrl)
    } })
    items.push({ label: 'Preview Link', click: () => openLinkPreview(linkUrl, view) })
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
    const tab = createBrowserTab(url, true, privately, false, false, privately ? null : view)
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

/**
 * A page view for a tab. `workspaceId` is the workspace the tab belongs to (the shown one by
 * default; null for a quick window, which uses the shared sign-ins). The page's session is that
 * workspace's partition: its own sign-ins when it has separate ones, the shared ones otherwise,
 * and the private one for a private tab (workspaceIdentity.ts).
 */
function buildView(isPrivate = privateMode, workspaceId: string | null = workspaces.activeId, untracked = false): WebContentsView {
  let frequencyNavigation = 0
  let frequencyLoadSucceeded = false
  // A tab that leaves no trace (the tour's page) has a temporary session of its own (never private, never a
  // workspace's), set up as every page session is: what it loads goes when its last page closes (tourPageOpened).
  const partition = untracked ? TOUR_PARTITION : pagePartition(workspaceId === null ? null : workspaces.get(workspaceId), isPrivate)
  ensurePageSession(partition)
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...SAFE_DIALOG_PREFERENCES,
      // PDF links open in Chromium's built-in viewer without `plugins: true` (Electron 45; the
      // PDF_VIEWER feature check proves it), so plugins stay off.
      spellcheck: true,
      session: session.fromPartition(partition),
      // The sign-in helper for saved passwords; private tabs never get it.
      ...(isPrivate ? {} : { preload: join(__dirname, '../preload/page.js') }),
    },
  })
  viewPartitions.set(view, partition)
  viewWorkspaces.set(view, isPrivate ? null : workspaceId)
  if (isPrivate) privateViews.add(view)
  if (isPrivate) privateWebContents.add(view.webContents)
  // Marked before it loads (its first visit is not recorded either), and again on every view the tab is
  // rebuilt with (sleeping, a crash, a move): the tab never starts leaving traces.
  if (untracked) tourPageOpened(view)
  browsingData?.attachPage(view.webContents, () => privateViews.has(view) || untrackedViews.has(view), () => workspaceOfView(view) ?? undefined)

  // Behind a page before it paints: light, or dark when pages are dark (no white flash at night).
  view.setBackgroundColor(pageAppearance.current === 'dark' || (pageAppearance.current === 'system' && nativeTheme.shouldUseDarkColors) ? '#202124' : '#ffffff')
  // Once a page is there, the canvas behind it is white as in any browser: a page that sets no
  // background of its own expects white, and one that is dark (color-scheme) gets a dark canvas from Chromium.
  view.webContents.once('dom-ready', () => { if (!view.webContents.isDestroyed()) view.setBackgroundColor('#ffffff') })
  view.webContents.setWebRTCIPHandlingPolicy(WEBRTC_POLICY)
  view.webContents.on('before-mouse-event', (_event, input) => {
    // A click in a page silenced when the app window closed: the person is back in this tab, and it is heard again.
    if (input.type === 'mouseDown') closedWindowAudio.personActed(view.webContents)
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
    // A click in the other side of a split chooses that side, whether the keyboard focus came first or not.
    if (input.type === 'mouseDown' && companionView === view) {
      const tab = tabOfView(view)
      if (tab) {
        showTab(tab.id)
        view.webContents.focus()
      }
    }
  })
  // Browser keys pressed in a page: carried out here, so a page cannot swallow them. preventDefault
  // also keeps the menu bar from running the same key a second time.
  view.webContents.on('before-input-event', (event, input) => {
    // A key typed in a page silenced when the app window closed: heard again, as after a click in it.
    if (input.type === 'keyDown') closedWindowAudio.personActed(view.webContents)
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
    const action = pageKeyAction(input, { developer: developerBuild(), permissionBar: (sitePermissions?.list().length ?? 0) > 0 })
    if (!action) return
    // F6 with a site's request waiting: the keyboard goes to the bar, and comes back here once it is answered.
    if (action.kind === 'shell' && action.action === 'focus-permission-bar') permissionBarOpener = view
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
  view.webContents.on('did-start-navigation', (_event, startedUrl, inPlace, mainFrame) => {
    if (!mainFrame || inPlace) return
    loadingDocument.add(view)
    // A tab opened out of sight (behind, in a workspace not shown) loads as fast as a shown one.
    unseenTabs.loadStarted(view.webContents)
    // The page is about to be replaced: its inserted style and any previewed element go with it.
    previewSelectors.delete(view.webContents.id)
    blockedAdAddresses.delete(view.webContents.id)
    leaveStartPage(view, startedUrl)
    translateService?.forgetPage(view.webContents.id)
    frequencyNavigation += 1
    frequencyLoadSucceeded = false
  })
  view.webContents.on('did-navigate', (_event, _url, responseCode) => {
    frequencyLoadSucceeded = responseCode >= 200 && responseCode < 400
  })
  view.webContents.on('did-fail-load', (_event, _code, _description, _url, mainFrame) => {
    if (mainFrame) frequencyLoadSucceeded = false
    // Only a Compare article's first load can move its label (what loads after a failure is not that).
    const failed = mainFrame ? tabOfView(view) : undefined
    if (failed) compareLanding.delete(failed)
  })
  view.webContents.on('did-stop-loading', () => {
    loadingDocument.delete(view)
    unseenTabs.loadStopped(view.webContents)
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
    // ⇧-click (or ⇧↵) on a link: it opens in a card over the page (linkPreview.ts), not a window.
    if (isLinkPreviewRequest({ url, disposition, features }) && userActivation.consume(view.webContents.id)) {
      setImmediate(() => openLinkPreview(url, view))
      return { action: 'deny' }
    }
    // Only right after a click or key press in the page (or for a site always allowed pop-ups).
    const activated = userActivation.consume(view.webContents.id) || popupsAllowed(view.webContents, privateViews.has(view), scopeOfView(view))
    const plan = popupDecision({ url, disposition, features }, popupLimiter, view.webContents.id, Date.now(), activated)
    if (plan.action === 'deny') {
      if (plan.withoutGesture) blockedPopup(view, url)
      else emit({ type: 'navigation-failed', url, reason: plan.reason })
      return { action: 'deny' }
    }
    if (plan.action === 'tab') {
      // Same privacy as the page that opened it.
      const tab = createBrowserTab(url, !plan.background, privateViews.has(view), true, false, view)
      if (tab) void tab.webContents.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    }
    // Sign-in style popup: a small real window that keeps window.opener (same session as its page).
    return { action: 'allow', overrideBrowserWindowOptions: popupWindowOptions(plan, window) }
  })
  view.webContents.on('did-create-window', (child) => wirePopupWindow(child, view))
  // Capture the id now: by the time 'destroyed' fires, view.webContents is gone.
  const contentsId = view.webContents.id
  const pageContents = view.webContents
  viewContentsIds.set(view, contentsId)
  view.webContents.once('destroyed', () => {
    unseenTabs.forget(pageContents)
    // What was kept for the page goes with it, whichever way it closed (every page that loaded had an
    // ad-slot entry, kept after its tab closed; a quick window's page kept its protection counts too).
    const adSlots = blockedAdAddresses.get(contentsId)
    if (adSlots?.timer) clearTimeout(adSlots.timer)
    blockedAdAddresses.delete(contentsId)
    previewSelectors.delete(contentsId)
    protectionPages.remove(contentsId)
    translateService?.forgetPage(contentsId)
    popupLimiter.forget(contentsId)
    externalOpener?.dropOwner(contentsId)
    passwords?.forget(contentsId)
    // The page closed itself (window.close()) or its contents went away: drop its tab, unless the
    // whole window is closing (then the tabs are kept to be restored next launch).
    if (shellClosing) return
    const tab = tabOfView(view)
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
  // The tab's speaker icon, and the now-playing control (autoPip.ts).
  view.webContents.on('audio-state-changed', () => {
    emitTabs()
    emitNowPlaying()
  })
  view.webContents.on('media-started-playing', () => {
    // Media in a tab not yet seen waits for the tab to be shown (backgroundLoad.ts).
    if (unseenTabs.mediaStarted(view.webContents)) return
    setTabPlaying(view, true)
  })
  view.webContents.on('media-paused', () => setTabPlaying(view, false))
  view.webContents.on('did-navigate', () => {
    const tab = tabOfView(view)
    if (!tab) return
    // A new page: nothing of the old one floats any more.
    delete tab.pictureInPicture
    nowPlaying.forget(tab.id)
    emitNowPlaying()
  })
  view.webContents.on('did-stop-loading', () => {
    pageTitleSettled(view)
    rememberTab(view)
    if (pageView !== view) return
    emitPanelState()
    // Any frame the per-frame events missed.
    void applyCosmeticFilters(view.webContents, { onlyNew: true })
    // Empty ad slots, now and once late-loading slots have had time to appear.
    scheduleAdCollapse(view.webContents.id)
    scheduleAdCollapse(view.webContents.id, undefined, 2_500)
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
    // A site's style tweak goes into every tab of that site, background tabs included.
    void applySiteStyle(view)
    if (pageView !== view && companionView !== view) return
    // This page's own address: the other side of a split has its own site's rules, not the focused side's.
    const ready = mainFrameOf(view.webContents)
    if (ready) void applyCosmeticFilters(view.webContents, { only: ready, url: view.webContents.getURL() })
  })
  // A side of a split that takes the keyboard becomes the focused side (the toolbar and find follow it).
  view.webContents.on('focus', () => {
    shellHasKeyboard = false
    if (companionView !== view) return
    // Chromium hands the keyboard to a page starting a new document (a redirect, a page that reloads
    // itself) even beside the focused side. That is not the person choosing this side: the keyboard
    // goes back. A click in it still chooses it (before-mouse-event). Nor is a failed load's error
    // document, which can take the keyboard just after the failure is reported: that side's view is
    // hidden behind the shell's error card, which is what a click chooses it by.
    const tab = tabOfView(view)
    if (loadingDocument.has(view) || tab?.loadError || tab?.start) {
      // Back to the focused side, or to the shell when that side is the shell's own start or error page.
      if (pageView && pageAttached && !viewGone(pageView)) {
        if (pageViewShown(pageView) || !window || window.isDestroyed()) pageView.webContents.focus()
        else window.webContents.focus()
      }
      return
    }
    if (tab) showTab(tab.id)
  })
  view.webContents.on('did-navigate', (_event, url, responseCode) => {
    // A Compare article that redirected to another host as it first loaded is still that outlet's article.
    const landing = tabOfView(view)
    if (landing?.compare && compareLanding.delete(landing)) {
      landing.compare = landedCompare(landing.compare, url)
      schedulePersistentStateSave()
    }
    applySiteZoom(view, url)
    // A Compare side whose article is gone (the outlet answered 4xx or 5xx) shows that side's error card
    // (Retry, other outlets) instead of the site's blank or bare error page; other tabs show the site's own.
    setLoadError(view, landing?.compare && compareLabelFor(landing.compare, url) ? httpLoadError(responseCode, url) : null)
    rememberTab(view)
    protectionPages.commitNavigation(view.webContents.id, url)
    passwords?.navigated(view.webContents.id)
    if (pageView !== view) {
      // The other side's address and title are in the panel too (its header).
      if (companionView === view) emitPanelState()
      return
    }
    emitPasswordState()
    lastKnownUrl = url
    schedulePersistentStateSave()
    emitPanelState()
    emitProtectionState()
  })
  view.webContents.on('did-navigate-in-page', (_event, url) => {
    rememberTab(view)
    if (pageView !== view) {
      if (companionView === view) emitPanelState()
      return
    }
    lastKnownUrl = url
    schedulePersistentStateSave()
    emitPanelState()
  })
  view.webContents.on('page-title-updated', (_event, title) => {
    if (title) pageTitleSettled(view)
    rememberTab(view)
    if (pageView === view || companionView === view) emitPanelState()
  })
  view.webContents.on('page-favicon-updated', (_event, favicons) => {
    // Private and untracked tabs leave nothing in favicons.json (it names each site in plain text); nor does a visit
    // that history does not keep: a site to leave out, or any site while recent pages are off.
    if (favicons[0] && !privateViews.has(view) && !untrackedViews.has(view) && browsingData?.history.keeps(view.webContents.getURL())) faviconCache?.remember(view.webContents.getURL(), favicons[0])
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
      const tab = tabOfView(view)
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
    const tab = tabOfView(view)
    const currentUrl = view.webContents.getURL()
    const crashedUrl = safeHttpUrl(currentUrl) ? currentUrl : tab?.url || lastKnownUrl
    const mayAutoRecover = tab ? crashRecovery.recordCrash(tab.id) : false
    // Its back/forward list outlives the renderer: the page comes back with it (loadBlankTab).
    if (tab) {
      let history: TabHistory | undefined
      try {
        history = boundedHistory({ entries: view.webContents.navigationHistory.getAllEntries(), index: view.webContents.navigationHistory.getActiveIndex() })
      } catch {
        history = undefined
      }
      crashRecovery.keepHistory(tab.id, history)
    }
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
    const replacement = buildView(privateViews.has(view), workspaceOfView(view), untrackedViews.has(view))
    tab.view = replacement
    tab.url = crashedUrl
    delete tab.loadError
    if (activeTabId === tab.id) {
      pageView = replacement
      lastKnownUrl = crashedUrl
      attachPageView()
      if (mayAutoRecover) loadBlankTab(tab)
    } else if (companionView === view) {
      // The other side of the pair on screen: its replacement takes its place beside the page.
      if (mayAutoRecover) loadBlankTab(tab)
      syncCompanion()
      emitPanelState()
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
    case 'reload': {
      if (activeTabId === id) {
        await handleBrowserCommand({ type: 'reload' })
        break
      }
      if (!live) break
      const current = tab.view.webContents.getURL()
      if (current && current !== 'about:blank') tab.view.webContents.reload()
      // Asleep: it wakes where it was, in the background.
      else if (tab.asleep) wakeTab(tab)
      // Its renderer crashed (beside the page or behind it): asked for, it loads again even after repeated crashes.
      else if (!tab.start && safeHttpUrl(tab.url)) {
        crashRecovery.manualRetry(tab.id)
        loadBlankTab(tab)
      }
      break
    }
    case 'duplicate': {
      if (!safeHttpUrl(url)) break
      const at = duplicateIndex(openTabs, id)
      // A private tab's duplicate stays private.
      const view = createBrowserTab(url, true, privateViews.has(tab.view), false, false, tab.view)
      const copy = view && tabOfView(view)
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
  // A shortcut for the app (address bar, new tab…) moves on from a link preview.
  closeLinkPreview(false)
  window.webContents.focus()
  // The app window is still loading (just reopened by this command, or reloading): it gets it once it listens.
  if (shellShortcutsWaiting) {
    if (shellShortcutsWaiting.length < 8) shellShortcutsWaiting.push(action)
    return
  }
  emit({ type: 'shortcut', action })
}
/** The page whose F6 moved the keyboard to the permission bar: it gets the keyboard back when the bar is answered. */
let permissionBarOpener: WebContentsView | null = null
/** Shortcuts for an app window that is not listening yet; null once it is (its first get-state, sent right after it subscribes). */
let shellShortcutsWaiting: ShellShortcut[] | null = null

/** A menu bar command, or the same key pressed inside a page. */
function runAppCommand(command: AppCommand): void {
  // With the app window closed, a menu command brings it back first (a quick window's own commands need none).
  if ((!window || window.isDestroyed()) && !['new-quick-window', 'open-quick-in-main', 'close-tab'].includes(command.type)) reopenWindow()
  const route = routeAppCommand(command)
  if (route.kind === 'shell') return showShellShortcut(route.action)
  if (route.kind === 'host') {
    handleBrowserCommand(route.command).catch((error: unknown) => {
      console.error(`Intoponet: ${command.type} did not finish:`, error)
    })
    return
  }
  if (route.action === 'new-quick-window') return quickWindows.openEmpty()
  if (route.action === 'open-quick-in-main') {
    quickWindows.adoptFocused()
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

/**
 * The back/forward list a tab takes with it when it closes or is archived. Asleep, its view is blank:
 * the list it slept with is where it was. Its page crashed and it is still blank (in the background,
 * or waiting for Reload): the list its crashed page had. Otherwise its page's own.
 */
function closingHistory(tab: OpenTab): TabHistory | undefined {
  if (tab.asleep) return tab.asleep.history
  if (viewGone(tab.view)) return undefined
  const current = tab.view.webContents.getURL()
  const crashed = !current || current === 'about:blank' ? crashRecovery.keptHistory(tab.id) : undefined
  if (crashed) return crashed
  try {
    return { entries: tab.view.webContents.navigationHistory.getAllEntries(), index: tab.view.webContents.navigationHistory.getActiveIndex() }
  } catch {
    return undefined
  }
}

/** A closing tab joins Recently Closed (with its back/forward list, workspace and folder), unless it is private, untracked or a start page. */
function rememberClosedTab(tab: OpenTab, workspaceId: string | null): void {
  if (tab.start || privateViews.has(tab.view) || untrackedViews.has(tab.view)) return
  const liveUrl = !viewGone(tab.view) ? tab.view.webContents.getURL() : ''
  const history = closingHistory(tab)
  closedTabs.remember({
    url: safeHttpUrl(liveUrl) ? liveUrl : tab.url,
    title: liveTitle(tab) || tab.title,
    favicon: tab.favicon,
    isPrivate: false,
    workspaceId,
    ...(tab.folderId ? { folderId: tab.folderId } : {}),
    ...(history ? { history } : {}),
  })
}

/**
 * A tab reopened from Recently closed or Archived tabs comes back where it was (closedTabs.ts
 * reopenPlace): in the workspace it was closed in, built with that workspace's sign-ins, and in its
 * folder while that is there; with its workspace gone, in the one shown. It comes asleep with its
 * back/forward list, so it loads where it was once shown. `show` shows it, and its workspace first.
 */
function reopenTab(entry: { url: string; title: string; favicon: string; history?: TabHistory } & TabPlace, show: boolean): OpenTab | null {
  const url = safeHttpUrl(entry.url)
  if (!url) return null
  const place = reopenPlace(entry, workspaces.activeId, (id) => (id === workspaces.activeId ? tabFolders : workspaces.parkedOf(id)?.folders ?? null))
  const parked = place.workspaceId === workspaces.activeId ? null : workspaces.parkedOf(place.workspaceId)!
  if (!parked) makeRoomForTab()
  const tab: OpenTab = {
    id: randomUUID(), url: url.toString(), title: entry.title, favicon: entry.favicon, view: buildView(false, place.workspaceId),
    asleep: entry.history ? { history: entry.history } : {}, lastShownAt: Date.now(),
    ...(place.folderId ? { folderId: place.folderId } : {}),
  }
  if (parked) {
    parked.tabs.splice(0, parked.tabs.length, ...folderedOrder([...parked.tabs, tab], parked.folders))
    // Its workspace shows it first when switched to (nothing else there wakes, and no new tab is made).
    if (show) parked.activeTabId = tab.id
  } else {
    openTabs.splice(0, openTabs.length, ...folderedOrder([...openTabs, tab], tabFolders))
  }
  // Back in a folded folder, the folder opens so the tab is in sight (as moving it in with ⌥⇧↑/↓ does).
  if (place.folderId && revealFolder(parked ? parked.folders : tabFolders, place.folderId) && !parked) emitTabFolders()
  if (show) {
    if (parked) switchWorkspace({ id: place.workspaceId })
    if (activeTabId !== tab.id || !pageAttached) showTab(tab.id)
  }
  if (parked) emitWorkspaces()
  emitTabs()
  schedulePersistentStateSave()
  return tab
}

/** Reopens the newest closed tab (or the one asked for) where it was, with its back/forward list, and shows it. */
function reopenClosedTab(id?: string): void {
  const entry = closedTabs.take(id)
  if (entry) reopenTab(entry, true)
}

/** ⌘W: closes the tab being shown, then shows the tab that took its place, or the globe when none are left. */
function closeActiveTab(): void {
  if (linkPreview) return closeLinkPreview()
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
  // An error page is drawn by the shell; the view under it holds only Chromium's blank error page.
  if (tabOfView(view)?.loadError) {
    emit({ type: 'pdf-export', event: { state: 'failed', reason: 'This page did not load, so there is nothing to save.' } })
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
  // An error page has nothing of the site's to save (the view under it holds Chromium's blank error page).
  if (tabOfView(view)?.loadError) return
  const url = view.webContents.getURL()
  if (!safeHttpUrl(url)) return
  // A PDF is saved as the PDF itself, not as the viewer's wrapper page.
  const pdf = await isPdfDocument(view.webContents, PDF_WORLD_ID)
  if (viewGone(view) || !window || window.isDestroyed()) return
  const filename = savePageFilename(view.webContents.getTitle(), url, pdf ? 'pdf' : 'html')
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: 'Save Page As',
    defaultPath: join(app.getPath('downloads'), filename),
    filters: [pdf ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Web Page, Complete', extensions: ['html', 'htm'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })
  if (canceled || !filePath || viewGone(view)) return
  const name = basename(filePath)
  try {
    if (pdf) {
      // Fetched again through the tab's own session (its sign-ins), straight to the chosen file.
      const response = await view.webContents.session.fetch(url, { credentials: 'include' })
      if (!response.ok || !response.body) throw new Error(`The PDF could not be fetched (${response.status}).`)
      try {
        await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createWriteStream(filePath))
      } catch (error) {
        rmSync(filePath, { force: true })
        throw error
      }
    } else {
      await view.webContents.savePage(filePath, 'HTMLComplete')
    }
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
    // ⌘W closes a link preview first, also over the globe.
    tabShowing: (!!view && activeTabId !== null) || linkPreview !== null,
    hasPage,
    canGoBack: hasPage && view.webContents.navigationHistory.canGoBack(),
    canGoForward: hasPage && view.webContents.navigationHistory.canGoForward(),
    isLoading: hasPage && view.webContents.isLoading(),
    tabCount: openTabs.length,
    privateMode,
    recentlyClosed: closedTabs.list(),
    workspaceCount: workspaces.workspaces.length,
    splitActive: shownSplitPartner() !== undefined,
    developer: developerBuild(),
    quickWindowFocused: quickWindows.focused(),
  }
}

/**
 * Loads an address asked for with `open`: says so once the load has started (the address bar clears
 * then, not when the page has finished loading), and settles when it has loaded or failed.
 */
function loadOpened(view: WebContentsView, url: string): Promise<void> {
  const loading = view.webContents.loadURL(url)
  emit({ type: 'navigation-started', url })
  return loading
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
  panelBoundsReported = true
  applyPageViewBounds()
  layoutLinkPreview()
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
  | ArchivedTabSnapshot[]
  | TabFolderSnapshot
  | TabFolderSnapshot[]
  | BrowserPanelSnapshot
  | ProtectionSnapshot
  | PageTabSnapshot[]
  | ClosedTabSnapshot[]
  | PrivateLibraryReadResult
  | PublicFieldStatus
  | PdfExportSettings
  | SavedPdfRecord[]
  | WorkspacesState
  | SiteTweakState
  | SiteTweakListItem[]
  | SiteTweakSaveResult
  | SiteTweakPick
  | { undoId: string }
  | TidySuggestion
  | string
  | null
> {
  if (WORKSPACE_COMMAND_TYPES.has(command.type)) return handleWorkspaceCommand(command as WorkspaceCommand)
  switch (command.type) {
    case 'open': {
      const url = resolveNavigationIntent(command.intent)
      // ⌘↵ / ⌥↵ from the address bar: always a fresh tab, behind or in front.
      if (command.disposition) {
        // An untracked tab (the tour's page) is an ordinary tab, never private, in a session of its own (buildView).
        const view = createBrowserTab(url, command.disposition === 'foreground-tab', privateMode, false, false, null, command.untracked === true)
        if (view) await loadOpened(view, url)
        break
      }
      // From a new tab's start page, the page opens in that same tab.
      if (pageView && pageAttached && isStartView(pageView)) {
        const view = pageView
        leaveStartPage(view, url)
        lastKnownUrl = url
        await loadOpened(view, url)
        break
      }
      // Reuse an open tab only when it matches the current mode (private tabs and normal tabs never mix).
      const existing = openTabs.find((tab) => !viewGone(tab.view) && privateViews.has(tab.view) === privateMode && samePage(tab.view.webContents.getURL() || tab.url, url))
      if (existing) {
        showTab(existing.id)
        break
      }
      const view = createBrowserTab(url)
      if (view) await loadOpened(view, url)
      break
    }
    case 'new-tab':
      createStartTab()
      break
    case 'close':
      detachActive()
      // Back to the globe: a panel that covered the page has nothing to cover now (a page shown later is drawn).
      pageCovered = false
      schedulePersistentStateSave()
      emitTabs()
      break
    case 'restore':
      if (activeTabId) showTab(activeTabId)
      else if (openTabs[0]) showTab(openTabs[0].id)
      break
    case 'activate-tab': {
      // A tab in another workspace (the now-playing control's go-to): its workspace is shown first.
      const workspaceId = openTabs.some((tab) => tab.id === command.id) ? null : workspaces.workspaceOfParkedTab(command.id)
      if (workspaceId) switchWorkspace({ id: workspaceId })
      showTab(command.id)
      break
    }
    case 'close-tab':
      closeTab(command.id)
      break
    case 'tab-home': {
      const tab = openTabs.find((item) => item.id === command.id)
      if (!tab?.home) break
      if (tab.asleep) {
        delete tab.asleep
        // Asleep on another page: its title is not its home's (the home page brings its own).
        if (!samePage(tab.url, tab.home)) tab.title = ''
        tab.url = tab.home
        showTab(tab.id)
      } else {
        showTab(tab.id)
        if (!viewGone(tab.view)) void tab.view.webContents.loadURL(tab.home).catch(() => undefined)
      }
      break
    }
    case 'split-tab':
      splitTabs(command)
      break
    case 'unsplit-tab': {
      // From the app window (a side's Unsplit button, the command menu): the page left on screen takes the keyboard,
      // which was on a control that goes away with the split. ⌃⇧- in a page leaves it there; a tab's menu names its tab.
      const fromShell = !command.id && shellHasKeyboard
      unsplitTabCommand(command.id)
      const shown = openTabs.find((tab) => tab.id === activeTabId)
      if (fromShell && shown && pageView === shown.view && !viewGone(shown.view) && !shown.start && !shown.loadError && pageViewShown(shown.view)) shown.view.webContents.focus()
      break
    }
    case 'open-compare':
      openCompare(command)
      break
    case 'compare-other-outlet':
      compareOtherOutlet(command)
      break
    case 'set-split-ratio':
      setShownSplitRatio(command.ratio)
      break
    case 'focus-split-side':
      focusSplitSide(command.side)
      break
    case 'split-preview':
      setSplitPreview(command.side)
      break
    case 'tab-switcher':
      endTabSwitcher(command.action)
      break
    case 'preview-link':
      openLinkPreview(command.url, null)
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
    case 'move-tab': {
      // A pair moves as one row: a step onto its partner goes past it, and nothing lands between a pair's sides.
      const from = openTabs.findIndex((item) => item.id === command.id)
      const toIndex = pairMoveTarget(openTabs, command.id, command.toIndex)
      if (moveFolderedTab(openTabs, tabFolders, command.id, toIndex)) {
        const moved = openTabs.find((item) => item.id === command.id)
        if (moved) keepPairTogether(moved)
        keepOutOfPairs(openTabs, command.id, toIndex > from)
        tabsRearranged()
        // Moved (⌥⇧↑/↓) into a collapsed folder: the folder opens, so the tab stays in sight and keeps focus.
        if (moved?.folderId && revealFolder(tabFolders, moved.folderId)) emitTabFolders()
        emitTabs()
        schedulePersistentStateSave()
      }
      break
    }
    case 'set-tab-pinned':
      if (setPinned(openTabs, command.id, command.pinned)) {
        // Pinning records where the tab is as its home; unpinning forgets it.
        const tab = openTabs.find((item) => item.id === command.id)
        if (tab && command.pinned) {
          const current = viewGone(tab.view) ? '' : tab.view.webContents.getURL()
          const home = safeHttpUrl(current) ? current : tab.url
          if (safeHttpUrl(home)) tab.home = home
        } else if (tab) delete tab.home
        // Pinned tabs sit above folders.
        if (tab && command.pinned) delete tab.folderId
        openTabs.splice(0, openTabs.length, ...folderedOrder(openTabs, tabFolders))
        tabsRearranged()
        emitTabs()
        schedulePersistentStateSave()
      }
      break
    case 'set-tab-muted': {
      const tab = allTabs().find((item) => item.id === command.id)
      if (tab && !viewGone(tab.view)) {
        unseenTabs.mutedByPerson(tab.view.webContents)
        closedWindowAudio.mutedByPerson(tab.view.webContents)
        tab.view.webContents.setAudioMuted(command.muted)
        emitTabs()
        emitNowPlaying()
      }
      break
    }
    case 'now-playing-toggle': {
      const tab = allTabs().find((item) => item.id === command.id)
      if (!tab || viewGone(tab.view)) break
      // Play or pause the tab's media (a user gesture, so playback may start, and a tab silenced when the window closed is heard).
      closedWindowAudio.personActed(tab.view.webContents)
      void tab.view.webContents.executeJavaScriptInIsolatedWorld(AUTO_PIP_WORLD_ID, [{ code: TOGGLE_PLAYBACK_SCRIPT }], true)
        .then((result: string) => {
          // Paused from the control: it stays listed so it can be played again.
          if (result === 'paused') nowPlaying.update(tab.id, { playing: false, held: true }, Date.now())
          if (result === 'playing') nowPlaying.update(tab.id, { playing: true, held: false }, Date.now())
          emitNowPlaying()
        })
        .catch(() => undefined)
      break
    }
    case 'tab-menu': {
      if (!window || window.isDestroyed() || !openTabs.some((tab) => tab.id === command.id)) break
      const target = openTabs.find((tab) => tab.id === command.id)
      const menu = Menu.buildFromTemplate(tabMenuTemplate(tabSnapshots(), command.id, (action, id) => void runTabMenuAction(action, id), {
        folders: folderTreeOrder(tabFolders).map((id) => ({ id, name: tabFolders.find((folder) => folder.id === id)!.name, depth: folderDepth(tabFolders, id) })),
        current: target?.folderId ?? null,
        move: (folderId) => void handleBrowserCommand({ type: 'move-tab-to-folder', tabId: command.id, folderId }),
        createFolder: () => { createTabFolder(newFolderName(), null, [command.id], true) },
      }, {
        others: workspaces.workspaces.filter((workspace) => workspace.id !== workspaces.activeId).map(({ id, name }) => ({ id, name })),
        move: (workspaceId) => void handleBrowserCommand({ type: 'move-tab-to-workspace', tabId: command.id, workspaceId }).catch(() => undefined),
        moveToNew: workspaces.workspaces.length < MAX_WORKSPACES ? () => {
          const workspace = workspaces.create()
          if (workspace) void moveTabToWorkspace(command.id, workspace.id).catch(() => undefined)
        } : null,
        favourite: (() => {
          const live = target && !viewGone(target.view) ? target.view.webContents.getURL() : ''
          const url = safeHttpUrl(live) ? live : target?.url ?? ''
          if (!safeHttpUrl(url)) return null
          const existing = workspaces.visibleFavourites().find((favourite) => samePage(favourite.url, url))
          return {
            added: !!existing,
            toggle: () => void handleBrowserCommand(existing ? { type: 'remove-favourite', id: existing.id } : { type: 'add-favourite', tabId: command.id, shared: true }).catch(() => undefined),
          }
        })(),
      }, tabSplitChoices(target, command.id)))
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
      leaveStartPage(view, target.toString())
      const tab = tabOfView(view)
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
          loadBlankTab(tab)
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
      // Not a start page, and not an error page (its view holds only Chromium's blank error page).
      if (!pageView || viewGone(pageView) || isStartView(pageView) || tabOfView(pageView)?.loadError) break
      pageView.webContents.print({})
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
    case 'get-archived-tabs':
      // Archived tabs left unread at startup (the Keychain was unavailable) are read first if they can be now.
      await savedTabArchive.settle()
      return tabArchive.list()
    case 'get-tab-folders':
      return tabFolders.map((folder) => ({ ...folder }))
    case 'create-tab-folder': {
      const folder = createTabFolder(command.name, command.parentId, command.tabIds)
      if (!folder) throw new Error(`At most ${MAX_FOLDERS} folders.`)
      tabsRearranged()
      return { ...folder }
    }
    case 'update-tab-folder': {
      const folder = tabFolders.find((item) => item.id === command.id)
      if (!folder) break
      if (command.name !== undefined) folder.name = command.name
      if (command.collapsed !== undefined) {
        if (command.collapsed) folder.collapsed = true
        else delete folder.collapsed
      }
      if (command.parentId !== undefined && canNest(tabFolders, folder.id, command.parentId)) folder.parentId = command.parentId
      openTabs.splice(0, openTabs.length, ...folderedOrder(openTabs, tabFolders))
      emitTabFolders()
      emitTabs()
      schedulePersistentStateSave()
      break
    }
    case 'delete-tab-folder':
      if (deleteFolder(openTabs, tabFolders, command.id)) {
        tabsRearranged()
        emitTabFolders()
        emitTabs()
        schedulePersistentStateSave()
      }
      break
    case 'move-tab-to-folder':
      if (setTabFolder(openTabs, tabFolders, command.tabId, command.folderId)) {
        tabsRearranged()
        emitTabs()
        schedulePersistentStateSave()
      }
      break
    case 'open-tab-folder': {
      // A collection's pages, as a folder of tabs that load when shown (as many as fit).
      const urls = [...new Set(command.urls.filter((url) => safeHttpUrl(url)))]
      const room = Math.max(0, MAX_TABS - openTabs.length)
      if (!urls.length || room === 0) throw new Error(room === 0 ? `${MAX_TABS} tabs are already open.` : 'The collection has no web pages.')
      const ids: string[] = []
      for (const url of urls.slice(0, room)) {
        const view = createBrowserTab(url, false, false)
        const tab = view && tabOfView(view)
        if (!tab) continue
        tab.asleep = {}
        // It loads when shown, as a shown tab.
        unseenTabs.forget(tab.view.webContents)
        ids.push(tab.id)
      }
      const folder = createTabFolder(command.name, null, ids)
      if (!folder) throw new Error(`At most ${MAX_FOLDERS} folders.`)
      return { ...folder }
    }
    case 'group-tabs':
      return groupTabs(command.groups)
    case 'undo-group-tabs':
      undoGroupTabs(command.undoId)
      break
    case 'tidy-tabs-suggest':
      return tidyTabsSuggest()
    case 'run-menu-command': {
      const chosen = menuCommandById(command.id, { developer: developerBuild() })
      if (!chosen) throw new Error('Unknown menu command.')
      runAppCommand(chosen)
      break
    }
    case 'reopen-archived-tabs':
      reopenArchivedTabs(command.ids)
      break
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
      // The app window has just subscribed to its events: shortcuts chosen while it loaded are carried out now.
      if (shellShortcutsWaiting) {
        const waiting = shellShortcutsWaiting
        shellShortcutsWaiting = null
        setImmediate(() => { for (const action of waiting) showShellShortcut(action) })
      }
      break
    case 'site-tweak-state':
      return siteTweakState()
    case 'site-tweak-save': {
      const { site, isPrivate } = shownSiteTweakSite()
      if (!site || !siteTweaks) return { ok: false, error: 'Site tweaks work on web pages.' }
      const result = siteTweaks.save(site, command.tweak, isPrivate, Date.now())
      if (result.ok) {
        if (pageView) previewSelectors.delete(pageView.webContents.id)
        refreshSiteTweaks(site)
      }
      return result
    }
    case 'site-tweak-set-enabled': {
      const target = siteTweakTarget(command.site)
      if (target && siteTweaks) {
        siteTweaks.setEnabled(target.site, command.enabled, target.isPrivate, Date.now())
        refreshSiteTweaks(target.site)
      }
      return siteTweakState()
    }
    case 'site-tweak-remove': {
      const target = siteTweakTarget(command.site)
      if (target && siteTweaks) {
        siteTweaks.remove(target.site, target.isPrivate)
        refreshSiteTweaks(target.site)
      }
      return null
    }
    case 'site-tweak-list':
      return siteTweaks ? siteTweaks.store.list().map(({ site, tweak }) => listItem(site, tweak)) : []
    case 'site-tweak-pick':
      return pickSiteElement()
    case 'site-tweak-cancel-pick':
      if (pageView && !viewGone(pageView)) void pageView.webContents.executeJavaScriptInIsolatedWorld(SITE_TWEAK_WORLD_ID, [{ code: CANCEL_PICK_SCRIPT }]).catch(() => undefined)
      return null
    case 'site-tweak-clear-preview':
      if (pageView && !viewGone(pageView)) {
        previewSelectors.delete(pageView.webContents.id)
        void applyCosmeticFilters(pageView.webContents)
      }
      return null
    case 'get-protection':
      return protectionSnapshot()
    case 'set-site-protection': {
      const origin = currentOrigin()
      if (origin) {
        protection.setSiteEnabled(origin, 'default', command.enabled)
        persistExceptions()
      }
      if (pageView) void applyCosmeticFilters(pageView.webContents)
      if (pageView && command.enabled) scheduleAdCollapse(pageView.webContents.id)
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
  return !!frame && frame === mainFrameOf(window.webContents) && isAppShellUrl(frame.url, appShellUrl())
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
/** A page was in front when the app window closed: it is shown again when the window comes back. */
let reshowOnReopen = false
/** The app window again after it was closed (the Dock icon, a menu command): its tabs, with the one that was in front shown. */
function reopenWindow(): void {
  if (window && !window.isDestroyed()) return
  createWindow()
  const shown = reshowOnReopen ? openTabs.find((tab) => tab.id === activeTabId) : undefined
  reshowOnReopen = false
  if (shown) showTab(shown.id)
  emitTabs()
}
/** The app window's page reloads after a crash, waiting longer while it keeps crashing (crashRecovery.ts). */
const shellReloads = new ShellReloadPolicy()
/** How long a hung app window gets to answer again before it is reloaded (it has already not answered for a while). */
const SHELL_HANG_GRACE_MS = 3_000

function createWindow(): void {
  shellClosing = false
  stateWritesClosed = false
  // Not listening until its page has loaded: shortcuts wait (showShellShortcut).
  shellShortcutsWaiting = []
  // Pages whose contents went away while the last window was closed (macOS keeps the app running).
  for (const tab of openTabs.filter((item) => viewGone(item.view))) {
    openTabs.splice(openTabs.indexOf(tab), 1)
    if (activeTabId === tab.id) activeTabId = null
  }
  for (const tab of workspaces.parkedTabs().filter((item) => viewGone(item.view))) workspaces.takeParkedTab(tab.id)
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

  window.webContents.on('focus', () => { shellHasKeyboard = true })

  // A reloaded shell cannot release a page it held or covered before (its panels start closed), nor see a
  // screen recording it started. It starts out of full width (toolbar tucked away, no tab dock, sidebar at
  // rest): the page area follows it.
  window.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    shellShortcutsWaiting ??= []
    setPageHeld(false)
    setPageCovered(false)
    setBrowserFullWidth(false)
    tabRailExpanded = false
    captures?.shellReloaded()
    // A tour still running ends with the page it ran in: its own page closes, as the tour would have closed it.
    for (const tab of allTabs().filter((item) => untrackedViews.has(item.view))) discardTab(tab.id, false)
  })

  // The app's own page went away (its renderer crashed or was stopped) or hangs: it loads again. Tabs,
  // workspaces and pages live here in the main process, so the reloaded shell finds them where they were.
  const shell = window
  let shellReload: ReturnType<typeof setTimeout> | null = null
  let shellHang: ReturnType<typeof setTimeout> | null = null
  shell.webContents.on('render-process-gone', (_event, details) => {
    if (shellClosing || shell.isDestroyed() || details.reason === 'clean-exit') return
    if (shellHang) clearTimeout(shellHang)
    shellHang = null
    if (shellReload) return
    const wait = shellReloads.crashed()
    console.error(`The app window stopped (${details.reason}); it reloads${wait ? ` in ${wait / 1000} s` : ''}.`)
    shellReload = setTimeout(() => {
      shellReload = null
      if (!shell.isDestroyed() && !shellClosing) shell.webContents.reload()
    }, wait)
  })
  // Hung (it has not answered input for a while): after a short grace, its renderer is stopped and it reloads as above.
  shell.on('unresponsive', () => {
    if (shellHang || shellClosing) return
    shellHang = setTimeout(() => {
      shellHang = null
      if (!shell.isDestroyed() && !shellClosing && !shell.webContents.isCrashed()) shell.webContents.forcefullyCrashRenderer()
    }, SHELL_HANG_GRACE_MS)
  })
  shell.on('responsive', () => {
    if (shellHang) clearTimeout(shellHang)
    shellHang = null
  })
  shell.once('closed', () => {
    if (shellReload) clearTimeout(shellReload)
    if (shellHang) clearTimeout(shellHang)
    shellReload = null
    shellHang = null
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
    layoutLinkPreview()
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
    // Its tabs stay alive for the Dock to bring back, but nothing goes on playing unseen.
    pauseAllMedia()
    if (persistenceTimer) clearTimeout(persistenceTimer)
    persistenceTimer = null
    // On quit, before-quit already wrote the final state; otherwise (macOS keeps running) save now,
    // in order after any save already on its way.
    if (!stateWritesClosed) savePersistentState().catch((error: unknown) => console.error('Could not save open tabs:', error))
    stateWritesClosed = true
    // The tab in front (and its pair) is shown again when the window comes back (reopenWindow).
    reshowOnReopen = pageAttached && activeTabId !== null
    window = null
    pageView = null
    companionView = null
    pageAttached = false
    // No tab is in front now: ⌘W is Close Window again (it closes nothing), and page items are off.
    appMenu.schedule()
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
    tabArchive: tabArchiveAfter,
    linksFromOtherApps,
    autoPictureInPicture,
    defaultBrowser: {
      isDefault: app.isDefaultProtocolClient('http') && app.isDefaultProtocolClient('https'),
      // Only the installed app: from a development build macOS would register Electron itself.
      canSet: process.platform === 'darwin' && app.isPackaged,
    },
  }
}

// ---- Link routes (linkRoutes.ts): links from other apps by site, to a workspace ----
let linkRouteRules: LinkRoute[] | null = null
const linkRoutesFile = (): string => join(app.getPath('userData'), 'link-routes.json')
/** The saved rules, read once (a missing or damaged file gives none). */
function linkRules(): LinkRoute[] {
  if (!linkRouteRules) {
    try {
      linkRouteRules = parseLinkRoutes(JSON.parse(readFileSync(linkRoutesFile(), 'utf8')) as unknown)
    } catch {
      linkRouteRules = []
      // Rules that cannot be read are kept aside, never replaced by the next rule saved.
      if (existsSync(linkRoutesFile())) setAsideUnreadable(linkRoutesFile())
    }
  }
  return linkRouteRules
}
function setLinkRules(rules: LinkRoute[]): void {
  linkRouteRules = rules
  void trackedWrite(linkRoutesFile(), serializeLinkRoutes(rules)).catch((error: unknown) => console.error('Could not save link routes:', error))
}
const workspaceExists = (id: string): boolean => !!workspaces.get(id)
function linkRoutesState(): LinkRoutesState {
  const list = workspacesState().workspaces
  const names = new Map(list.map((workspace) => [workspace.id, workspace.name]))
  return {
    rules: linkRules().map((rule) => ({ ...rule, workspaceName: names.get(rule.workspaceId) ?? null })),
    workspaces: list.map((workspace) => ({ id: workspace.id, name: workspace.name })),
  }
}
/** The state after a change, sent to Settings (where it may be open) as well as returned. */
function linkRoutesChanged(): LinkRoutesState {
  const state = linkRoutesState()
  emitBrowsing({ type: 'link-routes', state })
  return state
}
/** The quick window's "Always open here…": a native menu of the workspaces; the choice saves the rule, shows that workspace and moves the page into it. */
function offerAlwaysOpenHere(url: string, win: BrowserWindow, moveHere: () => boolean): void {
  const site = siteOfWebUrl(url)
  if (!site) return
  const items = workspacesState().workspaces.map((workspace) => ({
    label: `Always open ${site} in ${workspace.name}`,
    click: () => {
      const added = addLinkRoute(linkRules(), { site, workspaceId: workspace.id, id: randomUUID() }, workspaceExists)
      if (!added) return
      setLinkRules(added.rules)
      linkRoutesChanged()
      switchWorkspace({ id: workspace.id })
      moveHere()
    },
  }))
  if (items.length === 0) return
  Menu.buildFromTemplate(items).popup({ window: win })
}

function wireBrowsing(): void {
  const settingsFile = join(app.getPath('userData'), 'browsing-settings.json')
  // "Always allow" for other apps: the shared answers, and each workspace with its own sign-ins has its own file.
  const rememberedFile = (scope: string): string | null => {
    const name = externalAppsFile(scope)
    return name ? join(app.getPath('userData'), name) : null
  }
  const readJson = (path: string): unknown => {
    // A settings file that cannot be read is kept aside, not saved over.
    try { return JSON.parse(readFileSync(path, 'utf8')) as unknown } catch { setAsideUnreadable(path); return null }
  }
  const stored = parseBrowsingSettingsFile(readJson(settingsFile))
  pageAppearance.set(stored.pageAppearance)
  tabSleepAfter = stored.tabSleep
  tabSwitchOrder = stored.tabSwitchOrder
  tabArchiveAfter = stored.tabArchive
  linksFromOtherApps = parseLinksFromOtherApps(stored.linksFromOtherApps)
  autoPictureInPicture = stored.autoPictureInPicture
  const saveSettings = (): Promise<void> => trackedWrite(settingsFile, JSON.stringify({ pageAppearance: pageAppearance.current, tabSleep: tabSleepAfter, tabSwitchOrder, tabArchive: tabArchiveAfter, linksFromOtherApps, autoPictureInPicture })).catch(() => undefined)
  externalOpener = new ExternalOpenBroker({
    emit: emitBrowsing,
    openExternal: (href) => shell.openExternal(href, { activate: true }),
    appName: (href) => {
      try { return app.getApplicationNameForProtocol(href).replace(/\.app$/i, '') } catch { return '' }
    },
    load: (scope) => {
      const file = rememberedFile(scope)
      return file ? readJson(file) : null
    },
    save: (scope, data) => {
      const file = rememberedFile(scope)
      if (file) trackedWrite(file, data).catch((error: unknown) => console.error('Could not save app links:', error))
    },
  })
  handleFromShell(browsingChannels.command, async (_event, value: unknown) => {
    const command = parseBrowsingCommand(value)
    switch (command.type) {
      case 'external-decide':
        externalOpener?.decide(command.id, command.decision, command.always)
        return null
      case 'external-pending':
        return externalOpener?.list() ?? []
      case 'get-held-incoming':
        return incomingBurst.state()
      case 'open-held-incoming':
        incomingBurst.openRest()
        return null
      case 'dismiss-held-incoming':
        incomingBurst.dismiss()
        return null
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
      case 'set-auto-picture-in-picture':
        autoPictureInPicture = command.enabled
        await saveSettings()
        emitBrowsing({ type: 'settings', settings: browsingSettings() })
        return browsingSettings()
      case 'set-tab-archive':
        tabArchiveAfter = command.after
        await saveSettings()
        emitBrowsing({ type: 'settings', settings: browsingSettings() })
        return browsingSettings()
      case 'set-links-from-other-apps':
        linksFromOtherApps = command.choice
        await saveSettings()
        emitBrowsing({ type: 'settings', settings: browsingSettings() })
        return browsingSettings()
      case 'get-link-routes':
        return linkRoutesState()
      case 'add-link-route': {
        const added = addLinkRoute(linkRules(), { site: command.site, workspaceId: command.workspaceId, id: randomUUID() }, workspaceExists)
        if (!added) throw new Error('That is not a site, or its workspace is gone.')
        setLinkRules(added.rules)
        return linkRoutesChanged()
      }
      case 'update-link-route': {
        const updated = updateLinkRoute(linkRules(), command.id, { site: command.site, workspaceId: command.workspaceId }, workspaceExists)
        if (!updated) throw new Error('That rule cannot take this change.')
        setLinkRules(updated)
        return linkRoutesChanged()
      }
      case 'move-link-route': {
        const moved = moveLinkRoute(linkRules(), command.id, command.toIndex)
        if (!moved) throw new Error('That rule is gone.')
        setLinkRules(moved)
        return linkRoutesChanged()
      }
      case 'remove-link-route': {
        const removed = removeLinkRoute(linkRules(), command.id)
        if (!removed) throw new Error('That rule is gone.')
        setLinkRules(removed)
        return linkRoutesChanged()
      }
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

/**
 * A quick window's page becomes a tab of the main window, shown (⌘O). The same web contents, so
 * history, scroll position and session carry over without a reload.
 */
function adoptQuickView(view: WebContentsView, url: string): boolean {
  if (!window || window.isDestroyed()) createWindow()
  makeRoomForTab()
  const tab: OpenTab = { id: randomUUID(), url, title: view.webContents.getTitle(), favicon: '', view, lastShownAt: Date.now() }
  openTabs.push(tab)
  // The page now belongs to the shown workspace. A quick window's page runs with the shared
  // sign-ins; in a workspace with its own, it reloads in that workspace's session (history kept,
  // cookies not), so the shared identity never shows up there.
  const isPrivate = privateViews.has(view)
  viewWorkspaces.set(view, isPrivate ? null : workspaces.activeId)
  if (partitionOfView(view) !== pagePartition(workspaces.active(), isPrivate)) repartitionTab(tab)
  showTab(tab.id)
  // The icon it already reported, now that it is a tab (as openLinkPreviewAsTab does).
  const icon = tabIconWanted.get(view)
  if (icon) updateTabIcon(tab.view, icon)
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  tab.view.webContents.focus()
  schedulePersistentStateSave()
  appMenu.schedule()
  return true
}

/** A command pressed in a quick window that the main window runs: the main window comes forward first. */
function runInMainWindow(command: AppCommand): void {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  runAppCommand(command)
}

/** A link or file from another app: a new tab (or a quick window, when Settings says so), with the window brought forward. */
function openIncoming(target: IncomingTarget): void {
  // A rule sends the link to its workspace, as a tab, whatever the quick-window setting says. Private browsing is never routed.
  const routed = target.kind === 'web' && !privateMode ? routeFor(target.url, linkRules(), (id) => !!workspaces.get(id)) : null
  if (target.kind === 'web' && !routed && linksFromOtherApps === 'quick-window') {
    quickWindows.open(target.url, privateMode)
    return
  }
  if (!window || window.isDestroyed()) createWindow()
  if (routed) switchWorkspace({ id: routed })
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
/**
 * A sidebar browser's spaces, as workspaces (browserImport/plan.ts worked out what to add): each
 * workspace made or added to, its pinned tabs, its folders nested as they were (matched by name in
 * a workspace already here), its open tabs, and the favourites. Tabs come unloaded, like restored
 * ones. Nothing here can fail part way: the plan already fits every limit.
 */
function addImportedWorkspaces(plan: WorkspaceImportPlan): void {
  for (const planned of plan.workspaces) {
    const id = planned.existingId ?? workspaces.create({ name: planned.name })?.id
    if (!id) continue
    const target = id === workspaces.activeId ? { tabs: openTabs, folders: tabFolders } : workspaces.parkedOf(id)
    if (!target) continue
    // Each imported page is unloaded and built in the workspace it joins (its sign-ins).
    const unloaded = (page: { url: string; title: string }, extra: Partial<OpenTab> = {}): OpenTab => ({ id: randomUUID(), url: page.url, title: page.title, favicon: '', view: buildView(false, id), asleep: {}, lastShownAt: Date.now(), ...extra })
    const added: OpenTab[] = planned.pinned.map((page) => unloaded(page, { pinned: true, home: page.url }))
    const addFolders = (list: readonly FolderPlan[], parentId: string | null): void => {
      for (const folder of list) {
        let made = target.folders.find((item) => item.name === folder.name && item.parentId === parentId)
        if (!made && target.folders.length < MAX_FOLDERS) {
          made = { id: randomUUID(), name: folder.name, parentId }
          target.folders.push(made)
        }
        // No room for another folder: its tabs join the folder it was in.
        const home = made?.id ?? parentId
        for (const page of folder.tabs) added.push(unloaded(page, home ? { folderId: home } : {}))
        addFolders(folder.children, home)
      }
    }
    addFolders(planned.folders, null)
    for (const page of planned.open) added.push(unloaded(page))
    target.tabs.push(...added)
    target.tabs.splice(0, target.tabs.length, ...folderedOrder(pinnedFirst(target.tabs), target.folders))
  }
  for (const favourite of plan.favourites) workspaces.addFavourite(favourite.url, favourite.title, true)
  emitTabFolders()
  emitTabs()
  emitWorkspaces()
  schedulePersistentStateSave()
}

/** Settings › Import from another browser (browserImport/service.ts). */
function wireImportFromBrowsers(): void {
  const addImportedTabs = (tabs: ImportedTab[]): void => {
    // Unloaded, like restored tabs: each page loads when it is first shown. Never in private mode.
    for (const tab of tabs) {
      if (openTabs.length >= MAX_TABS || !safeHttpUrl(tab.url)) continue
      openTabs.push({ id: randomUUID(), url: tab.url, title: tab.title, favicon: '', view: buildView(false), asleep: {}, lastShownAt: Date.now(), ...(tab.pinned ? { pinned: true, home: tab.url } : {}) })
    }
    openTabs.splice(0, openTabs.length, ...pinnedFirst(openTabs))
    emitTabs()
    schedulePersistentStateSave()
  }
  wireBrowserImport(handleFromShell, new BrowserImportService({
    root: () => importRoot(process.env, app.getPath('userData')),
    tabs: { urls: () => openTabs.flatMap(heldAddresses), room: () => MAX_TABS - openTabs.length, limit: MAX_TABS, add: addImportedTabs },
    history: () => browsingData?.history ?? null,
    passwords: () => passwords,
    toOrigin: passwordOrigin,
    workspaces: {
      existing: () => workspaces.workspaces.map((workspace) => {
        const shown = workspace.id === workspaces.activeId
        const held = shown ? openTabs.filter((tab) => !privateViews.has(tab.view)) : workspaces.parkedOf(workspace.id)?.tabs ?? []
        return { id: workspace.id, name: workspace.name, urls: held.flatMap(heldAddresses), room: MAX_TABS - (shown ? openTabs.length : held.length) }
      }),
      favouriteUrls: () => workspaces.favourites.map((favourite) => favourite.url),
      freeWorkspaces: () => MAX_WORKSPACES - workspaces.workspaces.length,
      favouriteRoom: () => MAX_FAVOURITES - workspaces.favourites.length,
      tabLimit: MAX_TABS,
      maxFolderDepth: MAX_FOLDER_DEPTH,
      apply: addImportedWorkspaces,
    },
  }))
}

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
  // Temporary files of writes an earlier run never finished (a crash, a force-quit, an older version's quit), before anything is read or saved.
  startup('leftover temporary files', () => {
    for (const folder of [app.getPath('userData'), join(app.getPath('userData'), 'personal')]) removeLeftoverTemporaries(folder)
  })
  await loadExceptions()
  startup('downloads and history', installDownloadsAndHistory)
  const restoredState = await loadPersistentState()
  if (restoredState) startup('restoring tabs', () => {
    lastKnownUrl = restoredState.url
    lastBounds = restoredState.bounds
    tabSidebar = restoredState.sidebar ?? null
    const saved = restoredState.workspaces
    workspaces = new WorkspaceSet<OpenTab>(saved.workspaces.map(({ id, name, icon, accent, anchor, separateSignIns }) => ({ id, name, icon, accent, ...(anchor ? { anchor } : {}), ...(separateSignIns ? { separateSignIns } : {}) })), saved.activeId, saved.favourites)
    tabFolders = restoredState.folders.get(workspaces.activeId) ?? []
    const byWorkspace = new Map<string, OpenTab[]>()
    for (const savedTab of restoredState.tabs) {
      const folders = restoredState.folders.get(savedTab.workspaceId) ?? []
      // Restored tabs are unloaded until shown (their pages load on the first click), and look it.
      // Parked workspaces' tabs stay that way until their workspace is shown and they are clicked.
      const tab: OpenTab = {
        id: savedTab.id, url: savedTab.url, title: savedTab.title, favicon: '', view: buildView(false, savedTab.workspaceId), asleep: {}, lastShownAt: Date.now(),
        ...(savedTab.pinned ? { pinned: true, home: savedTab.home ?? savedTab.url } : {}),
        ...(!savedTab.pinned && savedTab.folderId && folders.some((folder) => folder.id === savedTab.folderId) ? { folderId: savedTab.folderId } : {}),
        ...(savedTab.split ? { split: { ...savedTab.split } } : {}),
        ...(savedTab.compare ? { compare: { ...savedTab.compare } } : {}),
      }
      const list = byWorkspace.get(savedTab.workspaceId) ?? []
      list.push(tab)
      byWorkspace.set(savedTab.workspaceId, list)
    }
    openTabs.push(...(byWorkspace.get(workspaces.activeId) ?? []))
    openTabs.splice(0, openTabs.length, ...folderedOrder(pinnedFirst(openTabs), tabFolders))
    // A saved pair comes back only when both of its tabs did, in the same place.
    repairSplits(openTabs)
    for (const workspace of saved.workspaces) {
      if (workspace.id === workspaces.activeId) continue
      const folders = restoredState.folders.get(workspace.id) ?? []
      const tabs = repairSplits(folderedOrder(pinnedFirst(byWorkspace.get(workspace.id) ?? []), folders))
      workspaces.park(workspace.id, { tabs, folders, activeTabId: tabs.some((tab) => tab.id === workspace.activeTabId) ? workspace.activeTabId! : null })
    }
    const active = restoredActiveTab(openTabs, saved.workspaces.find((workspace) => workspace.id === workspaces.activeId)?.activeTabId, restoredState.url)
    if (active) {
      delete active.asleep
      activeTabId = active.id
      pageView = active.view
      lastKnownUrl = active.url
    }
    // Restored to the end with every saved workspace read: only then may leftover sign-ins be removed.
    savedWorkspacesLoaded = saved.complete
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
  startup('site tweaks', () => {
    const tweaksFile = join(app.getPath('userData'), 'site-tweaks.json')
    siteTweaks = new SiteTweaks(new SiteTweakStore({
      read: () => (existsSync(tweaksFile) ? readFileSync(tweaksFile, 'utf8') : null),
      write: (data) => trackedWrite(tweaksFile, data),
    }))
  })
  startup('saved passwords', wirePasswords)
  startup('browser import', wireImportFromBrowsers)
  startup('site permissions', () => {
    normalPermissions = new SitePermissionStore(join(app.getPath('userData'), 'site-permissions.json'))
    sitePermissions = new SitePermissionBroker({
      store: (isPrivate, scope) => permissionStoreFor(isPrivate, scope),
      emit: (event) => { if (window && !window.isDestroyed()) window.webContents.send(sitePermissionChannels.event, event) },
      systemAccess: (kind) => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess(kind) : Promise.resolve(true)),
    })
    handleFromShell(sitePermissionChannels.command, async (_event, value: unknown) => {
      const command = parseSitePermissionCommand(value)
      // The page in front decides whose answers these are.
      const shownPrivate = Boolean(pageView && privateViews.has(pageView))
      const shownScope = pageView ? scopeOfView(pageView) : 'default'
      const store = permissionStoreFor(shownPrivate, shownScope)
      if (command.type === 'decide') {
        const answered = await sitePermissions!.decide(command.id, command.decision)
        // Reached from a page with F6: with nothing more waiting, that page takes the keyboard back.
        const opener = permissionBarOpener
        if (opener && sitePermissions!.list().length === 0) {
          permissionBarOpener = null
          if (pageView === opener && !viewGone(opener) && pageViewShown(opener)) opener.webContents.focus()
        }
        return answered
      }
      if (command.type === 'pending') return sitePermissions!.list()
      if (command.type === 'reset') {
        sitePermissions!.reset(command.origin, shownPrivate, command.kind, shownScope)
      }
      return store.get(command.origin)
    })
  })
  startup('page sessions', () => {
    // The shared sessions, and private tabs' (the same protections, permissions and download handling).
    // A workspace's own session is wired when it is first used (buildView) or made to have sign-ins of its own.
    ensurePageSession(DEFAULT_PARTITION)
    ensurePageSession(PRIVATE_PARTITION)
    for (const workspace of workspaces.workspaces) if (hasSeparateSignIns(workspace)) ensurePageSession(workspacePartition(workspace.id))
    // No TLS client certificate is ever sent on its own (Electron's default sends the first one).
    app.on('select-client-certificate', (event, contents, url, _list, callback) => {
      declineClientCertificate(event, callback)
      if (pageView && !viewGone(pageView) && pageView.webContents === contents) emit({ type: 'navigation-failed', url, reason: CLIENT_CERTIFICATE_NOTICE })
    })
  })
  // After passwords, permissions and every workspace's own session are set up (those in use are never touched).
  startup('leftover sign-ins', sweepLeftoverSignIns)

  let laya: LayaService | null = null
  startup('captures', () => {
    const captureLibrary = new CaptureLibrary(
      join(app.getPath('userData'), 'capture-library'),
      // Test runs point this at a temporary folder instead of ~/Pictures.
      process.env['INTOPONET_CAPTURE_ROOT'] || join(app.getPath('pictures'), 'Intoponet'),
      { trash: (path) => shell.trashItem(path) },
    )
    captures = new CaptureService(captureLibrary, { window: () => window, pageView: () => pageView, pageAttached: () => pageAttached, setPageCovered, isPrivate: (view) => privateViews.has(view) })
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
    tidyLaya = laya
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
      else setAsideUnreadable(excludedSitesFile)
    } catch {
      // None yet; a list that cannot be read is kept aside, not saved over.
      setAsideUnreadable(excludedSitesFile)
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
          if (linkPreview?.isPrivate) closeLinkPreview(false)
          quickWindows.closePrivate()
          for (const tab of openTabs.filter((item) => privateViews.has(item.view))) discardTab(tab.id)
          const privateSession = session.fromPartition(PRIVATE_PARTITION)
          await privateSession.clearStorageData().catch(() => undefined)
          await privateSession.clearCache().catch(() => undefined)
          // HTTP sign-ins typed in a private tab too: the next private tab must not be signed in with them.
          await privateSession.clearAuthCache().catch(() => undefined)
          // And its open connections: the next private session's pages would arrive on them, linking the two.
          // A private download still coming in keeps going, as before (closing would cut it off).
          if (!browsingData?.downloads.receiving(PRIVATE_PARTITION)) await privateSession.closeAllConnections().catch(() => undefined)
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
        void faviconCache?.forgetHosts((host) => isExcludedSite(`https://${host}/`, excludedSites))
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
    // Fetched through Chromium's network stack, in an in-memory profile of its own: the site's name is looked up
    // over encrypted DNS like the page's was (main's plain fetch asks the system resolver in the clear, naming
    // each site just visited to the local network), and no cookies or sign-ins from your browsing are sent.
    faviconCache = new FaviconCache(
      join(app.getPath('userData'), 'favicons.json'),
      ((input: unknown, init?: unknown) => session.fromPartition(SITE_ICON_PARTITION).fetch(String(input), init as RequestInit)) as typeof fetch,
    )
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
    incomingOpens.ready((target) => incomingBurst.push(target))
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
    loadTabArchive()
    // Checked twice a minute (more often when a check shortens minutes).
    const timer = setInterval(() => { void sleepIdleTabs() }, Math.max(250, Math.min(30_000, TAB_SLEEP_MINUTE_MS / 2, TAB_ARCHIVE_HOUR_MS / 2)))
    timer.unref?.()
    app.once('will-quit', () => clearInterval(timer))
  })

  startup('news', () => {
    // What each country's own outlets are reporting (headlines and links only).
    // On its own thread: fetching, reading and saving the feeds never holds up this one.
    newsService = openNewsService({
      userData: app.getPath('userData'),
      emit: (payload) => emit({ type: 'news-digest', payload }),
    })
    app.once('will-quit', () => { void newsService?.stop() })
  })

  startup('waking and reconnecting', () => {
    // After a night offline every feed has backed off for hours: waking, or the network coming back, fetches them now,
    // and the globe's live signals when a source failed or they are a refresh old (timers stand still while the Mac
    // sleeps). The network is often not back the moment the Mac wakes: once more half a minute later.
    const networkBack = (): void => {
      newsService?.retryOffline()
      retryPublicField()
    }
    let wakeRetry: ReturnType<typeof setTimeout> | null = null
    powerMonitor.on('resume', () => {
      networkBack()
      if (wakeRetry) clearTimeout(wakeRetry)
      wakeRetry = setTimeout(() => { wakeRetry = null; networkBack() }, 30_000)
      wakeRetry.unref?.()
    })
    let wasOnline = net.isOnline()
    const onlineTimer = setInterval(() => {
      const online = net.isOnline()
      if (online && !wasOnline) networkBack()
      wasOnline = online
    }, 30_000)
    onlineTimer.unref?.()
    app.once('will-quit', () => {
      clearInterval(onlineTimer)
      if (wakeRetry) clearTimeout(wakeRetry)
    })
  })

  // The Dock icon brings the app window back, also while a quick window is open.
  app.on('activate', () => {
    if (!window || window.isDestroyed()) reopenWindow()
  })
}).catch((error: unknown) => {
  console.error('Intoponet did not finish starting:', error)
  if (!window) createWindow()
})

/** Quitting waits (briefly) for saves already on their way, so the last library edit and tabs are kept. */
const QUIT_FLUSH_LIMIT_MS = 5_000
/** When the quit stops waiting for saves (set by the first before-quit), and whether it is waiting now. */
let quitDeadline = 0
let quitWaiting = false

/** Every save still on its way to disk: the app's own, each LatestWriter's (library, history, archived tabs…) and any atomic write. */
function savesInFlight(): Promise<unknown>[] {
  return [...writesInFlight, ...latestWritesInFlight(), ...atomicWritesInFlight()]
}

/**
 * Holds the quit while saves are on their way, including ones that start while it waits, until they are
 * done or the time limit is up; then quits again. False when there is nothing to wait for.
 */
function holdQuitForSaves(event: Electron.Event): boolean {
  if (quitWaiting) {
    event.preventDefault()
    return true
  }
  if (Date.now() >= quitDeadline || savesInFlight().length === 0) return false
  event.preventDefault()
  quitWaiting = true
  void waitForSaves(savesInFlight, quitDeadline).finally(() => {
    quitWaiting = false
    app.quit()
  })
  return true
}

app.on('before-quit', (event) => {
  if (!app.isReady()) return
  if (!quitDeadline) quitDeadline = Date.now() + QUIT_FLUSH_LIMIT_MS
  shellClosing = true
  // A workspace deleted moments ago is gone for good: Undo ends with the app, and its own sign-ins are deleted before it quits.
  finishWorkspaceDelete()
  // A zoom changed just now is still waiting to be saved: start it so the flush below waits for it.
  void zoomStore?.flush().catch(() => undefined)
  void siteTweaks?.store.flush().catch(() => undefined)
  // The news feed cache is saved once a minute; save the rest now so the next launch starts with today's news.
  const news = newsService
  newsService = null
  const newsFlush = news?.stop()
  if (newsFlush) {
    writesInFlight.add(newsFlush)
    void newsFlush.catch(() => undefined).finally(() => writesInFlight.delete(newsFlush))
  }
  if (holdQuitForSaves(event)) return
  if (stateWritesClosed) return
  writeFinalState()
  stateWritesClosed = true
})

// Saves that start as the window closes (a late library or history save) are waited for too, within the same limit.
app.on('will-quit', (event) => { holdQuitForSaves(event) })

// The end of the quit: a save still unfinished after the limit leaves its file as it was, and no temporary file behind.
app.on('quit', () => { removeUnfinishedTemporaries() })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
