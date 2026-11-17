import { FiltersEngine, Request, parseFilters, type NetworkFilter, type RequestType } from '@ghostery/adblocker'
import { getDomain } from 'tldts-experimental'
import type { BlockingCategory, BlockingDecision, CategoryToggles, ResourceType } from './types'

/**
 * The public filter lists (EasyList for ads, EasyPrivacy for trackers), matched by Ghostery's
 * adblocker library. The lists are data files (packages/protection-engine/lists, fetched by
 * scripts/update-protection-lists.mjs and never edited); they are compiled once, when the app is
 * built, into one file the app reads at launch in about a millisecond. Parsing the lists' text
 * takes about a second, so the app never does that itself.
 *
 * One engine holds both lists, so an exception rule (@@) in either list lets a request through
 * whichever list would have blocked it. Which list a blocking rule came from says whether the
 * request counts as an ad or a tracker.
 */

/** "IPL" and a format number; changed whenever the layout below changes. */
const MAGIC = [0x49, 0x50, 0x4c, 0x32] as const

/**
 * Optimizations off: the library would otherwise merge rules into combined ones at match time,
 * and a merged rule no longer says which list it came from (matching costs about a microsecond
 * more per request without them). Scriptlets, HTML filtering and CSP rules are not used: the
 * lists here do not need them, and the resources they refer to are not shipped.
 */
const ENGINE_CONFIG = {
  enableOptimizations: false,
  enableHtmlFiltering: false,
  loadCSPFilters: false,
  loadExtendedSelectors: false,
  loadPreprocessors: false,
  loadCosmeticFilters: true,
  loadGenericCosmeticsFilters: true,
  loadNetworkFilters: true,
} as const

/** A source for requests no page made: never the same site as anything, so third-party rules apply. */
const NO_PAGE = 'https://no-page.invalid/'

/** Most classes, ids and link addresses of one frame looked up at a time (a very large page is cut off here). */
const MAX_DOM_TOKENS = 4000

/**
 * Compiles the two lists' text into the file the app loads. Run at build time (and in tests);
 * the result only loads in the same version of the matcher library that wrote it.
 */
export function compileProtectionLists(lists: { ads: string; trackers: string }): Uint8Array {
  const engine = FiltersEngine.parse(`${lists.ads}\n${lists.trackers}`, ENGINE_CONFIG)
  const adIds = new Set(parseFilters(lists.ads, ENGINE_CONFIG).networkFilters.map((filter) => filter.getId() >>> 0))
  // A rule in both lists counts as an ad rule: turning "Block ads" off must not leave it to the other switch.
  const trackerIds = Uint32Array.from(
    [...new Set(parseFilters(lists.trackers, ENGINE_CONFIG).networkFilters.map((filter) => filter.getId() >>> 0))]
      .filter((id) => !adIds.has(id))
      .sort((a, b) => a - b),
  )
  const serialized = engine.serialize()
  const out = new Uint8Array(8 + trackerIds.byteLength + serialized.byteLength)
  out.set(MAGIC, 0)
  const view = new DataView(out.buffer)
  view.setUint32(4, trackerIds.length, true)
  for (let i = 0; i < trackerIds.length; i += 1) view.setUint32(8 + i * 4, trackerIds[i]!, true)
  out.set(serialized, 8 + trackerIds.byteLength)
  return out
}

function isHttpUrl(value: string | null): value is string {
  return !!value && /^https?:\/\//i.test(value)
}

/** The site an address belongs to (its registrable domain: "cnn.com" for "edition.cnn.com"); the host itself when it has none (an IP address, localhost). */
export function siteOfHost(hostname: string): string {
  return getDomain(hostname) ?? hostname
}

function requestType(type: ResourceType): RequestType {
  switch (type) {
    case 'document':
      return 'main_frame'
    case 'xhr':
    case 'fetch':
      return 'xmlhttprequest'
    default:
      return type
  }
}

export class ProtectionLists {
  private constructor(
    private readonly engine: FiltersEngine,
    private readonly trackerIds: Uint32Array,
  ) {}

