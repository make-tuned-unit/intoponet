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

export type BrowsingSettings = {
  pageAppearance: PageAppearance
  defaultBrowser: DefaultBrowserStatus
  tabSleep: TabSleepAfter
  tabSwitchOrder: TabSwitchOrder
  tabArchive: TabArchiveAfter
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

export type BrowsingEvent =
  | { type: 'external-request'; request: ExternalOpenRequest }
  | { type: 'external-resolved'; id: string }
  | { type: 'settings'; settings: BrowsingSettings }

export type BrowsingCommand =
  | { type: 'external-decide'; id: string; decision: 'open' | 'cancel'; always: boolean }
  | { type: 'external-pending' }
  | { type: 'settings' }
  | { type: 'set-page-appearance'; appearance: PageAppearance }
  | { type: 'make-default-browser' }
  | { type: 'set-tab-sleep'; after: TabSleepAfter }
  | { type: 'set-tab-switch-order'; order: TabSwitchOrder }
  | { type: 'set-tab-archive'; after: TabArchiveAfter }

export interface BrowsingApi {
  decideExternal(id: string, decision: 'open' | 'cancel', always?: boolean): Promise<void>
  pendingExternal(): Promise<ExternalOpenRequest[]>
  settings(): Promise<BrowsingSettings>
  setPageAppearance(appearance: PageAppearance): Promise<BrowsingSettings>
  /** Asks macOS to make Intoponet the default browser (macOS shows its own confirmation). */
  makeDefaultBrowser(): Promise<BrowsingSettings>
  setTabSleep(after: TabSleepAfter): Promise<BrowsingSettings>
  setTabSwitchOrder(order: TabSwitchOrder): Promise<BrowsingSettings>
  setTabArchive(after: TabArchiveAfter): Promise<BrowsingSettings>
  subscribe(listener: (event: BrowsingEvent) => void): () => void
}

export function isPageAppearance(value: unknown): value is PageAppearance {
  return typeof value === 'string' && (PAGE_APPEARANCES as readonly string[]).includes(value)
}

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
    case 'external-pending':
    case 'settings':
    case 'make-default-browser':
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
