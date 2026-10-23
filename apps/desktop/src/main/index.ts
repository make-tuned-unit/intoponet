import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  session,
  WebContentsView,
} from 'electron'

if (!app.isReady()) {
  app.commandLine.appendSwitch(
    'disable-features',
    'WebContentsForceDark,WebContentsForceDarkVariations',
  )
}
import { cachedPublicField, loadPublicField } from './public-field'
import {
  browserHostChannels,
  type BrowserHostCommand,
  type BrowserHostEvent,
  type BrowserPanelBounds,
  type BrowserPanelSnapshot,
  type PageTabSnapshot,
  type ProtectionSnapshot,
  parseBrowserHostCommand,
  resolveNavigationIntent,
} from '@intoponet/browser-api'
import {
  LocalProtectionEngine,
  mapElectronResourceType,
} from '@intoponet/protection-engine'

let window: BrowserWindow | null = null
let pageView: WebContentsView | null = null
let pageAttached = false
let activeTabId: string | null = null
const openTabs: OpenTab[] = []
let lastBounds: BrowserPanelBounds = { x: 40, y: 104, width: 900, height: 600 }
let lastKnownUrl = ''
let persistenceTimer: ReturnType<typeof setTimeout> | null = null
const protection = new LocalProtectionEngine()
let blockedAds = 0
let blockedTrackers = 0

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
  return {
    version: 2,
    url: pageView?.webContents.getURL() || lastKnownUrl,
    bounds: lastBounds,
    wasVisible: pageAttached,
    tabs: tabSnapshots().map((tab) => ({
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
  return {
    origin,
    enabled: origin ? protection.isSiteEnabled(origin, 'default') : true,
    blockedAds,
    blockedTrackers,
    adsEnabled: categories.ads,
    trackersEnabled: categories.trackers,
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

function wireProtectionSession(): void {
  const guest = session.fromPartition('persist:intoponet-default')
  guest.webRequest.onBeforeRequest((details, callback) => {
    const decision = protection.evaluate({
      requestUrl: details.url,
      topLevelUrl: lastKnownUrl || null,
      initiatorOrigin: details.referrer || null,
      resourceType: mapElectronResourceType(details.resourceType),
      profileId: 'default',
      isPrivate: false,
    })
    if (decision.action === 'block') {
      if (decision.category === 'tracker') blockedTrackers += 1
      else blockedAds += 1
      emitProtectionState()
      callback({ cancel: true })
      return
    }
    callback({})
  })
}

function attachPageView(): void {
  if (!window || !pageView || pageAttached) return
  window.contentView.addChildView(pageView)
  pageView.setBounds(lastBounds)
  pageAttached = true
  schedulePersistentStateSave()
  emitPanelState()
}

function privateLibraryPath(): string {
  return join(app.getPath('userData'), 'private-library.v1.seal')
}

async function readSealedLibrary(): Promise<string | null> {
  if (!(await safeStorage.isAsyncEncryptionAvailable()) || !existsSync(privateLibraryPath())) {
    return null
  }
  try {
    const decrypted = await safeStorage.decryptStringAsync(readFileSync(privateLibraryPath()))
    if (decrypted.shouldReEncrypt) {
      await writeSealedLibrary(decrypted.result)
    }
    return decrypted.result
  } catch {
    return null
  }
}

async function writeSealedLibrary(payload: string): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('On-device encryption is unavailable.')
  }
  const sealed = await safeStorage.encryptStringAsync(payload)
  writeFileSync(privateLibraryPath(), sealed, { mode: 0o600 })
}

function deleteSealedLibrary(): void {
  if (existsSync(privateLibraryPath())) unlinkSync(privateLibraryPath())
}

function uniqueDownloadPath(filename: string): string {
  const downloads = app.getPath('downloads')
  const extIndex = filename.lastIndexOf('.')
  const stem = extIndex > 0 ? filename.slice(0, extIndex) : filename
  const ext = extIndex > 0 ? filename.slice(extIndex) : ''
  let candidate = join(downloads, filename)
  let index = 1
  while (existsSync(candidate)) {
    candidate = join(downloads, `${stem} (${index})${ext}`)
    index += 1
  }
  return candidate
}

function navigationFailureReason(code: number, description: string): string {
  if (code <= -200 && code >= -219) {
    return `The site certificate was not trusted (${description}). The page was not loaded.`
  }
  return description
}

function wireDownloadSession(): void {
  const browsing = session.fromPartition('persist:intoponet-default')
  browsing.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  app.on('certificate-error', (event, webContents, _url, _error, _certificate, callback) => {
    if (webContents.session !== browsing) return
    event.preventDefault()
    callback(false)
  })
  browsing.on('will-download', (_event, item) => {
    const filename = item.getFilename() || 'download'
    const destination = uniqueDownloadPath(filename)
    item.setSavePath(destination)
    item.once('done', (_download, state) => {
      emit({
        type: 'download-finished',
        filename,
        path: destination,
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
    url: tab.view.webContents.getURL() || tab.url,
    title: tab.view.webContents.getTitle() || tab.title || tab.url,
    favicon: tab.favicon,
    active: tab.id === activeTabId,
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
  if (url) tab.url = url
  if (title) tab.title = title
  emitTabs()
}

function detachActive(): void {
  if (window && pageView && pageAttached) {
    pageView.webContents.stopFindInPage('clearSelection')
    window.contentView.removeChildView(pageView)
    pageAttached = false
  }
}

function showTab(id: string): WebContentsView | null {
  const tab = openTabs.find((item) => item.id === id)
  if (!tab) return null
  if (pageView && pageView !== tab.view) detachActive()
  activeTabId = tab.id
  pageView = tab.view
  lastKnownUrl = tab.view.webContents.getURL() || tab.url
  attachPageView()
  emitTabs()
  const current = tab.view.webContents.getURL()
  if ((!current || current === 'about:blank') && safeHttpUrl(tab.url)) {
    void tab.view.webContents.loadURL(tab.url)
  }
  return tab.view
}

function discardTab(id: string): void {
  const index = openTabs.findIndex((tab) => tab.id === id)
  if (index < 0) return
  const [tab] = openTabs.splice(index, 1)
  if (!tab) return
  if (pageView === tab.view) {
    detachActive()
    pageView = null
    activeTabId = null
    lastKnownUrl = ''
    blockedAds = 0
    blockedTrackers = 0
  }
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

function buildView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: session.fromPartition('persist:intoponet-default'),
    },
  })

  view.setBackgroundColor('#ffffff')
  preferReadablePageTheme(view.webContents)
  view.webContents.setWindowOpenHandler(({ url }) => {
    emit({
      type: 'navigation-failed',
      url,
      reason: safeHttpUrl(url)
        ? 'Popup blocked. Open the destination explicitly if you trust it.'
        : 'Blocked an unsupported popup destination.',
    })
    return { action: 'deny' }
  })
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
    if (pageView !== view) return
    lastKnownUrl = url
    blockedAds = 0
    blockedTrackers = 0
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
      if (!isMainFrame || code === -3 || pageView !== view) return
      emit({
        type: 'navigation-failed',
        url: validatedUrl,
        reason: navigationFailureReason(code, description),
      })
    },
  )
  view.webContents.on('render-process-gone', (_event, details) => {
    const tab = openTabs.find((item) => item.view === view)
    const crashedUrl = tab?.url || lastKnownUrl
    if (pageView === view) detachActive()
    if (pageView === view) pageView = null
    emit({
      type: 'navigation-failed',
      url: crashedUrl,
      reason: `The page renderer stopped (${details.reason}). Reloading.`,
    })
    if (!tab || !safeHttpUrl(crashedUrl)) return
    const replacement = buildView()
    tab.view = replacement
    tab.url = crashedUrl
    if (activeTabId === tab.id) {
      pageView = replacement
      lastKnownUrl = crashedUrl
      attachPageView()
      void replacement.webContents.loadURL(crashedUrl)
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
  pageView?.setBounds(safeBounds)
  schedulePersistentStateSave()
}

async function handleBrowserCommand(
  command: BrowserHostCommand,
): Promise<BrowserPanelSnapshot | ProtectionSnapshot | PageTabSnapshot[] | string | null> {
  switch (command.type) {
    case 'open': {
      const url = resolveNavigationIntent(command.intent)
      const existing = openTabs.find((tab) => samePage(tab.view.webContents.getURL() || tab.url, url))
      if (existing) {
        showTab(existing.id)
        break
      }
      makeRoomForTab()
      const view = buildView()
      const tab = { id: randomUUID(), url, title: '', favicon: '', view }
      openTabs.push(tab)
      showTab(tab.id)
      lastKnownUrl = url
      schedulePersistentStateSave()
      await view.webContents.loadURL(url)
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
    case 'reload':
      pageView?.webContents.reload()
      break
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
  await loadExceptions()
  const restoredState = await loadPersistentState()
  if (restoredState) {
    lastKnownUrl = restoredState.url
    lastBounds = restoredState.bounds
    for (const saved of restoredState.tabs) {
      const view = buildView()
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
  wireDownloadSession()
  wireProtectionSession()

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

  void loadPublicField().then((snapshot) => {
    if (snapshot) emit({ type: 'field-snapshot', payload: JSON.stringify(snapshot) })
  })

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
