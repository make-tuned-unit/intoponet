import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { appendFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  session,
  WebContentsView,
  clipboard,
  protocol,
  shell,
  systemPreferences,
  autoUpdater,
} from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { UpdateController } from './updates'
import { updateChannels, parseUpdateCommand } from '@intoponet/browser-api'

declare const __INTOPONET_MAC_UPDATE_URL__: string

if (!app.isReady()) {
  app.commandLine.appendSwitch(
    'disable-features',
    'WebContentsForceDark,WebContentsForceDarkVariations',
  )
}
import { cachedPublicField, publicFieldStatus, startPublicFieldRefresh } from './public-field'
import { startNewsService } from './news/newsService'
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
import { shellShortcutForInput } from './shellShortcuts'
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
import { ACCESS_SCRIPT, ACCESS_WORLD_ID, parseAccess } from './access/pageAccess'
import { backupExclusionAvailable, backupExclusionStatus, readBackupExclusionIntent, setBackupExclusion, watchBackupExclusionPaths } from './backupExclusion'
import { TranslateStore } from './translate/store'
import { openTranslationEngine } from './translate/openEngine'
import { loadKnowledgeCrypto } from './knowledge/crypto'
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

function safeHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function persistentState(): PersistentBrowserState {
  const currentUrl = pageView?.webContents.getURL()
  return {
    version: 2,
    url: safeHttpUrl(currentUrl ?? '') ? currentUrl! : lastKnownUrl,
    bounds: lastBounds,
    wasVisible: pageAttached,
    // Private tabs are never saved or restored.
    tabs: tabSnapshots().filter((tab) => !tab.isPrivate).map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
    })),
  }
}

function stateFilePath(): string {
  return join(app.getPath('userData'), 'browser-state.v1.json')
}

