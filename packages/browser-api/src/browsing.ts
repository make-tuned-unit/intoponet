/**
 * Everyday browser behaviour around pages: links to other apps (mailto:, tel:, zoommtg:…),
 * Intoponet as the default browser, how pages are coloured (light/dark), and the in-tab
 * error page shown when a page cannot load.
 */
export const browsingChannels = {
  command: 'intoponet:browsing',
  event: 'intoponet:browsing-event',
} as const

/** How web pages are told to colour themselves (prefers-color-scheme). The app's own look is unchanged. */
export const PAGE_APPEARANCES = ['system', 'light', 'dark'] as const
export type PageAppearance = (typeof PAGE_APPEARANCES)[number]

export type DefaultBrowserStatus = {
  /** Intoponet opens http and https links from other apps. */
  isDefault: boolean
  /** Asking macOS to make it the default is possible (a packaged app on macOS). */
  canSet: boolean
}

/** How long a tab stays in the background before its page is unloaded to save memory. */
export const TAB_SLEEP_AFTER = ['never', '15m', '1h', '4h'] as const
export type TabSleepAfter = (typeof TAB_SLEEP_AFTER)[number]

/** The order ⌃Tab steps through tabs: as they sit in the tab bar, or most recently used first. */
export const TAB_SWITCH_ORDERS = ['strip', 'recent'] as const
export type TabSwitchOrder = (typeof TAB_SWITCH_ORDERS)[number]

/** How long an unpinned tab goes unseen before it closes into Archived tabs (off by default). */
export const TAB_ARCHIVE_AFTER = ['off', '12h', '1d', '1w', '30d'] as const
export type TabArchiveAfter = (typeof TAB_ARCHIVE_AFTER)[number]

/** Where a link from another app (Mail, Slack, Finder) opens: a new tab, or a small floating quick window. */
export const LINKS_FROM_OTHER_APPS = ['tab', 'quick-window'] as const
export type LinksFromOtherApps = (typeof LINKS_FROM_OTHER_APPS)[number]

export type BrowsingSettings = {
  pageAppearance: PageAppearance
  defaultBrowser: DefaultBrowserStatus
  tabSleep: TabSleepAfter
  tabSwitchOrder: TabSwitchOrder
  tabArchive: TabArchiveAfter
  linksFromOtherApps: LinksFromOtherApps
  /** Video follows you: leaving a tab whose video plays floats that video in picture-in-picture (off by default). */
  autoPictureInPicture: boolean
}

/** The tab the now-playing control stands for (null in the event when nothing plays). */
export type NowPlayingSnapshot = {
  tabId: string
  title: string
  /** Its media is playing now (false: paused, or floating and paused). */
  playing: boolean
  muted: boolean
  /** The tab's video floats in picture-in-picture. */
  pip: boolean
}

/** A page asked to open another app. Shown as "Open <appName>?" in the shell. */
export type ExternalOpenRequest = {
  id: string
  /** e.g. "mailto" */
  scheme: string
  /** The app macOS would open, e.g. "Mail"; empty when unknown. */
  appName: string
  /** The page that asked, e.g. "https://zoom.us" (empty when unknown). */
  site: string
  /** What will be opened, shortened for display. */
  target: string
  /** Asked from a private tab: "Always allow" is not offered and nothing is remembered. */
  isPrivate: boolean
}

/** A rule: a link from another app to `site` (or a subdomain of it) opens in `workspaceId`. Kept only on this Mac. */
export type LinkRouteSnapshot = {
  id: string
  /** A host such as example.com: matches it and any subdomain. */
  site: string
  workspaceId: string
  /** The workspace's name, or null when it was deleted (the rule is skipped until it is removed). */
  workspaceName: string | null
}

export type LinkRoutesState = {
  /** In order: the first rule that matches a link wins. */
  rules: LinkRouteSnapshot[]
  workspaces: { id: string; name: string }[]
}

export const LINK_ROUTE_SITE_MAX = 253

/**
 * Links from other apps held back after a burst (more than 6 within 3 seconds): "Opened `opened` of
 * `total` links from another app", with "Open the rest".
 */
