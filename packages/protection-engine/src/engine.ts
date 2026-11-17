import { fixtureHideSelectors, fixtureRules } from './fixtures'
import { ProtectionLists, siteOfHost } from './lists'
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

/**
 * Whether a request goes to the site the person is on: the same registrable domain ("cdn.cnn.com"
 * on "www.cnn.com"), or a host under the page's own. Such requests are never blocked: the lists'
 * rules are applied to other sites' requests only, so a site's own scripts, sign-in and media
 * always load.
 */
function sameSite(requestHost: string, topHost: string): boolean {
  if (requestHost === topHost || requestHost.endsWith(`.${topHost}`)) return true
  return siteOfHost(requestHost) === siteOfHost(topHost)
}

export class LocalProtectionEngine implements ProtectionAdapter {
  private readonly rules: CompiledRule[]
  private readonly disabledOrigins = new Map<string, Set<string>>()
  private categories: CategoryToggles = { ads: true, trackers: true }
  private lists: ProtectionLists | null = null

  constructor(rules: CompiledRule[] = fixtureRules) {
    this.rules = rules
  }

  /**
   * Loads the compiled public filter lists (the file compileProtectionLists wrote). False when the
   * file cannot be read by this version: the engine then keeps blocking with its built-in rules only.
   */
  loadLists(data: Uint8Array): boolean {
    this.lists = ProtectionLists.load(data)
    return this.lists !== null
  }

  /** Whether the public filter lists are in use (otherwise only the built-in rules). */
  hasLists(): boolean {
    return this.lists !== null
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
    if (topHost && sameSite(requestHost, topHost)) return { action: 'allow' }
    for (const rule of this.rules) {
      if (this.lists && !rule.always) continue
      if (!hostMatches(requestHost, rule.host)) continue
      if (rule.category === 'ad' && !this.categories.ads) return { action: 'allow' }
      if (rule.category === 'tracker' && !this.categories.trackers) return { action: 'allow' }
      return { action: 'block', category: rule.category, ruleId: rule.id }
    }
    if (!this.lists) return { action: 'allow' }
    // The lists' third-party and per-site options are written against the document that asked:
    // the frame when it is known, else the page.
    const source = ctx.initiatorOrigin && /^https?:/i.test(ctx.initiatorOrigin) ? ctx.initiatorOrigin : ctx.topLevelUrl
    return this.lists.evaluate(ctx.requestUrl, source, ctx.resourceType, this.categories)
  }

  /**
   * What hides ad elements on a page. `hideSelectors` are the built-in ad containers (also used
   * to strip ads from an exported page and to find emptied ad slots); `cssRules` adds the lists'
   * rules for the page's site.
   */
  cosmeticRules(
    documentUrl = '',
    _topLevelUrl = '',
  ): { hideSelectors: string[]; cssRules: string[] } {
    if (!this.categories.ads) return { hideSelectors: [], cssRules: [] }
    const listCss = this.lists?.pageCss(documentUrl) ?? ''
    return {
      hideSelectors: [...fixtureHideSelectors],
      cssRules: [
        `${fixtureHideSelectors.join(',')}{display:none!important;content-visibility:hidden!important;}`,
        ...(listCss ? [listCss] : []),
      ],
    }
  }

  /**
   * The lists' general element-hiding rules for what a frame actually contains (its class names,
   * ids and link addresses): there are tens of thousands of them, so only the ones that can apply
   * are sent to the page. Empty with "Block ads" off or without the lists.
   */
  cosmeticRulesForElements(
    documentUrl: string,
    found: { classes?: readonly string[]; ids?: readonly string[]; hrefs?: readonly string[] },
  ): string {
    if (!this.categories.ads || !this.lists) return ''
    return this.lists.elementCss(documentUrl, found)
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
    case 'ping':
      return 'ping'
    case 'object':
      return 'object'
    case 'cspReport':
      return 'csp_report'
    default:
      return 'other'
  }
}
