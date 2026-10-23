import { fixtureHideSelectors, fixtureRules } from './fixtures'
import type {
  BlockingCategory,
  BlockingDecision,
  CategoryToggles,
  CompiledRule,
  ProtectionAdapter,
  RequestContext,
  ResourceType,
} from './types'

const defaultProfile = 'default'

function hostnameOf(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

function originOf(value: string | null): string {
  if (!value) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function hostMatches(hostname: string, ruleHost: string): boolean {
  return hostname === ruleHost || hostname.endsWith(`.${ruleHost}`)
}

export class LocalProtectionEngine implements ProtectionAdapter {
  private readonly rules: CompiledRule[]
  private readonly disabledOrigins = new Map<string, Set<string>>()
  private categories: CategoryToggles = { ads: true, trackers: true }

  constructor(rules: CompiledRule[] = fixtureRules) {
    this.rules = rules
  }

  categoryToggles(): CategoryToggles {
    return { ...this.categories }
  }

  setCategoryEnabled(category: Exclude<BlockingCategory, 'other'>, enabled: boolean): void {
    if (category === 'ad') this.categories.ads = enabled
    else this.categories.trackers = enabled
  }

  loadCategories(toggles: CategoryToggles): void {
    this.categories = { ads: toggles.ads !== false, trackers: toggles.trackers !== false }
  }

  loadDisabledOrigins(origins: string[], profileId = defaultProfile): void {
    this.disabledOrigins.set(profileId, new Set(origins))
  }

  disabledOriginList(profileId = defaultProfile): string[] {
    return [...(this.disabledOrigins.get(profileId) ?? [])]
  }

  isSiteEnabled(origin: string, profileId = defaultProfile): boolean {
    return !this.disabledOrigins.get(profileId)?.has(origin)
  }

  setSiteEnabled(origin: string, profileId: string, enabled: boolean): void {
    const current = this.disabledOrigins.get(profileId) ?? new Set<string>()
    if (enabled) current.delete(origin)
    else current.add(origin)
    this.disabledOrigins.set(profileId, current)
  }

  evaluate(ctx: RequestContext): BlockingDecision {
    if (ctx.resourceType === 'document') return { action: 'allow' }
    const requestHost = hostnameOf(ctx.requestUrl)
    if (!requestHost) return { action: 'allow' }
    const topOrigin = originOf(ctx.topLevelUrl)
    if (topOrigin && !this.isSiteEnabled(topOrigin, ctx.profileId)) {
      return { action: 'allow' }
    }
    const topHost = hostnameOf(ctx.topLevelUrl)
    if (topHost && (requestHost === topHost || requestHost.endsWith(`.${topHost}`))) {
      return { action: 'allow' }
    }
    for (const rule of this.rules) {
      if (!hostMatches(requestHost, rule.host)) continue
      if (rule.category === 'ad' && !this.categories.ads) return { action: 'allow' }
      if (rule.category === 'tracker' && !this.categories.trackers) return { action: 'allow' }
      return { action: 'block', category: rule.category, ruleId: rule.id }
    }
    return { action: 'allow' }
  }

  cosmeticRules(
    _documentUrl = '',
    _topLevelUrl = '',
  ): { hideSelectors: string[]; cssRules: string[] } {
    if (!this.categories.ads) return { hideSelectors: [], cssRules: [] }
    return {
      hideSelectors: [...fixtureHideSelectors],
      cssRules: [
        `${fixtureHideSelectors.join(',')}{display:none!important;content-visibility:hidden!important;}`,
      ],
    }
  }
}

export function mapElectronResourceType(value: string): ResourceType {
  switch (value) {
    case 'mainFrame':
      return 'document'
    case 'subFrame':
      return 'sub_frame'
    case 'stylesheet':
      return 'stylesheet'
    case 'script':
      return 'script'
    case 'image':
      return 'image'
    case 'font':
      return 'font'
    case 'media':
      return 'media'
    case 'xhr':
      return 'xhr'
    case 'webSocket':
      return 'websocket'
    default:
      return 'other'
  }
}