export type HeldIncomingLinks = { opened: number; total: number }

export type BrowsingEvent =
  | { type: 'external-request'; request: ExternalOpenRequest }
  | { type: 'incoming-held'; held: HeldIncomingLinks | null }
  | { type: 'external-resolved'; id: string }
  | { type: 'settings'; settings: BrowsingSettings }
  | { type: 'link-routes'; state: LinkRoutesState }

export type BrowsingCommand =
  | { type: 'external-decide'; id: string; decision: 'open' | 'cancel'; always: boolean }
  | { type: 'external-pending' }
  | { type: 'get-held-incoming' }
  | { type: 'open-held-incoming' }
  | { type: 'dismiss-held-incoming' }
  | { type: 'settings' }
  | { type: 'set-page-appearance'; appearance: PageAppearance }
  | { type: 'make-default-browser' }
  | { type: 'set-tab-sleep'; after: TabSleepAfter }
  | { type: 'set-tab-switch-order'; order: TabSwitchOrder }
  | { type: 'set-tab-archive'; after: TabArchiveAfter }
  | { type: 'set-links-from-other-apps'; choice: LinksFromOtherApps }
  | { type: 'set-auto-picture-in-picture'; enabled: boolean }
  | { type: 'get-link-routes' }
  | { type: 'add-link-route'; site: string; workspaceId: string }
  | { type: 'update-link-route'; id: string; site?: string; workspaceId?: string }
  | { type: 'move-link-route'; id: string; toIndex: number }
  | { type: 'remove-link-route'; id: string }

export interface BrowsingApi {
  decideExternal(id: string, decision: 'open' | 'cancel', always?: boolean): Promise<void>
  pendingExternal(): Promise<ExternalOpenRequest[]>
  /** Links from other apps held back after a burst (null: none). */
  heldIncoming(): Promise<HeldIncomingLinks | null>
  /** "Open the rest": the held links open. */
  openHeldIncoming(): Promise<void>
  /** The held links are dropped. */
  dismissHeldIncoming(): Promise<void>
  settings(): Promise<BrowsingSettings>
  setPageAppearance(appearance: PageAppearance): Promise<BrowsingSettings>
  /** Asks macOS to make Intoponet the default browser (macOS shows its own confirmation). */
  makeDefaultBrowser(): Promise<BrowsingSettings>
  setTabSleep(after: TabSleepAfter): Promise<BrowsingSettings>
  setTabSwitchOrder(order: TabSwitchOrder): Promise<BrowsingSettings>
  setTabArchive(after: TabArchiveAfter): Promise<BrowsingSettings>
  setLinksFromOtherApps(choice: LinksFromOtherApps): Promise<BrowsingSettings>
  setAutoPictureInPicture(enabled: boolean): Promise<BrowsingSettings>
  /** Rules for links from other apps (linkRoutes): the first matching rule's workspace wins. */
  linkRoutes(): Promise<LinkRoutesState>
  addLinkRoute(site: string, workspaceId: string): Promise<LinkRoutesState>
  updateLinkRoute(id: string, changes: { site?: string; workspaceId?: string }): Promise<LinkRoutesState>
  moveLinkRoute(id: string, toIndex: number): Promise<LinkRoutesState>
  removeLinkRoute(id: string): Promise<LinkRoutesState>
  subscribe(listener: (event: BrowsingEvent) => void): () => void
}

export function isPageAppearance(value: unknown): value is PageAppearance {
  return typeof value === 'string' && (PAGE_APPEARANCES as readonly string[]).includes(value)
}

const linkRouteText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max