  /** The compiled lists, or null when the file is not one this version can read (the caller then keeps its built-in rules). */
  static load(data: Uint8Array): ProtectionLists | null {
    try {
      if (data.byteLength < 8 || MAGIC.some((byte, index) => data[index] !== byte)) return null
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const count = view.getUint32(4, true)
      const engineStart = 8 + count * 4
      if (engineStart >= data.byteLength) return null
      const trackerIds = new Uint32Array(count)
      for (let i = 0; i < count; i += 1) trackerIds[i] = view.getUint32(8 + i * 4, true)
      // The library reads the bytes in place: it gets its own copy, apart from the file's buffer.
      const engine = FiltersEngine.deserialize(data.slice(engineStart))
      return new ProtectionLists(engine, trackerIds)
    } catch {
      return null
    }
  }

  private categoryOf(filter: NetworkFilter): Exclude<BlockingCategory, 'other'> {
    const id = filter.getId() >>> 0
    let low = 0
    let high = this.trackerIds.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const value = this.trackerIds[middle]!
      if (value === id) return 'tracker'
      if (value < id) low = middle + 1
      else high = middle - 1
    }
    return 'ad'
  }

  /**
   * The lists' decision for a request that is not the page's own. `sourceUrl` is the document that
   * asked (the frame's, else the page's): the lists' third-party and per-site options are written
   * against it.
   */
  evaluate(requestUrl: string, sourceUrl: string | null, type: ResourceType, categories: CategoryToggles): BlockingDecision {
    const request = Request.fromRawDetails({ url: requestUrl, sourceUrl: isHttpUrl(sourceUrl) ? sourceUrl : NO_PAGE, type: requestType(type) })
    if (categories.ads && categories.trackers) {
      const result = this.engine.match(request)
      if (!result.match || !result.filter) return { action: 'allow' }
      return this.block(result.filter)
    }
    if (!categories.ads && !categories.trackers) return { action: 'allow' }
    // One kind is switched off: only the other list's rules may block, and every exception still counts.
    const wanted = categories.ads ? 'ad' : 'tracker'
    let blocking: NetworkFilter | undefined
    let important = false
    let excepted = false
    for (const filter of this.engine.matchAll(request)) {
      if (filter.isCSP() || filter.isRemoveParam()) continue
      if (filter.isException()) {
        // (Exceptions that only stop element hiding do not let a request through.)
        if (!filter.isElemHide() && !filter.isGenericHide() && !filter.isSpecificHide()) excepted = true
        continue
      }
      if (this.categoryOf(filter) !== wanted) continue
      if (filter.isImportant()) important = true
      blocking ??= filter
    }
    if (!blocking || (excepted && !important)) return { action: 'allow' }
    return this.block(blocking)
  }

  private block(filter: NetworkFilter): BlockingDecision {
    const category = this.categoryOf(filter)
    return { action: 'block', category, ruleId: `${category === 'ad' ? 'easylist' : 'easyprivacy'}-${(filter.getId() >>> 0).toString(16)}` }
  }

  /** The rules that hide ad elements on a page whatever is in it: the list's rules for this site, and the general ones that need no lookup. */
  pageCss(documentUrl: string): string {
    const page = this.pageOf(documentUrl)
    if (!page) return ''
    return this.engine.getCosmeticsFilters({
      ...page,
      getBaseRules: true,
      getRulesFromHostname: true,
      getRulesFromDOM: false,
      getInjectionRules: false,
      getExtendedRules: false,
    }).styles
  }

  /** The general rules that apply to the classes, ids and link addresses actually found in a frame. */
  elementCss(documentUrl: string, found: { classes?: readonly string[]; ids?: readonly string[]; hrefs?: readonly string[] }): string {
    const page = this.pageOf(documentUrl)
    if (!page) return ''
    const strings = (values: readonly string[] | undefined): string[] =>
      Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length < 300).slice(0, MAX_DOM_TOKENS) : []
    return this.engine.getCosmeticsFilters({
      ...page,
      classes: strings(found.classes),
      ids: strings(found.ids),
      hrefs: strings(found.hrefs),
      getBaseRules: false,
      getRulesFromHostname: false,
      getRulesFromDOM: true,
      getInjectionRules: false,
      getExtendedRules: false,
    }).styles
  }

  private pageOf(documentUrl: string): { url: string; hostname: string; domain: string } | null {
    if (!isHttpUrl(documentUrl)) return null
    try {
      const hostname = new URL(documentUrl).hostname.toLowerCase()
      return { url: documentUrl, hostname, domain: siteOfHost(hostname) }
    } catch {
      return null
    }
  }
}
