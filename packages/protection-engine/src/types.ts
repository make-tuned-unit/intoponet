export type ResourceType =
  | 'document'
  | 'sub_frame'
  | 'script'
  | 'stylesheet'
  | 'image'
  | 'font'
  | 'media'
  | 'xhr'
  | 'fetch'
  | 'websocket'
  | 'ping'
  | 'object'
  | 'csp_report'
  | 'other'

export type BlockingCategory = 'ad' | 'tracker' | 'other'

export type RequestContext = {
  requestUrl: string
  topLevelUrl: string | null
  initiatorOrigin: string | null
  resourceType: ResourceType
  profileId: string
  isPrivate: boolean
}

export type BlockingDecision = {
  action: 'allow' | 'block'
  category?: BlockingCategory
  ruleId?: string
}

export type CategoryToggles = {
  ads: boolean
  trackers: boolean
}

export type ProtectionSnapshot = {
  origin: string
  enabled: boolean
  blockedAds: number
  blockedTrackers: number
  adsEnabled: boolean
  trackersEnabled: boolean
}

/**
 * One rule of the blocker. It applies to a host and every host under it ("doubleclick.net" also
 * covers "ad.doubleclick.net"), and only on pages of other sites.
 */
export type CompiledRule = {
  host: string
  category: BlockingCategory
  id: string
  /** Narrows the rule to requests whose path starts with one of these ("/tr" on facebook.com). */
  paths?: readonly string[]
  /** Narrows the rule to requests whose path contains one of these ("/fbevents.js" on connect.facebook.net). */
  pathIncludes?: readonly string[]
  /** Narrows the rule to these kinds of request. */
  types?: readonly ResourceType[]
  /**
   * An exception: a matching request is let through, even when a rule for the same host or for a
   * domain above it would block it. `category` is then not used.
   */
  allow?: boolean
}

export interface ProtectionAdapter {
  evaluate(ctx: RequestContext): BlockingDecision
  cosmeticRules(): { hideSelectors: string[]; cssRules: string[] }
  setSiteEnabled(origin: string, profileId: string, enabled: boolean): void
  isSiteEnabled(origin: string, profileId: string): boolean
}
