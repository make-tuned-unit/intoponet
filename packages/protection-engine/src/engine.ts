import { defaultRules } from './blocklist'
import { fixtureHideSelectors } from './fixtures'
import { sameSite } from './site'
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
const allow: BlockingDecision = { action: 'allow' }

type UrlParts = { origin: string; host: string; path: string }

/**
 * The parts of an http(s) or ws(s) address the matcher needs, cut out of the string (several times
 * faster than `new URL`, and this runs for every request). Addresses reach the matcher from
 * Chromium, already normalised: lower-case host, no default port. Null for anything else.
 */
export function urlParts(url: string | null): UrlParts | null {
  if (!url) return null
  const scheme = url.indexOf('://')
  if (scheme < 2 || scheme > 5) return null
  const head = url.charCodeAt(0) | 32
  if (head !== 104 /* h */ && head !== 119 /* w */) return null
  const start = scheme + 3
  let end = url.length
  for (let index = start; index < end; index += 1) {
    const code = url.charCodeAt(index)
    if (code === 47 /* / */ || code === 63 /* ? */ || code === 35 /* # */) {
      end = index
      break
    }
  }
  let authority = url.slice(start, end)
  const at = authority.lastIndexOf('@')
  if (at >= 0) authority = authority.slice(at + 1)
  authority = authority.toLowerCase()
  let host = authority
  const colon = host.lastIndexOf(':')
  if (colon >= 0 && host.indexOf(']', colon) < 0) host = host.slice(0, colon)
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (!host) return null
  let pathEnd = url.length
  for (let index = end; index < pathEnd; index += 1) {
    const code = url.charCodeAt(index)
    if (code === 63 || code === 35) {
      pathEnd = index
      break
    }
  }
  return { origin: `${url.slice(0, start).toLowerCase()}${authority}`, host, path: url.slice(end, pathEnd) || '/' }
}

function ruleApplies(rule: CompiledRule, path: string, type: ResourceType): boolean {
  if (rule.types && !rule.types.includes(type)) return false
  if (!rule.paths && !rule.pathIncludes) return true
  if (rule.paths) for (const prefix of rule.paths) if (path.startsWith(prefix)) return true
  if (rule.pathIncludes) for (const part of rule.pathIncludes) if (path.includes(part)) return true
  return false
}

/**
 * Intoponet's own blocker. Rules are kept by host; a request is looked up by its host, then by
 * each domain above it ("a.b.example.com", "b.example.com", "example.com"), so a decision costs a
 * handful of map lookups however many rules there are. The most specific host with a rule that
 * applies decides, and there an exception beats a block.
 *
 * A request to the site the person is on is never blocked (site.ts says what "the same site"
 * means), nor is the page itself.
 */
export class LocalProtectionEngine implements ProtectionAdapter {
  private readonly rulesByHost = new Map<string, CompiledRule[]>()
  private readonly ruleCount: number
  private readonly hideSelectors: string[]
  private readonly disabledOrigins = new Map<string, Set<string>>()
  private categories: CategoryToggles = { ads: true, trackers: true }
  /** The pages requests are coming from: a few addresses, asked about thousands of times. */
  private readonly pageCache = new Map<string, UrlParts | null>()

  constructor(rules: readonly CompiledRule[] = defaultRules, hideSelectors: readonly string[] = fixtureHideSelectors) {
    for (const rule of rules) {
      const host = rule.host.toLowerCase()
      const list = this.rulesByHost.get(host)
      if (list) list.push(rule)
      else this.rulesByHost.set(host, [rule])
    }
    // Exceptions are tried first, then the narrowed rules, then the ones for the whole host.
    const rank = (rule: CompiledRule): number => (rule.allow ? 0 : rule.paths || rule.pathIncludes || rule.types ? 1 : 2)
    for (const list of this.rulesByHost.values()) if (list.length > 1) list.sort((left, right) => rank(left) - rank(right))
    this.ruleCount = rules.length
    this.hideSelectors = [...new Set(hideSelectors)]
  }

  /** How many rules the engine holds (exceptions included). */
  size(): number {
    return this.ruleCount
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

  private pageParts(url: string | null): UrlParts | null {
    if (!url) return null
    const cached = this.pageCache.get(url)
    if (cached !== undefined) return cached
    if (this.pageCache.size > 256) this.pageCache.clear()
    const parts = urlParts(url)
    this.pageCache.set(url, parts)
    return parts
  }

  /** The rule that blocks this request wherever it is asked from; undefined when none does, or an exception lets it through. */
  private blockingRule(host: string, path: string, type: ResourceType): CompiledRule | undefined {
    let domain = host
    for (;;) {
      const rules = this.rulesByHost.get(domain)
      if (rules) {
        let switchedOff = false
        for (const rule of rules) {
          if (!ruleApplies(rule, path, type)) continue
          if (rule.allow) return undefined
          if ((rule.category === 'ad' && !this.categories.ads) || (rule.category === 'tracker' && !this.categories.trackers)) {
            switchedOff = true
            continue
          }
          return rule
        }
        // The most specific host with a rule that applies decides: with its kind of blocking
        // switched off, a broader rule of the other kind does not take over.
        if (switchedOff) return undefined
      }
      const dot = domain.indexOf('.')
      if (dot < 0) return undefined
      domain = domain.slice(dot + 1)
    }
  }

  evaluate(ctx: RequestContext): BlockingDecision {
    if (ctx.resourceType === 'document') return allow
    const request = urlParts(ctx.requestUrl)
    if (!request) return allow
    // Nearly every request stops here: there is no rule for its host.
    const rule = this.blockingRule(request.host, request.path, ctx.resourceType)
    if (!rule) return allow
    const page = this.pageParts(ctx.topLevelUrl)
    if (page) {
      if (!this.isSiteEnabled(page.origin, ctx.profileId)) return allow
      if (sameSite(request.host, page.host)) return allow
    }
    return { action: 'block', category: rule.category, ruleId: rule.id }
  }

  /**
   * What hides ad elements on a page: Intoponet's own selectors for containers that hold only ads.
   * They are also what Export as PDF removes. Empty with "Block ads" off.
   */
  cosmeticRules(): { hideSelectors: string[]; cssRules: string[] } {
    if (!this.categories.ads || !this.hideSelectors.length) return { hideSelectors: [], cssRules: [] }
    return {
      hideSelectors: [...this.hideSelectors],
      cssRules: [`${this.hideSelectors.join(',')}{display:none!important;content-visibility:hidden!important;}`],
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
