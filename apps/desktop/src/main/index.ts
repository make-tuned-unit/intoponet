import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { appendFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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
  webFrameMain,
} from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { pendingWrite, writeFileAtomic, writeFileAtomicSync } from './atomicFile'
import { isAppShellUrl, SHELL_PERMISSIONS } from './shellGuard'
import { LatestWriter } from './latestWriter'
import { UpdateController } from './updates'
import { FeedbackService, parseFeedbackCommand } from './feedback'
import { PasswordVault } from './passwords/vault'
import { PasswordService, type PasswordPage } from './passwords/service'
import { passwordOrigin } from './passwords/origin'
import { parsePasswordCommand, passwordChannels, type PasswordEvent } from '../shared/passwords'
import { parsePasswordPageMessage, passwordPageChannels } from '../shared/passwordPage'
import { updateChannels, parseUpdateCommand } from '@intoponet/browser-api'
import { browserUserAgent } from './browserUserAgent'

declare const __INTOPONET_MAC_UPDATE_URL__: string

// Sites see plain Chrome (some refuse "Electron" as an outdated browser).
app.userAgentFallback = browserUserAgent(app.userAgentFallback)

if (!app.isReady()) {
  app.commandLine.appendSwitch(
    'disable-features',
    'WebContentsForceDark,WebContentsForceDarkVariations',
  )
}
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
import { pageShortcutForInput, shellShortcutForInput, tabCycleForInput, type PageShortcut } from './shellShortcuts'
import { TRACKER_STUB_SCRIPT } from './trackerStubs'
import { addressMenuTemplate, pasteAndGoText } from './addressMenu'
import { bindPermissionOwnerLifecycle, kindsFor, originOf, SitePermissionBroker, SitePermissionStore } from './sitePermissions'
import { bindPopupCloseWithOwner, nestedPopupDecision, popupDecision, popupWindowOptions, PopupLimiter } from './popups'
import { rejectCertificateErrorForSession } from './browserCertificatePolicy'
import { reserveDownloadPath, sanitizeDownloadFilename } from './downloadReservation'
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

// Private capture media scheme (served to the app window's default session
// only; web pages run in a separate partition and cannot reach it).
protocol.registerSchemesAsPrivileged([
  { scheme: CAPTURE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])
let captures: CaptureService | null = null
import { browserContextActions, type BrowserContextAction } from './browserContextMenu'
import {
  browserHostChannels,
  type BrowserHostCommand,
  type BrowserHostEvent,
  type BrowserPanelBounds,
  type BrowserPanelSnapshot,
  type PageTabSnapshot,
  type PrivateLibraryReadResult,
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
let htmlFullScreenView: WebContentsView | null = null
/** Animated dock reservation; null when resting at its target. */
let dockReserveNow: number | null = null
let dockTweenTimer: ReturnType<typeof setTimeout> | null = null
const openTabs: OpenTab[] = []
let lastBounds: BrowserPanelBounds = { x: 40, y: 104, width: 900, height: 600 }
let lastKnownUrl = ''
let persistenceTimer: ReturnType<typeof setTimeout> | null = null
const protection = new LocalProtectionEngine()
const protectionPages = new ProtectionPageContextStore()

type OpenTab = {
  id: string
  url: string
  title: string
  favicon: string
  view: WebContentsView
  /** A new tab that has not loaded a page: its view stays hidden and the shell draws the start page. */
  start?: boolean
}

type PersistentBrowserState = {
  version: 2
  url: string
  bounds: BrowserPanelBounds
  wasVisible: boolean
  tabs: { id: string; url: string; title: string }[]
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
  const currentUrl = pageView && !viewGone(pageView) ? pageView.webContents.getURL() : undefined
  return {
    version: 2,
    url: safeHttpUrl(currentUrl ?? '') ? currentUrl! : lastKnownUrl,
    bounds: lastBounds,
    wasVisible: pageAttached,
    // Private tabs are never saved or restored; nor are empty new tabs.
    tabs: tabSnapshots().filter((tab) => !tab.isPrivate && !tab.isStartPage).map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
    })),
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
            },
          ]
        })
      : url
        ? [{ id: randomUUID(), url, title: '' }]
        : []
    return {
      version: 2,
      url,
      bounds: boundsCommand.bounds,
      wasVisible: candidate['wasVisible'],
      tabs,
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
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    isLoading: contents.isLoading(),
    isVisible: pageAttached,
    isPrivate: privateViews.has(pageView),
  }
}

