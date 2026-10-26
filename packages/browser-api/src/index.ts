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
}

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

export type BrowserHostEvent =
  | { type: 'frequency-visit'; url: string; title: string; rating: string | null; navigationId: string }
  | { type: 'panel-state'; panel: BrowserPanelSnapshot }
  | { type: 'navigation-failed'; url: string; reason: string }
  | ({ type: 'find-result' } & FindInPageResult)
  | ({ type: 'download-finished' } & DownloadFinishedEvent)
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
  /** Validated per-country local news digest (JSON). */
  | { type: 'news-digest'; payload: string }

export type ShellShortcut = 'focus-launcher' | 'toggle-bookmarks' | 'capture'

export interface BrowserHostApi {
  open(intent: NavigationIntent): Promise<void>
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
  /** `hold` keeps the dock open while the pointer crosses the page (e.g. typing in its search). */
  setTabDockOpen(open: boolean, hold?: boolean): Promise<void>
  /** Full-screen toolbar reveal; `hold` keeps it while a control has focus. */
  setChromeRevealed(revealed: boolean, hold?: boolean): Promise<void>
  /** Expanded (unpinned) tab rail collapses when the pointer enters the page. */
  setTabRailExpanded(expanded: boolean): Promise<void>
  getState(): Promise<BrowserPanelSnapshot>
  getProtection(): Promise<ProtectionSnapshot>
  setSiteProtection(enabled: boolean): Promise<void>
  setProtectionCategories(categories: { ads: boolean; trackers: boolean }): Promise<void>
  getTabs(): Promise<PageTabSnapshot[]>
  activateTab(id: string): Promise<void>
  closeTab(id: string): Promise<void>
  cycleTabs(direction: 'next' | 'previous'): Promise<void>
  readPrivateLibrary(): Promise<PrivateLibraryReadResult>
  writePrivateLibrary(payload: string): Promise<void>
  deletePrivateLibrary(): Promise<void>
  getFieldSnapshot(): Promise<string | null>
  getNewsDigest(): Promise<string | null>
  subscribe(listener: (event: BrowserHostEvent) => void): () => void
}

export const browserHostChannels = {
  command: 'browser-host:command',
  event: 'browser-host:event',
} as const

export type BrowserHostCommand =
  | { type: 'open'; intent: NavigationIntent }
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
  | { type: 'set-tab-dock-open'; open: boolean; hold?: boolean }
  | { type: 'set-chrome-revealed'; revealed: boolean; hold?: boolean }
  | { type: 'set-tab-rail-expanded'; expanded: boolean }
  | { type: 'get-state' }
  | { type: 'get-protection' }
  | { type: 'set-site-protection'; enabled: boolean }
  | { type: 'set-protection-categories'; ads: boolean; trackers: boolean }
  | { type: 'get-tabs' }
  | { type: 'activate-tab'; id: string }
  | { type: 'close-tab'; id: string }
  | { type: 'cycle-tabs'; direction: 'next' | 'previous' }
  | { type: 'read-private-library' }
  | { type: 'write-private-library'; payload: string }
  | { type: 'delete-private-library' }
  | { type: 'get-field-snapshot' }
  | { type: 'get-news-digest' }

const commandTypes = new Set<BrowserHostCommand['type']>([
  'open',
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
  'get-state',
  'get-protection',
  'set-site-protection',
  'set-protection-categories',
  'get-tabs',
  'activate-tab',
  'close-tab',
  'cycle-tabs',
  'read-private-library',
  'write-private-library',
  'delete-private-library',
  'get-field-snapshot',
  'get-news-digest',
])

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

export function parseBrowserHostCommand(value: unknown): BrowserHostCommand {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    throw new Error('Invalid browser-host command.')
  }
  const type = value['type']
  if (!commandTypes.has(type as BrowserHostCommand['type'])) {
    throw new Error('Unknown browser-host command.')
  }

  switch (type) {
    case 'open':
      return { type, intent: parseIntent(value['intent']) }
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
    case 'set-full-width':
      if (typeof value['enabled'] !== 'boolean') throw new Error('Invalid full-width state.')
      return { type, enabled: value['enabled'] }
    case 'set-tab-dock-open':
      if (typeof value['open'] !== 'boolean') throw new Error('Invalid tab-dock state.')
      if (value['hold'] !== undefined && typeof value['hold'] !== 'boolean') throw new Error('Invalid tab-dock hold.')
      return { type, open: value['open'], ...(value['hold'] === true ? { hold: true } : {}) }
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
    case 'cycle-tabs':
      if (value['direction'] !== 'next' && value['direction'] !== 'previous') {
        throw new Error('Invalid tab cycle.')
      }
      return { type, direction: value['direction'] }
    case 'write-private-library':
      if (typeof value['payload'] !== 'string' || value['payload'].length > 500_000) {
        throw new Error('Invalid private library.')
      }
      return { type, payload: value['payload'] }
    case 'read-private-library':
    case 'delete-private-library':
    case 'get-field-snapshot':
    case 'get-news-digest':
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
      return { type }
    default:
      throw new Error('Unknown browser-host command.')
  }
}

export * from './captures'