export function parseBrowsingCommand(value: unknown): BrowsingCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid browsing command.')
  const v = value as Record<string, unknown>
  switch (v['type']) {
    case 'external-decide':
      if (typeof v['id'] !== 'string' || v['id'].length === 0 || v['id'].length > 80) break
      if (v['decision'] !== 'open' && v['decision'] !== 'cancel') break
      if (v['always'] !== undefined && typeof v['always'] !== 'boolean') break
      return { type: 'external-decide', id: v['id'], decision: v['decision'], always: v['always'] === true }
    case 'set-page-appearance':
      if (!isPageAppearance(v['appearance'])) break
      return { type: 'set-page-appearance', appearance: v['appearance'] }
    case 'set-tab-sleep':
      if (typeof v['after'] !== 'string' || !(TAB_SLEEP_AFTER as readonly string[]).includes(v['after'])) break
      return { type: 'set-tab-sleep', after: v['after'] as TabSleepAfter }
    case 'set-tab-switch-order':
      if (typeof v['order'] !== 'string' || !(TAB_SWITCH_ORDERS as readonly string[]).includes(v['order'])) break
      return { type: 'set-tab-switch-order', order: v['order'] as TabSwitchOrder }
    case 'set-tab-archive':
      if (typeof v['after'] !== 'string' || !(TAB_ARCHIVE_AFTER as readonly string[]).includes(v['after'])) break
      return { type: 'set-tab-archive', after: v['after'] as TabArchiveAfter }
    case 'set-links-from-other-apps':
      if (typeof v['choice'] !== 'string' || !(LINKS_FROM_OTHER_APPS as readonly string[]).includes(v['choice'])) break
      return { type: 'set-links-from-other-apps', choice: v['choice'] as LinksFromOtherApps }
    case 'set-auto-picture-in-picture':
      if (typeof v['enabled'] !== 'boolean') break
      return { type: 'set-auto-picture-in-picture', enabled: v['enabled'] }
    case 'add-link-route':
      if (!linkRouteText(v['site'], LINK_ROUTE_SITE_MAX) || !linkRouteText(v['workspaceId'], 80)) break
      return { type: 'add-link-route', site: v['site'] as string, workspaceId: v['workspaceId'] as string }
    case 'update-link-route':
      if (!linkRouteText(v['id'], 80)) break
      if (v['site'] !== undefined && !linkRouteText(v['site'], LINK_ROUTE_SITE_MAX)) break
      if (v['workspaceId'] !== undefined && !linkRouteText(v['workspaceId'], 80)) break
      return {
        type: 'update-link-route',
        id: v['id'] as string,
        ...(v['site'] !== undefined ? { site: v['site'] as string } : {}),
        ...(v['workspaceId'] !== undefined ? { workspaceId: v['workspaceId'] as string } : {}),
      }
    case 'move-link-route':
      if (!linkRouteText(v['id'], 80) || typeof v['toIndex'] !== 'number' || !Number.isInteger(v['toIndex']) || v['toIndex'] < 0 || v['toIndex'] > 100) break
      return { type: 'move-link-route', id: v['id'] as string, toIndex: v['toIndex'] }
    case 'remove-link-route':
      if (!linkRouteText(v['id'], 80)) break
      return { type: 'remove-link-route', id: v['id'] as string }
    case 'external-pending':
    case 'get-held-incoming':
    case 'open-held-incoming':
    case 'dismiss-held-incoming':
    case 'settings':
    case 'make-default-browser':
    case 'get-link-routes':
      return { type: v['type'] }
  }
  throw new Error('Invalid browsing command.')
}

/** Why a page could not load, as the in-tab error page shows it. */
export type PageLoadErrorKind =
  | 'offline'
  | 'not-found'
  | 'timeout'
  | 'refused'
  | 'unreachable'
  | 'certificate'
  | 'insecure'
  | 'blocked'
  | 'redirects'
  /** The site answered with an HTTP error (4xx or 5xx); shown only for a Compare side's article. */
  | 'http'
  | 'other'

export type CertificateSummary = {
  subject: string
  issuer: string
  /** ISO dates. */
  validFrom: string
  validUntil: string
  fingerprint: string
  /** Chromium's name for the problem, e.g. "net::ERR_CERT_DATE_INVALID". */
  error: string
}

export type PageLoadError = {
  kind: PageLoadErrorKind
  title: string
  detail: string
  /** The address that failed (the address bar keeps showing it). */
  url: string
  host: string
  code: number
  /** e.g. "ERR_NAME_NOT_RESOLVED" */
  codeName: string
  certificate?: CertificateSummary
  /** The page reloads by itself when the Mac is back online. */
  autoRetry: boolean
}