function emit(event: BrowserHostEvent): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(browserHostChannels.event, event)
  }
}

function emitPanelState(): void {
  emit({ type: 'panel-state', panel: panelState() })
}

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

function emitProtectionState(): void {
  emit({ type: 'protection-state', protection: protectionSnapshot() })
}

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
  if (pageView && pageAttached) pageView.setVisible(!held && !isStartView(pageView))
}

function attachPageView(): void {
  if (!window || !pageView || pageAttached) return
  window.contentView.addChildView(pageView)
  // A start-page tab keeps its (blank) view hidden so the shell's start page shows and takes input.
  pageView.setVisible(!isStartView(pageView) && !pageHeld)
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
    if (!sitePermissions) return callback(false)
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? []
    sitePermissions.request({ origin: originOf(details.requestingUrl || contents.getURL()), kinds: kindsFor(permission, mediaTypes), isPrivate, owner: contents.id }, callback)
  })
  browsing.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const mediaType = (details as { mediaType?: string }).mediaType
    const kinds = kindsFor(permission, mediaType === 'video' ? ['video'] : mediaType === 'audio' ? ['audio'] : [])
    return sitePermissions?.check(originOf(requestingOrigin), kinds, isPrivate) === true
  })
  app.on('certificate-error', (event, webContents, _url, _error, _certificate, callback) => {
    rejectCertificateErrorForSession(event, webContents, browsing, callback)
  })
  browsing.on('will-download', (_event, item) => {
    const requestedFilename = item.getFilename() || 'download'
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

function preferReadablePageTheme(contents: Electron.WebContents): void {
  const apply = async (): Promise<void> => {
    try {
      if (!contents.debugger.isAttached()) {
        contents.debugger.attach('1.3')
      }
      await contents.debugger.sendCommand('Emulation.setAutoDarkModeOverride', {
        enabled: false,
      })
      await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: 'light' }],
      })
    } catch {
      // DevTools may already own the debugger session.
    }
  }
  void apply()
  contents.on('did-start-navigation', () => {
    void apply()
  })
}

function safeFavicon(value: string): string {
  if (value.startsWith('data:image/') && value.length < 80_000) return value
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString().slice(0, 2_048)
  } catch {
    return ''
  }
  return ''
}