async function savePersistentState(): Promise<void> {
  await writeFile(stateFilePath(), JSON.stringify(persistentState()), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function schedulePersistentStateSave(): void {
  if (persistenceTimer) clearTimeout(persistenceTimer)
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null
    void savePersistentState()
  }, 150)
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
  if (!pageView) return defaultPanelState()
  const contents = pageView.webContents
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
  writeFileSync(
    exceptionsFilePath(),
    JSON.stringify({
      version: 1,
      disabledOrigins: protection.disabledOriginList(),
      categories: protection.categoryToggles(),
    }),
    { encoding: 'utf8', mode: 0o600 },
  )
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

async function applyCosmeticFilters(contents: Electron.WebContents): Promise<void> {
  try {
    const origin = currentOrigin()
    const rules =
      origin && !protection.isSiteEnabled(origin, 'default')
        ? null
        : protection.cosmeticRules(lastKnownUrl, lastKnownUrl)
    const css = rules?.cssRules.join('\n') ?? ''
    const frames = contents.mainFrame?.framesInSubtree ?? []
    await Promise.all(
      frames.map(async (frame) => {
        if (frame.detached) return
        try {
          await frame.executeJavaScript(cosmeticInjection(css))
        } catch {
          // The frame can detach between the snapshot and the injection.
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

function attachPageView(): void {
  if (!window || !pageView || pageAttached) return
  window.contentView.addChildView(pageView)
  pageView.setVisible(true)
  applyPageViewBounds()
  pageAttached = true
  updateWindowButtons()
  schedulePersistentStateSave()
  emitPanelState()
}

function applyPageViewBounds(): void {
  if (!pageView) return
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

async function writeSealedLibrary(payload: string): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('On-device encryption is unavailable.')
  }
  const sealed = await safeStorage.encryptStringAsync(payload)
  const destination = privateLibraryPath()
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, sealed, { mode: 0o600 })
    renameSync(temporary, destination)
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
}

function deleteSealedLibrary(): void {
  if (existsSync(privateLibraryPath())) unlinkSync(privateLibraryPath())
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
  return openTabs.map((tab) => ({
    id: tab.id,
    url: safeHttpUrl(tab.view.webContents.getURL()) ? tab.view.webContents.getURL() : tab.url,
    title: tab.view.webContents.getTitle() || tab.title || tab.url,
    favicon: tab.favicon,
    active: tab.id === activeTabId,
    isPrivate: privateViews.has(tab.view),
  }))
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
    pageView.webContents.stopFindInPage('clearSelection')
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
  protectionPages.remove(tab.view.webContents.id)
  translateService?.forgetPage(tab.view.webContents.id)
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  emitTabs()
  emitPanelState()
  schedulePersistentStateSave()
}

function makeRoomForTab(): void {
  while (openTabs.length >= 12) {
    const victim = openTabs.find((tab) => tab.id !== activeTabId) ?? openTabs[0]
    if (!victim) return
    discardTab(victim.id)
  }
}

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
    const action = shellShortcutForInput(input)
    if (!action || pageView !== view) return
    event.preventDefault()
    window?.webContents.focus()
    emit({ type: 'shortcut', action })
  })
  view.webContents.on('context-menu', (event, params) => {
    if (view.webContents.isDestroyed() || !window || window.isDestroyed()) return
    const template = contextMenuTemplate(view, params)
    if (template.length === 0) return
    event.preventDefault()
    Menu.buildFromTemplate(template).popup({ window })
  })
  view.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (!mainFrame || inPlace) return
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
      if (view.webContents.isDestroyed() || pageView !== view || !frequencyLoadSucceeded || generation !== frequencyNavigation || url !== view.webContents.getURL()) return
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
  view.webContents.once('destroyed', () => popupLimiter.forget(contentsId))
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
    void applyCosmeticFilters(view.webContents)
  })
  view.webContents.on('did-frame-finish-load', () => {
    if (pageView !== view) return
    void applyCosmeticFilters(view.webContents)
  })
  view.webContents.on('did-navigate', (_event, url) => {
    rememberTab(view)
    protectionPages.commitNavigation(view.webContents.id, url)
    if (pageView !== view) return
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
  })

  return view
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
      // Reuse an open tab only when it matches the current mode (private tabs and normal tabs never mix).
      const existing = openTabs.find((tab) => privateViews.has(tab.view) === privateMode && samePage(tab.view.webContents.getURL() || tab.url, url))
      if (existing) {
        showTab(existing.id)
        break
      }
      const view = createBrowserTab(url)
      if (view) await view.webContents.loadURL(url)
      break
    }
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
      deleteSealedLibrary()
      return null
    case 'get-field-snapshot':
      return cachedPublicField()
    case 'get-public-field-status':
      return publicFieldStatus()
    case 'get-news-digest':
      return newsService?.latest() ?? null
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

