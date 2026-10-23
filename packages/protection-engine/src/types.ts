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

export type CompiledRule = {
  host: string
  category: BlockingCategory
  id: string
}

export interface ProtectionAdapter {
  evaluate(ctx: RequestContext): BlockingDecision
  cosmeticRules(
    documentUrl: string,
    topLevelUrl: string,
  ): { hideSelectors: string[]; cssRules: string[] }
  setSiteEnabled(origin: string, profileId: string, enabled: boolean): void
  isSiteEnabled(origin: string, profileId: string): boolean
}