function tabSnapshots(): PageTabSnapshot[] {
  return openTabs.map((tab) => {
    // A page closed underneath us (e.g. while the window closes) keeps what was last known.
    const live = !viewGone(tab.view)
    const currentUrl = live ? tab.view.webContents.getURL() : ''
    return {
      id: tab.id,
      url: tab.start ? '' : safeHttpUrl(currentUrl) ? currentUrl : tab.url,
      title: tab.start ? 'New tab' : (live ? tab.view.webContents.getTitle() : '') || tab.title || tab.url,
      favicon: tab.favicon,
      active: tab.id === activeTabId,
      isPrivate: privateViews.has(tab.view),
      ...(tab.start ? { isStartPage: true } : {}),
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
  openTabs.push(tab)
  showTab(tab.id)
  emitPanelState()
}

/** The tab is about to load a page: stop drawing the start page and show the view. */
function leaveStartPage(view: WebContentsView): void {
  const tab = openTabs.find((item) => item.view === view)
  if (!tab?.start) return
  tab.start = false
  if (pageView === view && pageAttached && !pageHeld) view.setVisible(true)
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

function emitTabs(): void {
  emit({ type: 'tabs', tabs: tabSnapshots() })
}

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
  if ((!current || current === 'about:blank') && safeHttpUrl(tab.url) && crashRecovery.canAutoRecover(tab.id)) {
    void tab.view.webContents.loadURL(tab.url)
  }
  return tab.view
}

function discardTab(id: string): void {
  const index = openTabs.findIndex((tab) => tab.id === id)
  if (index < 0) return
  const [tab] = openTabs.splice(index, 1)
  if (!tab) return
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
  while (openTabs.length >= 12) {
    const victim = openTabs.find((tab) => tab.id !== activeTabId) ?? openTabs[0]
    if (!victim) return
    discardTab(victim.id)
  }
}

/** Each view's webContents id, readable after the contents is destroyed. */
const viewContentsIds = new WeakMap<WebContentsView, number>()

const popupLimiter = new PopupLimiter()
const crashRecovery = new CrashRecoveryPolicy()

/** A popup window opened by a page: http(s) only, nested popups become tabs, closes with its page. */
function wirePopupWindow(child: BrowserWindow, opener: WebContentsView): void {
  bindPermissionOwnerLifecycle(child.webContents, (owner) => sitePermissions?.dropOwner(owner))
  child.webContents.on('will-navigate', (event, url) => { if (!safeHttpUrl(url)) event.preventDefault() })
  const childContentsId = child.webContents.id
  child.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
    const plan = nestedPopupDecision({ url, disposition, features }, popupLimiter, childContentsId)
    if (plan.action === 'deny') {
      emit({ type: 'navigation-failed', url, reason: plan.reason })
      return { action: 'deny' }
    }
    const tab = createBrowserTab(url, true, privateViews.has(opener))
    if (tab) void tab.webContents.loadURL(url).catch(() => undefined)
    return { action: 'deny' }
  })
  child.webContents.once('destroyed', () => popupLimiter.forget(childContentsId))
  bindPopupCloseWithOwner(child, opener.webContents)
}

function createBrowserTab(urlValue: string, activate = true, isPrivate = privateMode): WebContentsView | null {
  const url = safeHttpUrl(urlValue)
  if (!url) return null
  makeRoomForTab()
  const view = buildView(isPrivate)
  const tab = { id: randomUUID(), url: url.toString(), title: '', favicon: '', view }
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
  if (has('copy-selection') && !params.isEditable && params.selectionText.trim().split(/\s+/).length >= 3) {
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

  if (has('back')) items.push({ label: 'Back', click: () => view.webContents.navigationHistory.goBack() })
  if (has('forward')) items.push({ label: 'Forward', click: () => view.webContents.navigationHistory.goForward() })
  if (has('reload')) items.push({ label: 'Reload', click: () => view.webContents.reload() })
  return items.filter((item, index) => item.type !== 'separator' || (
    index > 0 && index < items.length - 1 && items[index - 1]?.type !== 'separator'
  ))
}

function buildView(isPrivate = privateMode): WebContentsView {
  let frequencyNavigation = 0
  let frequencyLoadSucceeded = false
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: session.fromPartition(isPrivate ? PRIVATE_PARTITION : 'persist:intoponet-default'),
      // The sign-in helper for saved passwords; private tabs never get it.
      ...(isPrivate ? {} : { preload: join(__dirname, '../preload/page.js') }),
    },
  })
  if (isPrivate) privateViews.add(view)

  view.setBackgroundColor('#ffffff')
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
    if (tabRailExpanded && pageView === view && (input.type === 'mouseMove' || input.type === 'mouseDown')) {
      tabRailExpanded = false
      emit({ type: 'tab-rail-state', expanded: false })
    }
  })
  // Shell shortcuts would otherwise be swallowed by the focused page.
  view.webContents.on('before-input-event', (event, input) => {
    if (pageView !== view) return
    const pageAction = pageShortcutForInput(input)
    if (pageAction) {
      event.preventDefault()
      void runPageShortcut(pageAction)
      return
    }
    const cycle = tabCycleForInput(input)
    if (cycle) {
      event.preventDefault()
      void handleBrowserCommand({ type: 'cycle-tabs', direction: cycle === 'next-tab' ? 'next' : 'previous' })
      return
    }
    const action = shellShortcutForInput(input)
    if (!action) return
    event.preventDefault()
    window?.webContents.focus()
    emit({ type: 'shortcut', action })
  })
  view.webContents.on('context-menu', (event, params) => {
    if (viewGone(view) || !window || window.isDestroyed()) return
    const template = contextMenuTemplate(view, params)
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
    void view.webContents.executeJavaScript(`(() => {
      const values = [];
      for (const node of Array.from(document.querySelectorAll('meta[name="rating"], meta[itemprop="contentRating"], meta[property="og:restrictions:age"], [itemprop="contentRating"]')).slice(0, 20)) {
        values.push((node.getAttribute('content') || node.textContent || '').slice(0, 120));
      }
      for (const node of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 10)) {
        const source = (node.textContent || '').slice(0, 32000);
        for (const match of source.matchAll(/"contentRating"\\s*:\\s*"([^"\\n]{1,120})"/g)) values.push(match[1]);
      }
      return values.join(' | ').slice(0, 1000);
    })()`).then((rating: unknown) => {
      if (viewGone(view) || pageView !== view || !frequencyLoadSucceeded || generation !== frequencyNavigation || url !== view.webContents.getURL()) return
      // Private tabs and excluded sites leave no footprints and no interest signals.
      if (privateViews.has(view) || isExcludedSite(url, excludedSites)) return
      emit({ type: 'frequency-visit', url, title: view.webContents.getTitle().slice(0, 1000),
        rating: typeof rating === 'string' && rating ? rating.slice(0, 1000) : null,
        navigationId: `${view.webContents.id}:${generation}` })
    }).catch(() => { /* No activity is recorded when rating extraction fails. */ })
  })
  preferReadablePageTheme(view.webContents)
  view.webContents.setWindowOpenHandler(({ url, disposition, features }) => {
    const plan = popupDecision({ url, disposition, features }, popupLimiter, view.webContents.id)
    if (plan.action === 'deny') {
      emit({ type: 'navigation-failed', url, reason: plan.reason })
      return { action: 'deny' }
    }
    if (plan.action === 'tab') {
      // Same privacy as the page that opened it.
      const tab = createBrowserTab(url, !plan.background, privateViews.has(view))
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
    passwords?.forget(contentsId)
    // The page closed itself (window.close()) or its contents went away: drop its tab, unless the
    // whole window is closing (then the tabs are kept to be restored next launch).
    if (shellClosing) return
    const tab = openTabs.find((item) => item.view === view)
    if (tab) discardTab(tab.id)
  })
  bindPermissionOwnerLifecycle(view.webContents, (owner) => sitePermissions?.dropOwner(owner))
  view.webContents.on('will-navigate', (event, url) => {
    if (!safeHttpUrl(url)) event.preventDefault()
  })
  view.webContents.on('did-start-loading', () => {
    if (pageView === view) emitPanelState()
  })
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
  })
  view.webContents.on('leave-html-full-screen', () => {
    if (htmlFullScreenView === view) htmlFullScreenView = null
    applyPageViewBounds()
  })
  // Early as well, so a banner clicked before the page finishes loading already works.
  view.webContents.on('dom-ready', () => {
    if (pageView !== view) return
    void applyCosmeticFilters(view.webContents, { only: view.webContents.mainFrame })
  })
  view.webContents.on('did-navigate', (_event, url) => {
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
    if (favicons[0]) faviconCache?.remember(view.webContents.getURL(), favicons[0])
    const tab = openTabs.find((item) => item.view === view)
    const next = safeFavicon(favicons[0] ?? '')
    if (!tab || tab.favicon === next) return
    tab.favicon = next
    emitTabs()
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

/** Browser keys pressed inside a page act on it directly, as the toolbar would. */
function runPageShortcut(action: PageShortcut): Promise<unknown> {
  switch (action) {
    case 'reload': return handleBrowserCommand({ type: 'reload' })
    case 'back': return handleBrowserCommand({ type: 'back' })
    case 'forward': return handleBrowserCommand({ type: 'forward' })
    case 'zoom-in': return handleBrowserCommand({ type: 'zoom', action: 'in' })
    case 'zoom-out': return handleBrowserCommand({ type: 'zoom', action: 'out' })
    case 'zoom-reset': return handleBrowserCommand({ type: 'zoom', action: 'reset' })
    case 'print': return handleBrowserCommand({ type: 'print' })
  }
}

function createPageView(attach = true): WebContentsView {
  if (pageView) return pageView
  const view = buildView()
  const tab = { id: randomUUID(), url: lastKnownUrl, title: '', favicon: '', view }
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
  | BrowserPanelSnapshot
  | ProtectionSnapshot
  | PageTabSnapshot[]
  | PrivateLibraryReadResult
  | PublicFieldStatus
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
      discardTab(command.id)
      break
    case 'cycle-tabs': {
      if (openTabs.length === 0) break
      const index = Math.max(0, openTabs.findIndex((tab) => tab.id === activeTabId))
      const delta = command.direction === 'previous' ? -1 : 1
      const next = openTabs[(index + delta + openTabs.length) % openTabs.length]
      if (next) showTab(next.id)
      break
    }
    case 'get-tabs':
      return tabSnapshots()
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
      if (!pageView) break
      if (command.action === 'reset') {
        pageView.webContents.setZoomFactor(1)
        break
      }
      const current = pageView.webContents.getZoomFactor()
      const next =
        command.action === 'in'
          ? Math.min(3, Number((current + 0.1).toFixed(2)))
          : Math.max(0.5, Number((current - 0.1).toFixed(2)))
      pageView.webContents.setZoomFactor(next)
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
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  )
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
  const restoredState = await loadPersistentState()
  if (restoredState) startup('restoring tabs', () => {
    lastKnownUrl = restoredState.url
    lastBounds = restoredState.bounds
    for (const saved of restoredState.tabs) {
      const view = buildView(false)
      openTabs.push({ id: saved.id, url: saved.url, title: saved.title, favicon: '', view })
    }
    const active =
      openTabs.find((tab) => samePage(tab.url, restoredState.url)) ?? openTabs[0]
    if (active) {
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
    handleFromShell(oldsChannels.command, (_event, value: unknown) => olds.thread(parseOldsCommand(value).query))
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
          emitPanelState()
        }
        await emitPrivacy()
      }
      if (command.type === 'set-excluded-sites') {
        excludedSites = command.sites
        try { await trackedWrite(excludedSitesFile, JSON.stringify(excludedSites)) } catch { /* applies this session */ }
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
  createWindow()
  startup('automatic updates', () => updateController?.startAutomatic())
  if (restoredState?.wasVisible && pageView && lastKnownUrl) {
    attachPageView()
    void pageView.webContents.loadURL(lastKnownUrl).catch(() => undefined)
  }
  emitTabs()

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

  startup('news', () => {
    // What each country's own outlets are reporting (headlines and links only).
    newsService = startNewsService({
      userData: app.getPath('userData'),
      emit: (payload) => emit({ type: 'news-digest', payload }),
      digestBuilder: openDigestBuilder(),
    })
    app.once('will-quit', () => newsService?.stop())
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
  if (!quitFlushStarted && (libraryWriter.pending || writesInFlight.size > 0)) {
    // Once only: the second before-quit (from app.quit() below) goes straight through.
    quitFlushStarted = true
    event.preventDefault()
    const flushed = Promise.allSettled([libraryWriter.flush(), ...writesInFlight])
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