function createWindow(): void {
  window = new BrowserWindow({
    minWidth: 900,
    minHeight: 620,
    width: 1440,
    height: 940,
    backgroundColor: '#07111B',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error('[app renderer]', details.message)
    })
  }

  window.on('closed', () => {
    if (persistenceTimer) clearTimeout(persistenceTimer)
    writeFileSync(stateFilePath(), JSON.stringify(persistentState()), {
      encoding: 'utf8',
      mode: 0o600,
    })
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

app.whenReady().then(async () => {
  try {
    app.configureHostResolver({ secureDnsMode: ENCRYPTED_DNS.mode, secureDnsServers: ENCRYPTED_DNS.servers })
    encryptedDnsActive = true
  } catch {
    encryptedDnsActive = false
  }
  await loadExceptions()
  const restoredState = await loadPersistentState()
  if (restoredState) {
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
  }

  installApplicationMenu()
  const normalPermissions = new SitePermissionStore(join(app.getPath('userData'), 'site-permissions.json'))
  sitePermissions = new SitePermissionBroker({
    store: (isPrivate) => (isPrivate ? privatePermissions : normalPermissions),
    emit: (event) => { if (window && !window.isDestroyed()) window.webContents.send(sitePermissionChannels.event, event) },
    systemAccess: (kind) => (process.platform === 'darwin' ? systemPreferences.askForMediaAccess(kind) : Promise.resolve(true)),
  })
  ipcMain.handle(sitePermissionChannels.command, async (_event, value: unknown) => {
    const command = parseSitePermissionCommand(value)
    const store = pageView && privateViews.has(pageView) ? privatePermissions : normalPermissions
    if (command.type === 'decide') return sitePermissions!.decide(command.id, command.decision)
    if (command.type === 'pending') return sitePermissions!.list()
    if (command.type === 'reset') {
      sitePermissions!.reset(command.origin, Boolean(pageView && privateViews.has(pageView)), command.kind)
    }
    return store.get(command.origin)
  })
  wireDownloadSession()
  wireProtectionSession()
  // Private tabs get the same protections, permissions and download handling.
  wireDownloadSession(PRIVATE_PARTITION)
  wireProtectionSession(PRIVATE_PARTITION)

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
  ipcMain.handle(captureChannels.command, (_event, value: unknown) => captures!.handle(parseCaptureCommand(value)))
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
  ipcMain.handle(oldsChannels.command, (_event, value: unknown) => olds.thread(parseOldsCommand(value).query))
  // Absorb + local knowledge: extracted on this device, encrypted with an OS-keychain key, never sent anywhere.
  const knowledgeDir = join(app.getPath('userData'), 'knowledge')
  const layaDir = join(app.getPath('userData'), 'laya')
  const knowledgeCrypto = loadKnowledgeCrypto(knowledgeDir, {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptStringAsync(value),
    decrypt: (sealed) => safeStorage.decryptStringAsync(sealed),
  }, { relatedDataDirs: [join(layaDir, 'vectors')] })
  // Key/decryption failures should surface when Knowledge is used, not become
  // an unhandled rejection during startup. Keep the original promise rejected.
  void knowledgeCrypto.catch(() => undefined)
  let laya: LayaService | null = null
  const knowledge = new KnowledgeService({
    dir: knowledgeDir,
    crypto: knowledgeCrypto,
    getActivePage: () => (pageAttached && pageView ? pageView.webContents : null),
    isExcluded: (url) => isExcludedSite(url, excludedSites),
    onChange: (change) => laya?.onKnowledgeChange(change),
  })
  ipcMain.handle(knowledgeChannels.command, (_event, value: unknown) => knowledge.handle(parseKnowledgeCommand(value)))
  // Laya: optional on-device meaning search over absorbed pages. Its Node worker
  // guards selected outbound APIs, but it is not OS-level network/filesystem isolated.
  laya = new LayaService({
    dir: layaDir,
    crypto: knowledgeCrypto,
    knowledge,
    openEmbedder: openLayaEmbedder,
    emit: (event) => { if (window && !window.isDestroyed()) window.webContents.send(layaChannels.event, event) },
  })
  ipcMain.handle(layaChannels.command, (_event, value: unknown) => laya!.handle(parseLayaCommand(value)))
  app.once('will-quit', () => { void laya?.close() })
  setTimeout(() => { void laya?.backfill().catch(() => undefined) }, 15_000).unref?.()
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
  ipcMain.handle(privacyChannels.command, async (_event, value: unknown) => {
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
      try { writeFileSync(excludedSitesFile, JSON.stringify(excludedSites), { mode: 0o600 }) } catch { /* applies this session */ }
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
  // Beacons: the only path by which a user-approved contribution leaves this Mac (PRD §4.6, §7).
  const beaconDir = join(app.getPath('userData'), 'beacons')
  const beacons = new BeaconPublisher({
    files: { key: join(beaconDir, 'device-key.sealed'), settings: join(beaconDir, 'settings.json'), published: join(beaconDir, 'published.json') },
    box: {
      available: () => safeStorage.isEncryptionAvailable(),
      seal: (text) => safeStorage.encryptString(text),
      open: (sealed) => safeStorage.decryptString(sealed),
    },
    defaultRegistry: process.env['INTOPONET_BEACON_REGISTRY'] || DEFAULT_BEACON_REGISTRY,
  })
  ipcMain.handle(beaconChannels.command, async (_event, value: unknown) => {
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
  // Site icons for bookmarks: from visited pages or the site's own /favicon.ico, cached on this Mac.
  faviconCache = new FaviconCache(join(app.getPath('userData'), 'favicons.json'))
  ipcMain.handle('intoponet:favicons', (_event, value: unknown) => {
    if (!Array.isArray(value) || value.length > 300) throw new Error('Invalid hosts.')
    return faviconCache!.get(value.filter((host): host is string => typeof host === 'string' && isIconHost(host)))
  })
  // Translation: Mozilla's on-device models, downloaded per language on request and pinned by
  // SHA-256. The engine runs in a worker with no network; text never leaves the device.
  const translateStore = new TranslateStore(join(app.getPath('userData'), 'translate'), (input, init) => fetch(input, init))
  translateService = new TranslateService({
    store: translateStore,
    engine: openTranslationEngine(translateStore),
    emit: (event) => { if (window && !window.isDestroyed()) window.webContents.send(translateChannels.event, event) },
    getActivePage: () => (pageAttached && pageView && !pageView.webContents.isDestroyed() ? pageView.webContents : null),
  })
  ipcMain.handle(translateChannels.command, (_event, value: unknown) => translateService!.handle(parseTranslateCommand(value)))
  // Whether the open page declares its article restricted (read-only; used to offer free coverage elsewhere).
  ipcMain.handle('intoponet:page-access', async () => {
    if (!pageAttached || !pageView || pageView.webContents.isDestroyed()) return null
    const url = pageView.webContents.getURL()
    if (!/^https?:/i.test(url)) return null
    try {
      return parseAccess(await pageView.webContents.executeJavaScriptInIsolatedWorld(ACCESS_WORLD_ID, [{ code: ACCESS_SCRIPT }]))
    } catch {
      return null
    }
  })
  const updateController = new UpdateController({
    enabled: __INTOPONET_MAC_UPDATE_URL__.length > 0,
    packaged: app.isPackaged,
    platform: process.platform,
    currentVersion: app.getVersion(),
    feedUrl: __INTOPONET_MAC_UPDATE_URL__,
    adapter: app.isPackaged && process.platform === 'darwin' && __INTOPONET_MAC_UPDATE_URL__.length > 0 ? autoUpdater : undefined,
    emit: (status) => { if (window && !window.isDestroyed()) window.webContents.send(updateChannels.event, status) },
  })
  ipcMain.handle(updateChannels.command, (_event, value: unknown) => updateController.handle(parseUpdateCommand(value)))
  app.once('will-quit', () => { void translateService?.close() })
  ipcMain.handle(
    browserHostChannels.command,
    (_event, value: unknown) => handleBrowserCommand(parseBrowserHostCommand(value)),
  )
  createWindow()
  if (restoredState?.wasVisible && pageView && lastKnownUrl) {
    attachPageView()
    void pageView.webContents.loadURL(lastKnownUrl)
  }
  emitTabs()

  // Cached field now, then live refreshes (earthquakes/natural events every
  // 20 minutes; Wikipedia's daily most-read when a new day is published).
  const stopPublicField = startPublicFieldRefresh((snapshot) => {
    emit({ type: 'field-snapshot', payload: JSON.stringify(snapshot) })
  }, (status) => {
    emit({ type: 'public-field-status', status })
  })
  app.once('will-quit', stopPublicField)

  // What each country's own outlets are reporting (headlines and links only).
  newsService = startNewsService({
    userData: app.getPath('userData'),
    emit: (payload) => emit({ type: 'news-digest', payload }),
  })
  app.once('will-quit', () => newsService?.stop())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  if (!app.isReady()) return
  if (persistenceTimer) clearTimeout(persistenceTimer)
  writeFileSync(stateFilePath(), JSON.stringify(persistentState()), {
    encoding: 'utf8',
    mode: 0o600,
  })
  persistExceptions()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
