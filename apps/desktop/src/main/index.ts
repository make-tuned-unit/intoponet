import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  session,
  WebContentsView,
  clipboard,
  systemPreferences,
} from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

if (!app.isReady()) {
  app.commandLine.appendSwitch(
    'disable-features',
    'WebContentsForceDark,WebContentsForceDarkVariations',
  )
}
import { cachedPublicField, loadPublicField } from './public-field'
import { readSealedPrivateLibrary } from './privateLibraryStorage'
import { routeProtectionRequest } from './protectionRequest'
import {
  dockReserveAt,
  dockReserveTarget,
  pageViewBoundsForDock,
  shouldCloseTabDockFromNativeMouse,
  TAB_DOCK_TWEEN_MS,
} from './tabDockBounds'
import { shellShortcutForInput } from './shellShortcuts'
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
  parseBrowserHostCommand,
  resolveNavigationIntent,
} from '@intoponet/browser-api'
import {
  LocalProtectionEngine,
  ProtectionPageContextStore,
} from '@intoponet/protection-engine'

let window: BrowserWindow | null = null
let pageView: WebContentsView | null = null
let pageAttached = false
let activeTabId: string | null = null
let browserFullWidth = false
let tabDockOpen = false
let tabDockHeld = false
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
  const counts = protectionPages.counters(pageView?.webContents.id ?? null)
  return {
    origin,
    enabled: origin ? protection.isSiteEnabled(origin, 'default') : true,
    ...counts,
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
  applyPageViewBounds()
  pageAttached = true
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
  emitProtectionState()
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
    tabDockOpen = false
  }
  protectionPages.remove(tab.view.webContents.id)
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

function createBrowserTab(urlValue: string, activate = true): WebContentsView | null {
  const url = safeHttpUrl(urlValue)
  if (!url) return null
  makeRoomForTab()
  const view = buildView()
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
      const newView = createBrowserTab(linkUrl)
      if (newView) void newView.webContents.loadURL(linkUrl)
    } })
  }
  if (has('copy-link-address') && linkUrl) {
    items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(linkUrl) })
  }
  if (has('open-link-in-new-tab') || has('copy-link-address')) items.push({ type: 'separator' })

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

function buildView(): WebContentsView {
  let frequencyNavigation = 0
  let frequencyLoadSucceeded = false
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: session.fromPartition('persist:intoponet-default'),
    },
  })

  view.setBackgroundColor('#ffffff')
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
      emit({ type: 'frequency-visit', url, title: view.webContents.getTitle().slice(0, 1000),
        rating: typeof rating === 'string' && rating ? rating.slice(0, 1000) : null,
        navigationId: `${view.webContents.id}:${generation}` })
    }).catch(() => { /* No activity is recorded when rating extraction fails. */ })
  })
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
    const crashedUrl = tab?.url || lastKnownUrl
    if (pageView === view) detachActive()
    if (pageView === view) pageView = null
    protectionPages.remove(view.webContents.id)
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
  applyPageViewBounds()
  schedulePersistentStateSave()
}

function setBrowserFullWidth(enabled: boolean): void {
  browserFullWidth = enabled
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
  | string
  | null
> {
  switch (command.type) {
    case 'open': {
      const url = resolveNavigationIntent(command.intent)
      const existing = openTabs.find((tab) => samePage(tab.view.webContents.getURL() || tab.url, url))
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
    case 'set-full-width':
      setBrowserFullWidth(command.enabled)
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
