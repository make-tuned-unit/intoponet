import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isQid,
  OLDS_ATTRIBUTION,
  OLDS_LIMITS,
  OLDS_NOTE,
  type OldsEdge,
  type OldsNode,
  type OldsQuery,
  type OldsThread,
} from '@intoponet/browser-api'
import { edgesFromEntity, isEventLike, nodeFromEntity, resolveCitations, statedInIds, type DraftEdge, type WikidataEntity } from './wikidata'
import { articleLinks, chapterForYear, chaptersFromWikitext, sectionUrl, sectionWithSubsections } from './historyArticle'
import type { OldsChapter, OldsContext, OldsCountryFacts, OldsPathStep, OldsSupport } from '@intoponet/browser-api'
import { interpretationsFrom } from './interpretations'
import { expansionFromSnippets } from './acronyms'
import { chronologyFromWikitext } from './chronology'
import { historicalArticles, historicalSeriesArticles, linkedHistoricalSeriesEditions, olderContext } from './historicalContext'
import { otherCountries, relatedQueries, subjectTerms } from './relatedTopics'
import { dayPages, isTitleCase, matchHeadline, parseDayPage, shortlist, threadItems, type CurrentEventItem } from './currentEvents'
import { countryPlace, placeNames, placesNamedIn } from '../../shared/places/places'
import { COUNTRY_ROWS } from '../../shared/places/placeData'
import { figuresIn, withoutCitations } from '../knowledge/claims'
import type { OldsChronicleEntry, OldsRelatedTopic } from '@intoponet/browser-api'
import { cleanHeadline, foreignNamesIn, isRelevantCandidate, mentions, properPhrases, personNameAtStart, explicitPlacePhrases, fullPersonNameMentioned, officeHolderNamed, outletIsSubject, MEDIA_OUTLET_CLASSES, entityNameAtStart, personActivityConflicts, NOT_A_TOPIC, PATH_PROPERTIES, foldAccents, scoreCandidate, searchQueries, localLegislativeSubject, scopedSubjectMatches, titleContentWords, titleWordsIn, topicAge, eventNameConflicts, eventKindConflicts, eventKindMatches, eventKindNamed, unmentionedEditions, namedEvents, namesASport, eventKindsIn } from './headline'

const USER_AGENT = 'Intoponet/0.1 (+https://github.com/make-tuned-unit/intoponet; The Olds)'
const TIMEOUT_MS = 15_000
// Words that turn a place name into something else in it ("Ajloun Castle", "Ulsan station").
const FACILITY = /\b(castle|fort|fortress|palace|cathedral|church|mosque|temple|airport|station|stadium|arena|university|college|school|hospital|museum|bridge|port|harbou?r|bay|river|lake|mountain|mount|hill|island|district|ward|dam|prison|tower|park|market|club|fc)\b/
const TTL_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_CACHE_FILES = 300
const MAX_MEMORY = 100
const ENTITY_BATCH = 50
const COUNTRY_EVENTS = 30

/**
 * "Took place here" events that are rarely part of a place's history: sky
 * events and sports entries. Events stated for three or more countries
 * (pandemics, eclipses, world tours) are dropped too.
 */
const TRIVIAL_CLASSES = new Set([
  'Q3887', // solar eclipse
  'Q141022', // lunar eclipse
  'Q2141386', // total solar eclipse
  'Q1193699', // annular solar eclipse
  'Q26213387', // nation at sport event
  'Q16510064', // sporting event
  'Q27020041', // sports season
  'Q46190676', // tennis event
  'Q18536594', // Olympic sporting event
])

export type OldsServiceOptions = {
  cacheDir: string
  fetchImpl?: typeof fetch
  now?: () => number
  /** On-device translation into English, when a model is installed (headlines in other languages). */
  translateToEnglish?: (text: string, lang: string) => Promise<string | null>
  /**
   * On-device meaning similarity (Laya), when it is turned on: cosine scores of
   * each text against the query, or null when unavailable. English only.
   */
  meaning?: (query: string, texts: string[]) => Promise<number[] | null>
  /**
   * On-device unit vectors (Laya) for many texts at once, cached by text; null
   * when Laya is off. Used to match headlines to news items and to pick the
   * dated events that belong to a story. English only.
   */
  embed?: (texts: string[]) => Promise<Float32Array[] | null>
  /** Receives every scored candidate for a headline (quality checks only). */
  debug?: (headline: string, candidates: Array<{ label: string; description: string | null; score: number; kept: boolean; [detail: string]: unknown }>, searched?: { queries: string[]; titles: string[] }) => void
}

/** Laya similarity (cosine, all-MiniLM-L6-v2; calibrated 2026-10-27: related topics 0.45–0.65, the Delhi/Honduras mismatch 0.17): above this a topic matches by meaning alone; below the floor it is unrelated. */
export const MEANING_MATCH = 0.6
export const MEANING_FLOOR = 0.2
const MEANING_WEIGHT = 1.5

/**
 * Keep a search result when its words match, unless its meaning is clearly
 * unrelated (Laya vetoes). Meaning can rescue a near miss on words only when
 * the topic passed every other check (same country, right kind, not a
 * generic concept) and shares a word with the headline: Laya never overrides
 * the rules, it ranks and vetoes within them.
 */
export function keepCandidate(wordsMatch: boolean, meaning: number | null, rescuable = false, named = false): boolean {
  if (meaning === null) return wordsMatch
  // A place the headline names in full ("Dubai") is not vetoed: a place's description rarely reads like the story.
  if (wordsMatch) return named || meaning >= MEANING_FLOOR
  return rescuable && meaning >= MEANING_MATCH
}

export class OldsService {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly memory = new Map<string, OldsThread>()

  constructor(private readonly options: OldsServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.now = options.now ?? Date.now
  }

  async thread(query: OldsQuery): Promise<OldsThread> {
    const key = cacheKey(query)
    const cached = this.memory.get(key) ?? await this.readCache(key)
    if (cached && this.now() - Date.parse(cached.fetchedAt) < TTL_MS) {
      this.remember(key, cached)
      return cached
    }
    const lang = query.kind === 'wikipedia' ? query.lang ?? 'en' : 'en'
    const thread = query.kind === 'country'
      ? await this.countryThread(query.countryCode)
      : query.kind === 'headline'
        ? await this.headlineThread(query)
        : query.kind === 'chapter'
          ? await this.chapterThread(query.article, query.section)
        : await this.itemThread(query.kind === 'qid' ? query.qid : await this.resolveTitle(query.title, lang), lang)
    if (query.kind !== 'country' && query.kind !== 'chapter' && lang === 'en') await this.addHistoricalContext(thread)
    // A thread whose history article could not be fetched is shown but not kept, so the next open retries.
    if (!(thread as { partial?: boolean }).partial) {
      this.remember(key, thread)
      await this.writeCache(key, thread).catch(() => undefined)
    }
    return thread
  }

  private remember(key: string, thread: OldsThread): void {
    this.memory.delete(key)
    this.memory.set(key, thread)
    while (this.memory.size > MAX_MEMORY) this.memory.delete(this.memory.keys().next().value!)
  }

  // ---- Network -----------------------------------------------------------

  private async getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/sparql-results+json, application/json' },
          // A second try waits longer (large Wikidata entities can be slow under load).
          signal: AbortSignal.timeout(attempt === 0 ? timeoutMs : timeoutMs * 2),
        })
      } catch (error) {
        // A dropped connection ("fetch failed") or a timeout is retried once.
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        if (attempt === 0 && (error instanceof TypeError || timedOut)) {
          await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500))
          continue
        }
        throw error
      }
      if ((response.status === 429 || response.status === 503) && attempt < 4) {
        // Respect the server's retry-after (up to 20 s); otherwise back off 1, 2, 4, 8 s with jitter.
        const retryAfter = Number(response.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(20, retryAfter) * 1_000 : 1_000 * 2 ** attempt + Math.random() * 400
        await response.body?.cancel().catch(() => undefined)
        await new Promise((resolve) => setTimeout(resolve, wait))
        continue
      }
      if (!response.ok) throw new Error(`Wikidata responded ${response.status}.`)
      return response.json() as Promise<unknown>
    }
    throw new Error('Wikidata is rate limiting requests.')
  }

  private async resolveTitle(title: string, lang: string): Promise<string> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: title, redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString()) as { query?: { pages?: Array<{ pageprops?: { wikibase_item?: unknown } }> } }
    const qid = payload.query?.pages?.[0]?.pageprops?.wikibase_item
    if (!isQid(qid)) throw new Error('That article has no Wikidata item yet.')
    return qid
  }

  private async entities(ids: string[], lang: string): Promise<Map<string, WikidataEntity>> {
    const out = new Map<string, WikidataEntity>()
    const unique = [...new Set(ids.filter(isQid))]
    for (let i = 0; i < unique.length; i += ENTITY_BATCH) {
      const batch = unique.slice(i, i + ENTITY_BATCH)
      const url = new URL('https://www.wikidata.org/w/api.php')
      url.search = new URLSearchParams({
        action: 'wbgetentities',
        ids: batch.join('|'),
        props: 'labels|descriptions|claims|sitelinks',
        languages: lang === 'en' ? 'en' : `${lang}|en`,
        sitefilter: lang === 'en' ? 'enwiki' : `${lang}wiki|enwiki`,
        format: 'json',
      }).toString()
      const payload = await this.getJson(url.toString()) as { entities?: Record<string, WikidataEntity> }
      for (const [id, entity] of Object.entries(payload.entities ?? {})) {
        if (isQid(id) && entity && typeof entity === 'object') out.set(id, entity)
      }
    }
    return out
  }

  private async sparql(query: string, timeoutMs = TIMEOUT_MS): Promise<Array<Record<string, { value?: string }>>> {
    const url = new URL('https://query.wikidata.org/sparql')
    url.search = new URLSearchParams({ query, format: 'json' }).toString()
    const payload = await this.getJson(url.toString(), timeoutMs) as { results?: { bindings?: Array<Record<string, { value?: string }>> } }
    return Array.isArray(payload.results?.bindings) ? payload.results.bindings : []
  }

  // ---- Threads -----------------------------------------------------------

  private async itemThread(qid: string, lang: string): Promise<OldsThread> {
    const rootMap = await this.entities([qid], lang)
    const root = rootMap.get(qid)
    const rootNode = root ? nodeFromEntity(root, lang) : null
    if (!root || !rootNode) throw new Error('No Wikidata item found.')
    const drafts = edgesFromEntity(root)
    return this.assemble(rootNode, drafts, lang)
  }

  /** ISO code → current country item via Wikidata's search index (fast; no SPARQL). */
  private async countryQid(countryCode: string): Promise<string | null> {
    const url = new URL('https://www.wikidata.org/w/api.php')
    url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: `haswbstatement:P297=${countryCode}`, srlimit: '5', format: 'json' }).toString()
    const payload = await this.getJson(url.toString()) as { query?: { search?: Array<{ title?: string }> } }
    const candidates = (payload.query?.search ?? []).map((hit) => hit.title).filter(isQid)
    if (!candidates.length) return null
    // Prefer the item that has not ended (P576), e.g. Germany over West Germany.
    const entities = await this.entities(candidates, 'en')
    return candidates.find((id) => !(entities.get(id)?.claims?.['P576']?.length)) ?? candidates[0] ?? null
  }

  /** The history of the city or region a local outlet is based in, framed as the story's backdrop; null when unknown. */
  private async localFallback(query: Extract<OldsQuery, { kind: 'headline' }>, lang: string, unique: Array<{ id: string; node: OldsNode }>): Promise<OldsThread | null> {
    if (!query.place || !query.countryCode || query.topic) return null
    const placeQid = await this.localPlaceQid(query.place, query.geonameId, query.countryCode).catch(() => null)
    if (!placeQid) return null
    const local = await this.headlineThread({ ...query, topic: placeQid }).catch(() => null)
    if (!local?.context) return null
    const label = local.nodes.find((node) => node.id === local.rootId)?.label ?? query.place
    local.context.matchedBy = `Local fallback: no specific Wikipedia subject or event clearly matched this headline${lang !== 'en' ? ` in ${lang} Wikipedia; add this language under Languages so headlines can be translated on this Mac first` : ''}. It comes from an outlet in ${label}, so that place's history is shown.`
    local.context.candidates = unique.slice(0, 4).map((candidate) => ({ id: candidate.id, label: candidate.node.label, description: candidate.node.description }))
    return local
  }

  /** The Wikidata item for a city (by GeoNames id) or a region (by name, in its country); exact names first. */
  private async localPlaceQid(name: string, geonameId: string | undefined, countryCode: string): Promise<string | null> {
    const search = async (srsearch: string): Promise<string[]> => {
      const url = new URL('https://www.wikidata.org/w/api.php')
      url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch, srlimit: '5', format: 'json' }).toString()
      const payload = await this.getJson(url.toString(), 8_000) as { query?: { search?: Array<{ title?: string }> } }
      return (payload.query?.search ?? []).map((hit) => hit.title).filter(isQid)
    }
    const fold = (value: string): string => value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\d]+/gu, ' ').trim()
    // Only an item named this place with an English label (a GeoNames id is sometimes on a ward or station too).
    const named = async (hits: string[]): Promise<string | null> => {
      if (!hits.length) return null
      const entities = await this.entities(hits, 'en')
      return hits.find((id) => {
        const entity = entities.get(id)
        if (!entity?.labels?.['en']?.value) return false
        const names = Object.values(entity.labels).map((label) => label?.value).filter((value): value is string => !!value)
        // A longer name must only add a disambiguator ("Perm, Russia"), never make it a building or feature ("Ajloun Castle").
        return names.some((value) => fold(value) === fold(name)
          || (fold(value).startsWith(`${fold(name)} `) && !FACILITY.test(fold(value).slice(fold(name).length)))
          || fold(name).startsWith(`${fold(value)} `))
      }) ?? null
    }
    if (geonameId) {
      // The GeoNames id is the evidence: names may be spelled differently ("Kafr ash Shaykh" / "Kafr El Sheikh").
      // Still skip items without an English label and buildings or features named after the place.
      const hits = await search(`haswbstatement:P1566=${geonameId}`)
      const qid = await named(hits)
      if (qid) return qid
      const entities = hits.length ? await this.entities(hits, 'en') : new Map<string, WikidataEntity>()
      const byId = hits.find((id) => {
        const label = entities.get(id)?.labels?.['en']?.value
        return !!label && !FACILITY.test(fold(label))
      })
      if (byId) return byId
    }
    const countryQid = await this.countryQid(countryCode)
    if (!countryQid) return null
    return named(await search(`${name.replace(/["\\]/g, ' ')} haswbstatement:P17=${countryQid}`))
  }

  private async countryThread(countryCode: string): Promise<OldsThread> {
    const qid = await this.countryQid(countryCode)
    if (!qid) throw new Error('No Wikidata item for that country.')
    const rootMap = await this.entities([qid], 'en')
    const root = rootMap.get(qid)
    const rootNode = root ? nodeFromEntity(root, 'en') : null
    if (!root || !rootNode) throw new Error('No Wikidata item for that country.')
    // The country's own "significant event" and "history of topic" statements…
    const drafts = edgesFromEntity(root).filter((edge) => edge.property === 'P793' || edge.property === 'P2184')
    // …the eras and events its "History of …" item lists as parts (statements on that item)…
    const historyIds = drafts.filter((edge) => edge.property === 'P2184').map((edge) => edge.to)
    if (historyIds.length) {
      const histories = await this.entities(historyIds, 'en').catch(() => new Map<string, WikidataEntity>())
      for (const history of histories.values()) {
        for (const draft of edgesFromEntity(history)) {
          if (draft.property !== 'P793' && draft.property !== 'P361') continue
          drafts.push({ ...draft, from: qid, to: draft.to, type: 'significant_event', propertyLabel: `${draft.propertyLabel} (on its history item)` })
        }
        for (const statement of (history.claims?.['P527'] ?? []).slice(0, 30)) {
          const target = (statement as { mainsnak?: { datavalue?: { value?: { id?: string } } } }).mainsnak?.datavalue?.value?.id
          if (!isQid(target) || target === qid) continue
          drafts.push({ from: qid, to: target, type: 'significant_event', epistemic: 'source-stated', property: 'P527', propertyLabel: 'has part (on its history item)', statementUrl: `https://www.wikidata.org/wiki/${history.id}#P527`, citationDrafts: [], referenceCount: 0 })
        }
      }
    }
    // …plus well-documented dated events whose "country" statement is this country.
    // Optional and time-boxed: this query can be slow for large countries.
    const rows = await this.sparql(`SELECT ?event ?links WHERE {
      ?event wdt:P17 wd:${qid} ; wdt:P585 ?date ; wikibase:sitelinks ?links .
      FILTER(?links >= 15)
    } ORDER BY DESC(?links) LIMIT ${COUNTRY_EVENTS}`, 8_000).catch(() => [])
    const known = new Set(drafts.map((edge) => edge.to))
    for (const row of rows) {
      const event = qidFromUri(row['event']?.value)
      if (!event || known.has(event) || event === qid) continue
      known.add(event)
      drafts.push({
        from: event,
        to: qid,
        type: 'located_at',
        epistemic: 'source-stated',
        property: 'P17',
        propertyLabel: 'country',
        statementUrl: `https://www.wikidata.org/wiki/${event}#P17`,
        citationDrafts: [],
        referenceCount: 0,
      })
    }
    let historyFailed = false
    const history = await this.historyChapters(root, rootNode, historyIds).catch((error: unknown) => {
      if (error instanceof HistoryUnavailable) historyFailed = true
      return null
    })
    if (history) {
      // The chapters stand in for the bare "History of …" item.
      for (let i = drafts.length - 1; i >= 0; i -= 1) if (drafts[i]!.property === 'P2184') drafts.splice(i, 1)
      const mains = await this.titlesToQids(history.chapters.flatMap((chapter) => (chapter.mainArticle ? [chapter.mainArticle.title] : [])), 'en').catch(() => new Map<string, string>())
      // When several chapters share a main article, the one it is named after wins (e.g. "World War II").
      const named = (chapter: OldsChapter): number => (chapter.mainArticle && chapter.mainArticle.title.toLowerCase().includes(chapter.title.toLowerCase()) ? 0 : 1)
      for (const chapter of [...history.chapters].sort((a, b) => named(a) - named(b))) {
        const target = chapter.mainArticle ? mains.get(chapter.mainArticle.title) : undefined
        if (!target || target === qid || known.has(target)) continue
        known.add(target)
        drafts.unshift({
          from: qid,
          to: target,
          type: 'significant_event',
          epistemic: 'source-stated',
          property: 'wikipedia-section',
          propertyLabel: `main article for “${chapter.title}” in ${history.source.title} (Wikipedia)`,
          statementUrl: chapter.url,
          citationDrafts: [],
          referenceCount: 0,
        })
      }
    }
    const facts = await this.countryFacts(root).catch(() => null)
    const assembled = await this.assemble(rootNode, drafts, 'en')
    const thread = { ...(facts ? { ...assembled, facts } : assembled), ...(historyFailed ? { partial: true } : {}) }
    if (!history) return thread
    // A chapter's main article with no date of its own takes the chapter's span (marked c.).
    const chapterByTarget = new Map<string, OldsChapter>()
    for (const edge of thread.edges) {
      if (edge.property !== 'wikipedia-section') continue
      const chapter = history.chapters.find((item) => item.url === edge.statementUrl)
      if (chapter) chapterByTarget.set(edge.to, chapter)
    }
    const nodes = thread.nodes.map((node) => {
      const chapter = chapterByTarget.get(node.id)
      return chapter && !node.start && chapter.start ? { ...node, start: chapter.start, end: node.end ?? chapter.end } : node
    })
    return { ...thread, nodes, chapters: history.chapters, chaptersSource: history.source }
  }

  /** Population, economy, capital, leaders, languages and currency: Wikidata's current (latest or preferred) values. */
  private async countryFacts(root: WikidataEntity): Promise<OldsCountryFacts> {
    type Claim = { rank?: string; mainsnak?: { datavalue?: { value?: unknown } }; qualifiers?: Record<string, Array<{ datavalue?: { value?: { time?: string } } }>> }
    const claims = (property: string): Claim[] => ((root.claims?.[property] ?? []) as Claim[]).filter((claim) => claim.rank !== 'deprecated')
    const time = (claim: Claim): string => claim.qualifiers?.['P585']?.[0]?.datavalue?.value?.time ?? ''
    const latestAmount = (property: string, unit?: string): { value: number; year: string | null } | null => {
      const usable = claims(property).filter((claim) => !unit || (claim.mainsnak?.datavalue?.value as { unit?: string } | undefined)?.unit?.endsWith(`/${unit}`))
      const best = [...usable].sort((a, b) => (b.rank === 'preferred' ? 1 : 0) - (a.rank === 'preferred' ? 1 : 0) || time(b).localeCompare(time(a)))[0]
      const amount = Number((best?.mainsnak?.datavalue?.value as { amount?: string } | undefined)?.amount)
      if (!best || !Number.isFinite(amount)) return null
      return { value: amount, year: time(best).match(/^\+?(\d{4})/)?.[1] ?? null }
    }
    // Current items: not ended (no P582 end time), preferred first.
    const current = (property: string, limit = 1): string[] => claims(property)
      .filter((claim) => !claim.qualifiers?.['P582'])
      .sort((a, b) => (b.rank === 'preferred' ? 1 : 0) - (a.rank === 'preferred' ? 1 : 0))
      .map((claim) => (claim.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id)
      .filter((id): id is string => isQid(id))
      .slice(0, limit)
    const ids = { capital: current('P36'), state: current('P35'), government: current('P6'), languages: current('P37', 3), currency: current('P38') }
    const labels = await this.entities([...ids.capital, ...ids.state, ...ids.government, ...ids.languages, ...ids.currency], 'en')
    const label = (id: string | undefined): string | null => (id ? nodeFromEntity(labels.get(id) ?? {}, 'en')?.label ?? null : null)
    const inception = nodeFromEntity(root, 'en')?.start ?? null
    return {
      population: latestAmount('P1082'),
      gdpUsd: latestAmount('P2131', 'Q4917'),
      capital: label(ids.capital[0]),
      headOfState: label(ids.state[0]),
      headOfGovernment: label(ids.government[0]),
      languages: ids.languages.map((id) => label(id)).filter((name): name is string => !!name),
      currency: label(ids.currency[0]),
      inception,
    }
  }

  /** Chapters from the place's Wikipedia history article (its "history of topic" item, or "History of <name>"). */
  private async historyChapters(root: WikidataEntity, rootNode: OldsNode, historyIds: string[]): Promise<{ chapters: OldsChapter[]; source: { title: string; url: string } } | null> {
    const titles: string[] = []
    if (historyIds.length) {
      const histories = await this.entities(historyIds, 'en').catch(() => new Map<string, WikidataEntity>())
      for (const history of histories.values()) {
        const title = (history.sitelinks as Record<string, { title?: string }> | undefined)?.['enwiki']?.title
        if (title) titles.push(title)
      }
    }
    const name = (root.sitelinks as Record<string, { title?: string }> | undefined)?.['enwiki']?.title ?? rootNode.label
    // Many articles are "History of the …" (the United States, the Cayman Islands, the Philippines).
    titles.push(`History of ${name}`, `History of ${rootNode.label}`, `History of the ${name}`)
    for (const title of [...new Set(titles)]) {
      const url = new URL('https://en.wikipedia.org/w/api.php')
      url.search = new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext', redirects: '1', format: 'json', formatversion: '2' }).toString()
      let payload: { parse?: { title?: string; wikitext?: string }; error?: { code?: string } } | null
      try {
        payload = await this.getJson(url.toString(), 15_000) as { parse?: { title?: string; wikitext?: string }; error?: { code?: string } }
      } catch (error) {
        // A network or rate-limit failure is not "no article": let the caller avoid caching a thread without chapters.
        throw new HistoryUnavailable(error instanceof Error ? error.message : 'History article request failed.')
      }
      const wikitext = payload?.parse?.wikitext
      const resolved = payload?.parse?.title ?? title
      if (typeof wikitext !== 'string' || wikitext.length < 2_000) continue
      // "History of X" sometimes redirects to the country's main article; its Economy/Media sections are not history.
      if (!/^history\b/i.test(resolved)) continue
      const chapters = chaptersFromWikitext(resolved, wikitext, new Date(this.now()).getUTCFullYear())
      if (chapters.length >= 2) return { chapters, source: { title: resolved, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(resolved.replace(/ /g, '_'))}` } }
    }
    return null
  }

  /**
   * A chapter's key events: the dated topics its section of the Wikipedia
   * history article links to (and its subsections). Each link is attributed
   * to that section; undated people and concepts are left out.
   */
  private async chapterThread(article: string, section: string): Promise<OldsThread> {
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.search = new URLSearchParams({ action: 'parse', page: article, prop: 'wikitext', redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString(), 10_000) as { parse?: { title?: string; wikitext?: string } }
    const wikitext = payload.parse?.wikitext
    if (typeof wikitext !== 'string') throw new Error('That history article could not be read.')
    const body = sectionWithSubsections(wikitext, section)
    if (body === null) throw new Error('That chapter was not found in the article.')
    const links = articleLinks(body, 60)
    const qids = await this.titlesToQids(links, 'en')
    const rootQid = await this.resolveTitle(article, 'en')
    const rootEntity = (await this.entities([rootQid], 'en')).get(rootQid)
    const rootNode = rootEntity ? nodeFromEntity(rootEntity, 'en') : null
    if (!rootNode) throw new Error('No Wikidata item for that history article.')
    const statementUrl = sectionUrl(article, section)
    const drafts: DraftEdge[] = [...new Set(qids.values())].filter((qid) => qid !== rootQid).map((qid) => ({
      from: rootQid,
      to: qid,
      type: 'significant_event',
      epistemic: 'source-stated',
      property: 'wikipedia-link',
      propertyLabel: `linked in the chapter “${section}” of ${article} (Wikipedia)`,
      statementUrl,
      citationDrafts: [],
      referenceCount: 0,
      supportLevel: 'article',
    }))
    const thread = await this.assemble(rootNode, drafts, 'en')
    // Key events only: things that happened (a point in time or a start time), not cities, publishers or
    // organisations that merely have a founding date, and not calendar units or whole states.
    const keep = new Set([rootNode.id, ...thread.nodes.filter((node) => node.start).map((node) => node.id)])
    const notTopics = new Set<string>()
    const lookups = await this.entities([...keep].filter((id) => id !== rootNode.id), 'en').catch(() => new Map<string, WikidataEntity>())
    for (const [id, entity] of lookups) {
      const classes = ((entity.claims?.['P31'] ?? []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>).map((claim) => claim.mainsnak?.datavalue?.value?.id)
      if (!isEventLike(entity) || classes.some((value) => value && NOT_A_TOPIC.has(value))) notTopics.add(id)
    }
    const nodes = thread.nodes.filter((node) => keep.has(node.id) && !notTopics.has(node.id))
    const ids = new Set(nodes.map((node) => node.id))
    return { ...thread, nodes, edges: thread.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) }
  }

  private async titlesToQids(titles: string[], lang: string): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const unique = [...new Set(titles)].slice(0, 80)
    for (let i = 0; i < unique.length; i += 40) {
      const batch = unique.slice(i, i + 40)
      const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
      url.search = new URLSearchParams({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: batch.join('|'), redirects: '1', format: 'json', formatversion: '2' }).toString()
      const payload = await this.getJson(url.toString()) as { query?: { pages?: Array<{ title?: string; pageprops?: { wikibase_item?: unknown } }>; redirects?: Array<{ from?: string; to?: string }>; normalized?: Array<{ from?: string; to?: string }> } }
      const byTitle = new Map<string, string>()
      for (const page of payload.query?.pages ?? []) {
        const qid = page.pageprops?.wikibase_item
        if (page.title && isQid(qid)) byTitle.set(page.title, qid)
      }
      const alias = new Map<string, string>()
      for (const step of [...(payload.query?.normalized ?? []), ...(payload.query?.redirects ?? [])]) if (step.from && step.to) alias.set(step.from, step.to)
      for (const title of batch) {
        let current = title
        for (let hop = 0; hop < 3 && alias.has(current); hop += 1) current = alias.get(current)!
        const qid = byTitle.get(current)
        if (qid) out.set(title, qid)
      }
    }
    return out
  }

  private async assemble(rootNode: OldsNode, drafts: DraftEdge[], lang: string): Promise<OldsThread> {
    const others = (edge: DraftEdge): string => (edge.from === rootNode.id ? edge.to : edge.from)
    // Keep at most nodes-1 neighbours, preferring causal/sourced relations.
    const priority: Record<string, number> = { contributed_to: 0, influenced: 1, disputed_link: 1, preceded_by: 2, followed_by: 2, significant_event: 3, part_of: 4, located_at: 5 }
    const ranked = [...drafts].sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9))
    const neighbourIds: string[] = []
    for (const edge of ranked) {
      const id = others(edge)
      if (!neighbourIds.includes(id) && neighbourIds.length < OLDS_LIMITS.nodes - 1) neighbourIds.push(id)
    }
    const kept = ranked.filter((edge) => neighbourIds.includes(others(edge)))
    const lookups = await this.entities([...neighbourIds, ...statedInIds(kept)], lang)
    const nodes = new Map<string, OldsNode>([[rootNode.id, rootNode]])
    const onlyByCountry = new Set(kept.filter((edge) => edge.property === 'P17' && edge.type === 'located_at').map(others))
    for (const edge of kept) if (edge.property !== 'P17') onlyByCountry.delete(others(edge))
    for (const id of neighbourIds) {
      const entity = lookups.get(id)
      if (entity && onlyByCountry.has(id) && isTrivialHere(entity)) continue
      const node = entity ? nodeFromEntity(entity, lang) : null
      if (node) nodes.set(id, node)
    }
    const statedIn = new Map<string, OldsNode>()
    for (const [id, entity] of lookups) {
      const node = nodeFromEntity(entity, lang)
      if (node) statedIn.set(id, node)
    }
    // Source check: is the other side also named in the root's Wikipedia article?
    const rootTitle = titleFromWikipediaUrl(rootNode.wikipediaUrl)
    const rootText = rootTitle ? await this.articleText(rootTitle, lang).catch(() => '') : ''
    const edges: OldsEdge[] = kept
      .filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
      .map(({ citationDrafts, supportLevel, ...edge }) => {
        const other = nodes.get(edge.from === rootNode.id ? edge.to : edge.from)!
        const level = edge.property.startsWith('wikipedia-') ? 'article' : supportLevel ?? 'unreferenced'
        const support: OldsSupport = level === 'article'
          ? { level, corroborated: true, checkedIn: null }
          : { level, corroborated: rootText ? mentions(rootText, other.label, rootNode.label) : null, checkedIn: rootText ? rootTitle : null }
        return { ...edge, citations: resolveCitations(citationDrafts, statedIn), support }
      })
    // Competing, attributed readings from the article's historiography/debate sections (English only for now).
    const interpretations = rootTitle && lang === 'en' && rootNode.wikipediaUrl
      ? interpretationsFrom(await this.articleSections(rootTitle, lang).catch(() => ''), { title: rootTitle, url: rootNode.wikipediaUrl })
      : []
    // "How we got here": dated sentences from the topic's own article, in time order.
    const chronicle = rootTitle ? await this.chronicle(rootTitle, lang).catch(() => []) : []
    // Wikidata has no date for some topics (e.g. a trial); use the article's first dated event.
    // A broad place (region, country) gets no date from one event in its long history.
    const rootIsBroad = /\b(region|country|continent|province|subcontinent|territory|sovereign state|city)\b/i.test(rootNode.description ?? '')
    if (!rootNode.start && chronicle[0] && !rootIsBroad) {
      rootNode.start = chronicle[0].at
      nodes.set(rootNode.id, rootNode)
    }
    return {
      rootId: rootNode.id,
      nodes: [...nodes.values()],
      edges,
      ...(interpretations.length ? { interpretations } : {}),
      ...(chronicle.length ? { chronicle } : {}),
      fetchedAt: new Date(this.now()).toISOString(),
      attribution: OLDS_ATTRIBUTION,
      note: OLDS_NOTE,
    }
  }

  /** Plain text of a Wikipedia article (for source checks). Cached in memory. */
  private readonly texts = new Map<string, string>()
  private async articleText(title: string, lang: string): Promise<string> {
    const key = `${lang}|${title}`
    const hit = this.texts.get(key)
    if (hit !== undefined) return hit
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'plain', titles: title, redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString(), 10_000) as { query?: { pages?: Array<{ extract?: unknown }> } }
    const extract = payload.query?.pages?.[0]?.extract
    const text = typeof extract === 'string' ? extract.slice(0, 400_000) : ''
    this.texts.set(key, text)
    while (this.texts.size > 60) this.texts.delete(this.texts.keys().next().value!)
    return text
  }

  /**
   * Subject topics behind a headline in its country, checked to exist on
   * Wikipedia, ranked by meaning (Laya) when available, each with up to two
   * recent sentences that carry figures.
   */
  private async relatedTopics(text: string, country: string | null, exclude: string[], meaningOk: boolean, countryCode?: string): Promise<OldsRelatedTopic[]> {
    // Provinces and states the headline names (B.C., New Brunswick), for topics at the story's own level.
    const regions = countryCode ? placesNamedIn(`${text} ${exclude.join(' ')}`, 6).filter((place) => place.kind === 'region' && place.countryCode === countryCode).map((place) => place.name) : []
    const others = otherCountries(text, country, namedCountryNames(text), this.peopleCountries.get(text) ?? [])
    const { titles, searches, stems } = relatedQueries(text, country, exclude, regions, others)
    const searched: string[] = []
    // Two subject words in common ("half-time show" ≠ "Half dollar (United States coin)").
    const sharesSubject = (title: string): boolean => new Set(title.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 4).flatMap((word) => stems.filter((stem) => word.startsWith(stem) || stem.startsWith(word.slice(0, 5))))).size >= Math.min(2, stems.length)
    for (const query of searches) {
      for (const title of await this.search('en', query, 5).catch(() => [])) {
        // Keep subject articles about this country (or general concepts), not people, places or lists of episodes.
        if (country && !title.includes(country) && !title.includes(country.replace(/a$/, 'ian')) && !regions.some((region) => title.includes(region))) continue
        if (/^List of .*(episodes|people|songs|albums)/i.test(title)) continue
        // A specific past event from search ("1904 … election") is noise; recent ones may be the story itself.
        const leadingYear = Number(title.match(/^(\d{4})\b/)?.[1] ?? NaN)
        if (Number.isFinite(leadingYear) && leadingYear < new Date(this.now()).getUTCFullYear() - 2) continue
        // A search hit must share a subject word with the headline (hospital ↔ "Health care" comes from the families instead).
        if (!sharesSubject(title)) continue
        // …and bring no names the story never mentions ("Pope Pius XII and Russia" for a story about today's pope).
        if (foreignNamesIn(title, `${text} ${country ?? ''} ${regions.join(' ')}`) > 0) continue
        searched.push(title)
      }
    }
    const wanted = [...new Set([...titles, ...searched])].filter((title) => !exclude.some((item) => item.toLowerCase() === title.toLowerCase())).slice(0, 20)
    // Without a country, free-text searches are too loose to trust; use the subject families only.
    if (!country) wanted.splice(0, wanted.length, ...wanted.filter((title) => titles.includes(title)))
    if (!wanted.length) return []
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.search = new URLSearchParams({ action: 'query', prop: 'description|pageprops', ppprop: 'disambiguation', titles: wanted.join('|'), redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString(), 10_000).catch(() => null) as { query?: { pages?: Array<{ title?: string; missing?: boolean; description?: string; pageprops?: { disambiguation?: string } }>; redirects?: Array<{ from: string; to: string }> } } | null
    // Films, albums, books and other works share titles with real topics ("The Verdict"); never offer them.
    const CREATIVE = /\b(film|movie|album|song|single|novel|book|television|tv series|sitcom|episode|video game|band|musical|play by|opera|painting|comic)\b/i
    // Redirects can land on the topic itself ("Belize ICJ" → "Belize"): drop those after resolving them.
    const pages = (payload?.query?.pages ?? []).filter((page) => page.title && !page.missing && !page.pageprops?.disambiguation && !CREATIVE.test(page.description ?? '')
      && !exclude.some((item) => item.toLowerCase() === page.title!.toLowerCase()))
    const redirects = new Map((payload?.query?.redirects ?? []).map((item) => [item.from, item.to]))
    const order = (title: string): number => {
      const index = wanted.findIndex((item) => (redirects.get(item) ?? item) === title)
      return index === -1 ? 99 : index
    }
    let ranked = [...new Map(pages.map((page) => [page.title!, page])).values()].sort((a, b) => order(a.title!) - order(b.title!))
    if (meaningOk && ranked.length > 1) {
      const scores = await this.meaningOf(cleanHeadline(text), ranked.map((page) => `${page.title}. ${page.description ?? ''}`))
      if (scores && scores.length === ranked.length) {
        ranked = ranked.map((page, index) => ({ page, score: scores[index]! - order(page.title!) * 0.01 }))
          .filter((item) => item.score >= 0.18)
          .sort((a, b) => b.score - a.score)
          .map((item) => item.page)
      }
    }
    const year = new Date(this.now()).getUTCFullYear()
    const out: OldsRelatedTopic[] = []
    for (const page of ranked.slice(0, 4)) {
      const body = await this.articleText(page.title!, 'en').catch(() => '')
      const sentences = withoutCitations(body.replace(/\n+/g, ' ')).split(/(?<=[.!?])\s+(?=[A-Z])/)
        .filter((sentence) => sentence.length >= 50 && sentence.length <= 280 && figuresIn(sentence).some((figure) => figure.unit !== 'count' || figure.value >= 1000))
        .map((sentence) => ({ sentence, recent: Math.max(0, ...[...sentence.matchAll(/\b(19[5-9]\d|20\d\d)\b/g)].map((match) => Number(match[1]))) }))
        .sort((a, b) => (b.recent >= year - 20 ? b.recent : 0) - (a.recent >= year - 20 ? a.recent : 0))
      out.push({
        title: page.title!,
        description: page.description ?? null,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title!.replace(/ /g, '_'))}`,
        figures: [...new Set(sentences.map((item) => item.sentence.trim()))].slice(0, 2),
      })
    }
    return out
  }

  /** Dated events from an article's wikitext (cached with the thread). */
  /** Cosine similarity of each text to the query, on this Mac (Laya), or null when Laya is off. */
  private async meaningOf(query: string, texts: string[]): Promise<number[] | null> {
    if (!texts.length) return null
    if (this.options.embed) {
      const vectors = await this.options.embed([query, ...texts]).catch(() => null)
      if (vectors && vectors.length === texts.length + 1) {
        const [q, ...rest] = vectors as [Float32Array, ...Float32Array[]]
        return rest.map((vector) => { let sum = 0; for (let i = 0; i < vector.length; i += 1) sum += vector[i]! * q[i]!; return sum })
      }
    }
    return this.options.meaning ? this.options.meaning(query, texts).catch(() => null) : null
  }

  /**
   * The dated events in an article that belong to this story: with Laya, the
   * ones closest in meaning to the headline (any wording, any topic); without
   * it, the ones that use the headline's subject words.
   */
  private async chronicleAbout(title: string, headline: string, focus: string[], options: { yearHint?: number; keep?: number; floor?: number } = {}): Promise<OldsChronicleEntry[]> {
    if (this.options.embed || this.options.meaning) {
      const every = await this.chronicle(title, 'en', [], options.yearHint, 160).catch(() => [])
      // A shortlist for Laya (~0.1 s per sentence): sentences with the headline's words, then the most recent.
      const stems = [...new Set([...focus, ...subjectTerms(headline).flatMap((term) => term.split(' ')).map((word) => word.slice(0, 5))])]
      const withWords = every.filter((entry) => stems.some((stem) => entry.text.toLowerCase().includes(stem)))
      const all = [...new Set([...withWords, ...every.slice(-12)])].slice(-30)
      const scores = all.length ? await this.meaningOf(cleanHeadline(headline), all.map((entry) => entry.text)) : null
      if (scores) {
        return all
          .map((entry, index) => ({ entry, score: scores[index]! }))
          .filter((item) => item.score >= (options.floor ?? CHRONICLE_MEANING_FLOOR))
          .sort((a, b) => b.score - a.score)
          .slice(0, options.keep ?? 12)
          .map((item) => item.entry)
          .sort((a, b) => a.at.iso.localeCompare(b.at.iso))
      }
    }
    return focus.length ? this.chronicle(title, 'en', focus, options.yearHint).catch(() => []) : []
  }

  /** The other country in a two-country story: one the headline names, or the citizenship of a person it names in full. */
  private async relationsBackdrop(headline: string, countryCode: string, namedCountries: string[]): Promise<{ title: string; entries: OldsChronicleEntry[] } | null> {
    const home = countryPlace(countryCode)?.name
    if (!home) return null
    const others = namedCountries.filter((code) => code !== countryCode).map((code) => countryPlace(code)?.name).filter((name): name is string => !!name)
    if (!others.length) {
      // People named in full ("Donald Trump"): their country of citizenship (Wikidata P27).
      // A name can run into the next capitalised word ("Donald Trump Chinamaxxing"): try its two-word ends as well.
      const people = [...new Set(properPhrases(cleanHeadline(headline)).flatMap((phrase) => {
        const words = phrase.split(/\s+/)
        return words.length >= 3 ? [words.slice(0, 2).join(' '), words.slice(-2).join(' ')] : [phrase]
      }))].filter((phrase) => phrase.split(/\s+/).length >= 2 && !headlineCountries(phrase).length && !capitalCountries(phrase).length).slice(0, 3)
      for (const person of people) {
        const title = (await this.search('en', person, 1).catch(() => [] as string[]))[0]
        if (!title || !fullPersonNameMentioned(title, person)) continue
        const qid = (await this.titleItems('en', [title]).catch(() => new Map<string, { qid: string; disambiguation: boolean }>())).get(title)?.qid
        const entity = qid ? (await this.entities([qid], 'en').catch(() => new Map<string, WikidataEntity>())).get(qid) : undefined
        const claims = (entity?.claims?.['P31'] ?? []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>
        if (!claims.some((claim) => claim.mainsnak?.datavalue?.value?.id === 'Q5')) continue
        const citizenship = ((entity?.claims?.['P27'] ?? []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>)[0]?.mainsnak?.datavalue?.value?.id
        const code = citizenship ? await this.isoCode(citizenship).catch(() => null) : null
        const name = code && code !== countryCode ? countryPlace(code)?.name : null
        if (name) { others.push(name); break }
      }
    }
    for (const other of others.slice(0, 1)) {
      // Wikipedia names these alphabetically ("China–United States relations"); try both orders.
      for (const title of [`${[home, other].sort().join('–')} relations`, `${[home, other].sort().reverse().join('–')} relations`]) {
        // Sentences whose subject is a bare pronoun ("In 2022, they conducted…") need their paragraph to make sense.
        const every = (await this.chronicle(title, 'en', [], undefined, 160).catch(() => [] as OldsChronicleEntry[]))
          .filter((entry) => !/^(?:(?:in|on|by|from|after|during|since)\b[^,]{0,40},\s*)?(?:he|she|they|it|his|her|their|this|these|those)\b/i.test(entry.text))
        if (every.length < 4) continue
        // A spread across the whole relationship, not only the latest years.
        const picks = every.length <= 10 ? every : Array.from({ length: 10 }, (_, index) => every[Math.round((index * (every.length - 1)) / 9)]!)
        return { title, entries: [...new Set(picks)].map((entry) => ({ ...entry, sourceTitle: title })) }
      }
    }
    return null
  }

  private async chronicle(title: string, lang: string, focus: string[] = [], yearHint?: number, limit = 18): Promise<OldsChronicleEntry[]> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext', redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString(), 12_000) as { parse?: { title?: string; wikitext?: string } }
    const wikitext = payload.parse?.wikitext
    if (typeof wikitext !== 'string') return []
    return chronologyFromWikitext(payload.parse?.title ?? title, wikitext, new Date(this.now()).getUTCFullYear(), lang, limit, focus, yearHint)
  }

  /** Expand a historically sparse narrative through the article's explicit subject
   * pointers. A country's founding node alone is not historical context. */
  private async addHistoricalContext(thread: OldsThread): Promise<void> {
    const currentYear = new Date(this.now()).getUTCFullYear()
    const existing = thread.chronicle ?? []
    const olderYears = new Set(existing.filter((entry) => Number(entry.at.iso.slice(0, 4)) < currentYear - 5).map((entry) => entry.at.iso.slice(0, 4)))
    if (olderYears.size >= 3) return
    const root = thread.nodes.find((node) => node.id === thread.rootId)
    const title = titleFromWikipediaUrl(root?.wikipediaUrl ?? null)
    if (!title) return
    const limitedNote = 'Historical coverage is limited. These selected dated passages are not a full account of the history behind this story; a place’s founding date alone does not supply that context.'
    // Country/place fallbacks were deliberately filtered to the headline's subject.
    // Do not refill them with unrelated centuries of the place's general history.
    if (thread.facts || thread.chapters || /\b(country|sovereign state|city|town|village|territory|island nation)\b/i.test(root?.description ?? '')) {
      thread.historyNote = limitedNote
      return
    }
    const country = thread.context?.path.find((step) => /country|sovereign state/i.test(step.node.description ?? ''))?.node.label
      ?? thread.nodes.find((node) => node.id !== thread.rootId && /^(?:sovereign state|country)\b/i.test(node.description ?? ''))?.label
    let added: OldsChronicleEntry[] = []
    try {
      const url = new URL('https://en.wikipedia.org/w/api.php')
      url.search = new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext', redirects: '1', format: 'json', formatversion: '2' }).toString()
      const payload = await this.getJson(url.toString(), 12_000) as { parse?: { wikitext?: string } }
      const rootWikitext = payload.parse?.wikitext ?? ''
      const sources = historicalArticles(title, rootWikitext, country)
      const candidates: OldsChronicleEntry[] = []
      // A current edition often links its own previous editions directly,
      // even when it has no separate history article to point us toward.
      // Accept only exact same-series titles and keep the existing three-page
      // fetch bound.
      const directEditions = linkedHistoricalSeriesEditions(title, rootWikitext, currentYear)
      const recentBridge = directEditions.filter((edition) => Number(edition.slice(0, 4)) >= currentYear - 5).at(-1)
      const series = new Set(historicalSeriesArticles(title, rootWikitext, currentYear))
      for (const sourceTitle of sources) {
        try {
          url.searchParams.set('page', sourceTitle)
          const background = await this.getJson(url.toString(), 12_000) as { parse?: { title?: string; wikitext?: string } }
          const body = background.parse?.wikitext ?? ''
          const resolved = background.parse?.title ?? sourceTitle
          candidates.push(...chronologyFromWikitext(resolved, body, currentYear, 'en', 80).map((entry) => ({ ...entry, sourceTitle: resolved })))
          for (const target of historicalSeriesArticles(title, body, currentYear)) series.add(target)
        } catch { thread.partial = true }
      }
      let bridgePages = 0
      // A current event page may link only its immediately previous edition,
      // which is too recent to show as historical context. Read that edition
      // as a bounded index of older editions, but never show its recent prose.
      if (recentBridge && series.size < 3) {
        bridgePages = 1 // The lookup consumes one of the three edition-page slots even if it fails.
        try {
          url.searchParams.set('page', recentBridge)
          const bridge = await this.getJson(url.toString(), 12_000) as { parse?: { wikitext?: string } }
          for (const target of historicalSeriesArticles(title, bridge.parse?.wikitext ?? '', currentYear)) series.add(target)
        } catch { thread.partial = true }
      }
      for (const sourceTitle of [...series].slice(0, Math.max(0, 3 - bridgePages))) {
        try {
          const year = sourceTitle.slice(0, 4)
          candidates.push(...(await this.chronicle(sourceTitle, 'en', [], undefined, 80))
            .filter((entry) => entry.at.iso.startsWith(year) && /^(Introduction|Results|Aftermath|Government formation)$/i.test(entry.section))
            .map((entry) => ({ ...entry, sourceTitle })))
        } catch { thread.partial = true }
      }
      added = olderContext(existing, candidates, currentYear)
    } catch { thread.partial = true }
    if (added.length) {
      thread.chronicle = [...added, ...existing].sort((a, b) => a.at.iso.localeCompare(b.at.iso))
      thread.historyNote = 'Earlier context comes from linked subject articles and earlier events in the same series. These are selected passages, not a complete history or a claim about what caused this story.'
    } else {
      thread.historyNote = limitedNote
    }
  }

  /** Article text with "== Section ==" markers (for interpretations). */
  private async articleSections(title: string, lang: string): Promise<string> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki', titles: title, redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString(), 10_000) as { query?: { pages?: Array<{ extract?: unknown }> } }
    const extract = payload.query?.pages?.[0]?.extract
    return typeof extract === 'string' ? extract.slice(0, 400_000) : ''
  }

  private async search(lang: string, query: string, limit: number): Promise<string[]> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), srnamespace: '0', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString(), 8_000) as { query?: { search?: Array<{ title?: unknown }> } }
    return (payload.query?.search ?? []).map((hit) => hit.title).filter((title): title is string => typeof title === 'string')
  }

  /** Titles → Wikidata ids on one wiki, noting disambiguation pages. */
  private async titleItems(lang: string, titles: string[], articleOnly?: Map<string, string | null>): Promise<Map<string, { qid: string; disambiguation: boolean }>> {
    const out = new Map<string, { qid: string; disambiguation: boolean }>()
    if (!titles.length) return out
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'query', prop: articleOnly ? 'pageprops|description' : 'pageprops', ppprop: 'wikibase_item|disambiguation', titles: titles.slice(0, 50).join('|'), redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString()) as { query?: { pages?: Array<{ title?: string; missing?: boolean; description?: string; pageprops?: { wikibase_item?: unknown; disambiguation?: unknown } }>; redirects?: Array<{ from: string; to: string }>; normalized?: Array<{ from: string; to: string }> } }
    // Titles asked for under another name (a redirect, or different case) map to the same item.
    const aliases = new Map<string, string[]>()
    for (const step of [...(payload.query?.normalized ?? []), ...(payload.query?.redirects ?? [])]) {
      const list = aliases.get(step.to) ?? []
      list.push(step.from, ...(aliases.get(step.from) ?? []))
      aliases.set(step.to, list)
    }
    for (const page of payload.query?.pages ?? []) {
      const qid = page.pageprops?.wikibase_item
      if (page.title && isQid(qid)) {
        const entry = { qid, disambiguation: page.pageprops?.disambiguation !== undefined }
        out.set(page.title, entry)
        for (const alias of aliases.get(page.title) ?? []) out.set(alias, entry)
      }
      // Articles too new to have a Wikidata item yet ("Cyclone Arnab").
      else if (articleOnly && page.title && !page.missing && page.pageprops?.disambiguation === undefined) articleOnly.set(page.title, page.description ?? null)
    }
    return out
  }

  /**
   * A news headline → the Wikipedia topic it is most likely about → that
   * topic's thread, plus the sourced path back through history and the
   * chapter of the country's history it belongs to.
   */
  private async headlineThread(query: Extract<OldsQuery, { kind: 'headline' }>): Promise<OldsThread> {
    // Search English Wikipedia: translate the headline on this device first when we can.
    let text = query.text
    // A headline with no language given may still not be English: tell common languages by their function words.
    let lang = query.lang && query.lang !== 'en' ? query.lang : guessLanguage(query.text) ?? 'en'
    let translated = false
    if (lang !== 'en' && this.options.translateToEnglish) {
      const english = await this.options.translateToEnglish(query.text, lang).catch(() => null)
      if (english && english.trim()) {
        text = english
        lang = 'en'
        translated = true
      }
    }
    const currentYear = new Date(this.now()).getUTCFullYear()
    // The country the story is about: the one the headline names, when the outlet's own country isn't named
    // (a Ghanaian outlet reporting on South Africa).
    const named = headlineCountries(text)
    const namedCountries = named.length ? named : capitalCountries(text)
    if (namedCountries.length && (!query.countryCode || !namedCountries.includes(query.countryCode))
      && !(query.countryCode && localLegislativeSubject(text))) {
      query = { ...query, countryCode: namedCountries[0]! }
    }
    const ranked: string[] = []
    // Stage 1: Wikipedia's Current events. An item telling this story names the thread it is filed under.
    const today = new Date(this.now()).toISOString().slice(0, 10)
    const events = !query.topic ? await this.currentEventItems().catch(() => [] as CurrentEventItem[]) : []
    // Untranslated, only names carry across languages: two must match.
    const storyCountryName = query.countryCode ? countryPlace(query.countryCode)?.name ?? null : null
    // With Laya, every item is also compared by meaning (cached, so each day's items are embedded once).
    const short = !query.topic && lang === 'en' && (this.options.embed || this.options.meaning) ? shortlist(events, text) : []
    const shortScores = short.length ? await this.meaningOf(cleanHeadline(text), short.map((index) => events[index]!.text)) : null
    const eventMeaning = shortScores ? events.map((_, index) => { const at = short.indexOf(index); return at === -1 ? null : shortScores[at]! }) as number[] : null
    const filed = !query.topic ? matchHeadline(events, text, today, lang === 'en' ? 0 : 2, storyCountryName, eventMeaning)[0] : undefined
    const filedThreads = filed ? [...filed.item.threads].reverse() : [] // nearest first
    for (const title of [...filedThreads, ...(filed?.item.links.slice(0, 8) ?? [])]) if (!ranked.includes(title)) ranked.push(title)
    const outletCountry = query.countryCode ? countryPlace(query.countryCode)?.name ?? null : null
    const queries = searchQueries(text, currentYear, lang === 'en' ? outletCountry : null)
    // A named event ("Cyclone Arnab") may have its own article: try that exact title first.
    for (const named of namedEvents(text)) if (!ranked.includes(named)) ranked.push(named)
    // Stage 2: search with every query at once, plus the whole headline favouring recently edited articles,
    // and fuse the rankings (reciprocal rank fusion): a title several queries agree on rises.
    // The idea the headline is about, in its country ("…pushing Beijing’s soft power?" → "soft power China").
    const storyCountry = query.countryCode ? countryPlace(query.countryCode)?.name ?? null : null
    const concept = cleanHeadline(text).replace(/[?!.,:;]+/g, ' ').split(/\s+/)
      .filter((word) => /^\p{Ll}[\p{L}-]{2,}$/u.test(word) && !STOPWORDS_FOR_CONCEPTS.has(word)).slice(-2).join(' ')
    const conceptQuery = lang === 'en' && storyCountry && concept.includes(' ') ? [`${concept} ${storyCountry}`] : []
    const allQueries = [...queries, ...conceptQuery, ...(lang === 'en' ? [`prefer-recent:0.5,30 ${cleanHeadline(text)}`] : [])]
    const results = await Promise.all(allQueries.map((q) => this.search(lang, q, 6).catch(() => [] as string[])))
    const fused = new Map<string, number>()
    results.forEach((titles) => titles.forEach((title, rank) => fused.set(title, (fused.get(title) ?? 0) + 1 / (60 + rank))))
    for (const [title] of [...fused].sort((a, b) => b[1] - a[1])) {
      if (ranked.length >= 48) break
      if (!ranked.includes(title)) ranked.push(title)
    }
    const articleOnly = new Map<string, string | null>()
    const items = await this.titleItems(lang, ranked, articleOnly).catch(() => new Map<string, { qid: string; disambiguation: boolean }>())
    const countryQid = query.countryCode ? await this.countryQid(query.countryCode).catch(() => null) : null
    // A story about two countries (Russia and Ukraine) is in both of them.
    const otherQids = (await Promise.all(namedCountries.filter((code) => code !== query.countryCode).slice(0, 2).map((code) => this.countryQid(code).catch(() => null)))).filter((qid): qid is string => !!qid)
    const storyQids = [...(countryQid ? [countryQid] : []), ...otherQids]
    const qids = [...new Set([...items.values()].map((item) => item.qid))]
    const entities = await this.entities([...qids, ...(query.topic ? [query.topic] : []), ...(countryQid ? [countryQid] : [])], 'en')
    const countryLabel = countryQid ? entities.get(countryQid)?.labels?.['en']?.value ?? null : null
    const ids = (entity: WikidataEntity | undefined, property: string): string[] => ((entity?.claims?.[property] ?? []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>)
      .map((claim) => claim.mainsnak?.datavalue?.value?.id).filter((id): id is string => typeof id === 'string')
    const subjectText = withoutCountryNames(text, countryLabel)
    // The headline without the cities and regions it names (and the outlet's own place): what is left is its subject.
    const namedPlaces = [...placesNamedIn(text, 6).map((place) => place.name), ...(query.place ? [query.place] : [])]
    const placeWords = new Set(namedPlaces.flatMap((name) => foldAccents(name).toLowerCase().split(/[^\p{L}\d]+/u).filter(Boolean)))
    const withoutPlaces = (value: string): string => value.split(/\s+/).filter((word) => !placeWords.has(foldAccents(word).toLowerCase().replace(/[^\p{L}\d]+/gu, ''))).join(' ')
    // "Traun (river)" is not the town of Traun: a disambiguator naming a feature or building makes it something else.
    const isNamedPlace = (label: string): boolean => !FACILITY.test(foldAccents(label.match(/\(([^)]*)\)\s*$/)?.[1] ?? '').toLowerCase())
      && namedPlaces.some((name) => foldAccents(name).toLowerCase() === foldAccents(label.replace(/\s*\(.*?\)\s*$/, '')).toLowerCase())
    // Names in the headline (not its first word, which is capitalised anyway), and the person it opens with.
    // (The first word is dropped: "Culture and sports to merge…" names no culture.)
    const headlineNames = properPhrases(cleanHeadline(text).replace(/^\S+\s*/, '')).join(' ')
    const opening = cleanHeadline(text).match(/^(\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){0,2})/u)?.[1] ?? ''
    // Only in the headline as written (a translated "Rains" is not Claude Rains): a full name, or a surname that ends the person's name.
    const subjectPerson = (label: string): boolean =>
      !isTitleCase(text) && personNameAtStart(label, text, translated ? query.text : undefined)

    // A story about a film, game or book may be about the work itself ("New 'Call of Duty' game imagines…").
    // "Series" and "game" are sports words too: a test series or a match is not a TV series or a video game.
    const aboutAWork = WORK_WORDS.test(text) && !(namesASport(text) && !/\b(film|movie|documentary|album|song|novel|book|trailer|premiere[sd]?|box office|soundtrack|video game)\b/i.test(text))
    // The organisation the headline opens with ("Nedbank buys…"): its own article is the subject.
    const subjectEntity = (label: string): boolean => {
      if (translated || isTitleCase(text) || !opening) return false
      return entityNameAtStart(label, opening)
    }
    // The countries of the people the headline names ("call with Putin" → Russia), from their Wikidata citizenship.
    const headlineWords = new Set(foldAccents(cleanHeadline(text)).toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length >= 3))
    const peopleQids = [...new Set([...entities.values()].filter((entity) => ids(entity, 'P31').includes('Q5') && headlineWords.has(foldAccents(nodeFromEntity(entity, 'en')?.label ?? '').replace(/\s*\(.*?\)\s*$/, '').toLowerCase().split(/\s+/).at(-1) ?? '-')).flatMap((entity) => ids(entity, 'P27').slice(0, 1)))].slice(0, 4)
    if (peopleQids.length) this.peopleCountries.set(text, await this.labelsOf(peopleQids).catch(() => []))
    const surnameOnly = !!opening && opening.split(/\s+/).length === 1
    // How widely known people are (Wikipedia editions about them): only for foreign people matched by surname.
    const famous = surnameOnly ? await this.famousAmong([...items.values()].map((item) => entities.get(item.qid)).filter((entity): entity is WikidataEntity => !!entity
      && ids(entity, 'P31').includes('Q5') && subjectPerson(nodeFromEntity(entity, 'en')?.label ?? '') && !storyQids.some((qid) => countriesOf(entity).includes(qid)))).catch(() => new Set<string>()) : new Set<string>()
    const locationPhrases = new Set(explicitPlacePhrases(text).map((place) => foldAccents(place).toLowerCase()))
    const specificPlaces = [...entities.values()].filter((entity) => (entity.claims?.['P625']?.length ?? 0) > 0
      && !ids(entity, 'P31').some((id) => ['Q5', 'Q6256', 'Q3624078', 'Q7275', 'Q3024240'].includes(id)))
      .map((entity) => nodeFromEntity(entity, 'en')?.label ?? '')
      .filter((label) => locationPhrases.has(foldAccents(label).toLowerCase()))
    const scored = ranked.flatMap((title, rank) => {
      const item = items.get(title)
      const entity = item ? entities.get(item.qid) : undefined
      if (!item || !entity) return []
      const node = nodeFromEntity(entity, 'en')
      // Newspapers are usually the source, not the story, unless the headline is about the paper itself.
      const classes = ids(entity, 'P31')
      const outletStory = !!node && lang === 'en' && classes.some((id) => MEDIA_OUTLET_CLASSES.has(id))
        && classes.every((id) => !NOT_A_TOPIC.has(id) || MEDIA_OUTLET_CLASSES.has(id)) && outletIsSubject(node.label, text)
      if (classes.some((id) => NOT_A_TOPIC.has(id)) && !outletStory) return []
      // No English name yet (the label is just "Q140393129"): nothing a reader could follow.
      if (!node || isQid(node.label)) return []
      // Untranslated headlines are matched against the title in their own language's Wikipedia; the thread is still shown in English.
      const native = lang !== 'en'
      const matchTitle = native ? title : node.label
      // "Subsidized housing in the United States" is not about Guernsey: drop topics named for a country the story isn't about.
      // Filed by Wikipedia's editors under this thread (or linked from the item): that is the evidence, not word overlap.
      const threadIndex = filedThreads.indexOf(title)
      const filedThread = threadIndex !== -1
      const filedLink = !filedThread && !!filed?.item.links.includes(title)
      const titleCountries = native || filedThread ? [] : headlineCountries(node.label)
      // Where a topic is: its country; a person's citizenship; an institution's jurisdiction.
      const countries = countriesOf(entity)
      // A foreign person matched only by a surname that opens the headline ("Bernardo…" in Manila is not Paul Bernardo),
      // unless known worldwide (Mbappé).
      const person = ids(entity, 'P31').includes('Q5')
      // Without a description, do not identify a person by partial full-name overlap alone.
      if (person && !filedThread && !node.description && !subjectPerson(node.label) && !fullPersonNameMentioned(node.label, text)) return []
      // A person a named place is called after ("João Pessoa", the city, not the politician) is not the story,
      // unless it is about the person (a death, a birth, a legacy).
      if (person && !filedThread && isNamedPlace(node.label)
        && !/\b(died|dies|death|born|birth|birthday|anniversary|legacy|statue|monument|remember\w*|tribute|biograph\w*)\b/i.test(text)) return []
      const death = (entity.claims?.['P570'] ?? []).find((claim) => claim.rank !== 'deprecated')?.mainsnak?.datavalue?.value as { time?: string } | undefined
      const deathYear = death?.time?.match(/^\+?(\d{4})-/)?.[1]
      if (person && !filedThread && lang === 'en' && personActivityConflicts(node.label, text, deathYear ? Number(deathYear) : null, currentYear)) return []
      // The person the story is about: named at the start, in full ("'Star Trek' star Patrick Stewart dies"),
      // or by office ("President Isaias", when their description holds that office).
      // A historical figure the story mentions ("… comment about Mao Zedong") is context, not its subject.
      const diedBefore = !!deathYear && Number(deathYear) < currentYear
      const namedPerson = person && (subjectPerson(node.label)
        || (lang === 'en' && !diedBefore && (fullPersonNameMentioned(node.label, text) || officeHolderNamed(node.label, node.description, text))))
      // "… dies age 86": a person who died this year is the story, not an article about their works.
      const diedNow = namedPerson && !!deathYear && Number(deathYear) >= currentYear
        && /\b(dies|died|dead|death|passes away|passed away|obituary|tributes?|mourn\w*)\b/i.test(text)
      if (person && surnameOnly && countries.length && storyQids.length && !storyQids.some((qid) => countries.includes(qid)) && !famous.has(item.qid)) return []
      // Partial native-language name overlap is not enough to identify a foreign namesake
      // when translation was unavailable (Wilson Neves in Angola ≠ Wilson das Neves in Brazil).
      if (person && !filedThread && countries.length && storyQids.length
        && !storyQids.some((qid) => countries.includes(qid))
        && !subjectPerson(node.label) && !fullPersonNameMentioned(node.label, text)) return []
      const storyCountries = [...(query.countryCode ? [query.countryCode] : []), ...namedCountries]
      if (storyCountries.length && titleCountries.length && !titleCountries.some((code) => storyCountries.includes(code))) return []
      // Films, TV series, songs and foods share words with the news ("Melania (film)", "Soldier Soldier", "Brazil nut").
      if (isWorkOrThing(node.description, aboutAWork)) return []
      // Sharing only the country's name ("German economic crisis" for a speech by Merz) is a weak match.
      // (The outlet's country counts too: "Cabinet of Egypt" for a renewables plan from an Egyptian paper.)
      const countryOnly = !native && !filedThread && titleWordsIn(node.label, `${text} ${countryLabel ?? ''}`) > 0 && titleWordsIn(node.label, subjectText) === 0
      const ageYears = topicAge(matchTitle, node.start?.iso, isEventLike(entity), currentYear, node.end?.iso)
      // The headline names the kind of event ("victory in … presidential election" → the election, not the presidency).
      const filedBonus = filedThread ? Math.max(4, 6 - threadIndex) : filedLink ? 1.5 : 0
      // A foreign institution or place (not an event) the headline never names is not this story ("Ministry of
      // Education, Culture, Sports…" of Japan for a merger of bureaus in Macau).
      const foreign = !filedThread && !isEventLike(entity) && storyQids.length > 0 && countries.length > 0 && countries.length <= 2
        && !storyQids.some((qid) => countries.includes(qid)) && titleWordsIn(matchTitle, headlineNames) === 0
        // The person the headline opens with is named, though first words are left out of its names ("Mbappe apologises…").
        && !namedPerson
      if (foreign) return []
      // A thing described as in another country ("type of Medicare facility in the United States") is not a local story there.
      // Only where the description says it is ("… in the United States"), not any nationality it mentions ("British Crown Dependencies").
      const describedIn = (node.description ?? '').match(/\bin (?:the )?([^,;()]+)$/)?.[1] ?? ''
      const describedCountries = person || isEventLike(entity) || filedThread || !query.countryCode || !describedIn ? [] : headlineCountries(describedIn)
      if (describedCountries.length && !describedCountries.some((code) => code === query.countryCode || namedCountries.includes(code))) return []
      // A foreign topic that brings in a name the story never mentions ("Mickey's Halloween Party" for a party in Bermuda).
      const elsewhere = !filedThread && storyQids.length > 0 && countries.length > 0 && countries.length <= 2 && !storyQids.some((qid) => countries.includes(qid))
      if (elsewhere && foreignNamesIn(matchTitle, text) > 0 && !namedPerson) return []
      // "China–United States relations" for a story about Trump and Beijing: the story's country and the
      // country of a person it names, together in one bilateral topic.
      const bilateral = !filedThread && !native && /\b(relations|rivalry|trade war|cold war)\b/i.test(node.label)
        && storyQids.some((qid) => countries.includes(qid)) && peopleQids.some((qid) => countries.includes(qid) && !storyQids.includes(qid))
      const kindScore = native ? 0 : eventKindMatches(node.label, text) ? 1.5 : eventKindConflicts(node.label, text) ? -3 : 0
      const score = filedBonus + (bilateral ? 4 : 0) + (namedPerson ? 2 : 0) + (diedNow ? 4 : 0) + (countryOnly ? -5 : 0) + kindScore + scoreCandidate({
        ageYears,
        rank,
        eventLike: isEventLike(entity),
        // Only for topics in one or two countries: an epidemic stated for many countries is not "in" each of them.
        inCountry: countries.length <= 2 && storyQids.some((qid) => countries.includes(qid) || ids(entity, 'P276').includes(qid)),
        // A person is a weak start for a history, unless the headline is about them ("Mbappe apologises…").
        isPerson: person && !namedPerson,
        isCountry: item.qid === countryQid || ids(entity, 'P31').some((id) => ['Q6256', 'Q3624078', 'Q7275', 'Q3024240', 'Q1763527', 'Q417175'].includes(id)),
        isDisambiguation: item.disambiguation,
        titleWordsInHeadline: titleWordsIn(matchTitle, text),
        // A recognised surname does not need the person’s given name repeated in the headline.
        foreignNames: namedPerson ? 0 : foreignNamesIn(matchTitle, text),
        otherCountry: storyQids.length > 0 && countries.length > 0 && countries.length <= 2 && !storyQids.some((qid) => countries.includes(qid)),
      })
      if (!Number.isFinite(score)) return []
      // A country-only match is a topic only when it is a current event ("2026 Brazilian general election"), never "Partition of India".
      const leadingYear = Number(matchTitle.match(/^(\d{4})\b/)?.[1] ?? NaN)
      // …and the headline must point to that kind of event: "Lula's win" → the election, not a Mastercard deal → an offensive.
      // Sharing only a place's name ("FC Botoșani" for a water cut in Botoșani, a camp in Ebensee for a film made there)
      // is weak too, unless it is that place itself.
      // (Events are named for their place by convention: "2026 Tamil Nadu election" stays a candidate.)
      // …and so is an event that is past ("2018 Toronto van attack" for a home invasion) or not the kind of event the
      // headline names ("RAF Abu Dhabi", a wrestling show, for an Abu Dhabi summit).
      const headlineKinds = eventKindsIn(text)
      const placeLikeEvent = isEventLike(entity) && ((ageYears !== null && ageYears >= 2)
        || (headlineKinds.length > 0 && !eventKindsIn(node.label).some((kind) => headlineKinds.includes(kind))))
      const placeOnly = !filedThread && (!isEventLike(entity) || placeLikeEvent) && placeWords.size > 0 && !isNamedPlace(node.label)
        && titleWordsIn(matchTitle, subjectText) > 0 && titleWordsIn(matchTitle, withoutPlaces(subjectText)) === 0
      const weakOnly = (countryOnly || placeOnly) && !(leadingYear >= currentYear - 1 && eventKindMatches(node.label, text))
      // A general concept with no country ("Soldier") is a poor starting point for one country's news.
      const general = !isEventLike(entity) && ids(entity, 'P17').length === 0 && !ids(entity, 'P31').includes('Q5')
      // Without translation, one shared word is too weak ("ONU" → "EJ Onu"), unless the title is that one word.
      // The person the headline opens with is its subject ("Mbappe apologises…" → Kylian Mbappé).
      // A current event in the story's country, of the kind the headline describes, sharing a word with it
      // ("2026 Toledo train collision" for "Spain's deadly train crash"), even when the other words differ.
      const currentLocalEvent = !native && isEventLike(entity) && ageYears === 0 && eventKindMatches(node.label, text)
        && titleWordsIn(node.label, text) >= 1 && storyQids.some((qid) => countries.includes(qid) || ids(entity, 'P276').includes(qid))
      const words = filedThread || currentLocalEvent || outletStory || bilateral || (namedPerson && titleWordsIn(node.label, text) > 0)
        || (!ids(entity, 'P31').includes('Q5') && subjectEntity(node.label) && !general) || (native
        ? isRelevantCandidate(matchTitle, text, undefined, currentYear) && titleWordsIn(matchTitle, text) >= Math.min(2, titleContentWords(matchTitle).length)
        : isRelevantCandidate(node.label, text, countryLabel ?? undefined, currentYear))
      // A general concept ("Government", "Military parade") needs two words in common, not one.
      // An event of a kind the headline never points to, sharing one word ("2027 Palestinian presidential election"
      // for a story about visa refusals), is not this story.
      const unrelatedEvent = !filedThread && !native && isEventLike(entity) && eventKindNamed(node.label)
        && !eventKindMatches(node.label, text) && titleWordsIn(node.label, text) <= 1
      // An old numbered edition the headline never names ("Third plenary session of the 11th Central Committee", 1978,
      // for this year's plenary session) is history, not the news.
      const editions = !filedThread && !native ? unmentionedEditions(node.label, text) : []
      const oldEdition = editions.length >= 2 || (editions.length > 0 && (ageYears ?? 0) > 5)
      const conceptOk = !unrelatedEvent && !oldEdition && (!general || filedThread || titleWordsIn(matchTitle, text) >= 2)
        // A different kind of event or body from the one the headline names (a football team for a school awards story).
        && (filedThread || native || (!eventKindConflicts(node.label, text) && !eventNameConflicts(node.label, text, countryLabel)))
      return [{ id: item.qid, node, score, entity,
        scopedSubject: !native && scopedSubjectMatches(node.label, text) && !!countryLabel
          && (countries.includes(countryQid ?? '') || foldAccents(node.label).toLowerCase().includes(foldAccents(countryLabel).toLowerCase())),
        // A dated Current events filing is current evidence when Wikidata has no date yet.
        localEvent: !native && (ageYears === 0 || (ageYears === null && (filedThread || filedLink))) && eventKindMatches(node.label, text)
          && specificPlaces.some((place) => titleWordsIn(node.label, place) >= titleContentWords(place).length),
        weakOnly: weakOnly && !filedThread, general: general && !filedThread, words: words && conceptOk, rescuable: conceptOk && !general && titleWordsIn(matchTitle, text) >= 1 && !weakOnly,
        // A place named in full ("Dubai"): a city's description never reads like the story, so Laya does not veto it.
        // Not a person ("Mao Zedong" in an apology story) or a country (the story is usually its relations, not the country).
        named: (entity.claims?.['P625']?.length ?? 0) > 0 && !ids(entity, 'P31').includes('Q5') && !ids(entity, 'P31').some((id) => ['Q6256', 'Q3624078', 'Q7275', 'Q3024240'].includes(id))
          && titleContentWords(matchTitle).length > 0 && titleWordsIn(matchTitle, text) >= titleContentWords(matchTitle).length }]
    })
    // Laya, when on, compares the headline's meaning with each candidate's title and description on this Mac.
    const similarity = lang === 'en' && scored.length
      ? await this.meaningOf(cleanHeadline(text), scored.map((candidate) => `${candidate.node.label}. ${candidate.node.description ?? ''}`.trim()))
      : null
    const byMeaning = similarity !== null && similarity.length === scored.length
    const relevant = scored
      .map((candidate, index) => ({ ...candidate, meaning: byMeaning ? similarity[index]! : null }))
      .filter((candidate) => keepCandidate(candidate.words, candidate.meaning, candidate.rescuable, candidate.named))
      .map((candidate) => ({ ...candidate, score: candidate.score + (candidate.meaning ?? 0) * MEANING_WEIGHT }))
      .sort((a, b) => Number(b.localEvent) - Number(a.localEvent) || Number(b.scopedSubject) - Number(a.scopedSubject) || b.score - a.score)
    this.options.debug?.(text, scored.map((candidate, index) => ({ label: candidate.node.label, description: candidate.node.description, score: candidate.score + (byMeaning ? similarity[index]! * MEANING_WEIGHT : 0), meaning: byMeaning ? similarity[index]! : null, words: candidate.words, named: candidate.named, localEvent: candidate.localEvent, scopedSubject: candidate.scopedSubject, weakOnly: candidate.weakOnly, kept: relevant.some((item) => item.id === candidate.id) && !candidate.weakOnly })), { queries, titles: ranked })
    const scoredRelevant = relevant
    const unique = scoredRelevant.filter((candidate, index) => scoredRelevant.findIndex((other) => other.id === candidate.id) === index)
    const chosen = query.topic ? { id: query.topic, entity: entities.get(query.topic), node: entities.get(query.topic) ? nodeFromEntity(entities.get(query.topic)!, 'en') : null } : unique.find((candidate) => !candidate.weakOnly)
    if (!chosen?.entity || !chosen.node) {
      // No topic: still place the story in its country's history, and say why.
      if (!query.countryCode) {
        // A local institution may have no article, but another article explicitly spells out
        // its acronym. Only use this evidence after normal matching has found nothing.
        if (lang === 'en' && !translated) {
          const acronyms = [...new Set(text.match(/\b[A-Z]{3,8}\b/g) ?? [])].slice(0, 2)
          for (const acronym of acronyms) {
            const url = new URL('https://en.wikipedia.org/w/api.php')
            url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: `"${acronym}"`, srlimit: '10', srnamespace: '0', format: 'json', formatversion: '2' }).toString()
            const payload = await this.getJson(url.toString(), 8_000).catch(() => null) as { query?: { search?: Array<{ title?: string; snippet?: string }> } } | null
            const expansion = expansionFromSnippets(acronym, payload?.query?.search ?? [])
            if (!expansion) continue
            const expanded = text.replace(new RegExp(`\\b${acronym}\\b`, 'g'), expansion.name)
            // Require an actual country in the expansion before retrying; no recursive guessing.
            const countryCode = headlineCountries(expansion.name)[0]
            if (!countryCode) continue
            const resolved = await this.headlineThread({ ...query, text: expanded, countryCode, lang: 'en' })
            if (resolved.context) {
              resolved.context.headline = query.text
              resolved.context.matchedBy += ` ${acronym} is expanded as ${expansion.name} in Wikipedia’s ${expansion.source}.`
            }
            return resolved
          }
        }
        throw new Error('No Wikipedia topic matched this headline.')
      }
      // A local outlet's story with no topic of its own: the history of the city or region it comes from, before the whole country's.
      const local = await this.localFallback(query, lang, unique)
      if (local) return local
      const loadCountry = (): Promise<OldsThread> => this.thread({ kind: 'country', countryCode: query.countryCode! })
      const country = { ...await loadCountry().catch(() => new Promise<OldsThread>((resolve) => setTimeout(resolve, 1_500)).then(loadCountry)).catch(() => { throw new Error('No Wikipedia topic matched this headline, and its country’s history could not be loaded. Try again in a moment.') }) }
      const year = new Date(this.now()).getUTCFullYear()
      const root = country.nodes.find((node) => node.id === country.rootId)!
      // The whole history of a country is not the story's history: keep only the events about its subject.
      const focus = focusStems(text, root.label)
      const historyTitle = country.chaptersSource?.title ?? titleFromWikipediaUrl(root.wikipediaUrl)
      const focused = historyTitle && lang === 'en' ? await this.chronicleAbout(historyTitle, text, focus) : []
      if (focused.length) country.chronicle = focused
      else delete country.chronicle
      // This year in the country ("2026 in Barbados"): its events about the story, or else its latest events, as the recent backdrop.
      let yearNote = ''
      if (!focused.length) {
        const place = countryPlace(query.countryCode)?.name ?? root.label
        for (const name of [...new Set([place, root.label])]) {
          const title = `${year} in ${name}`
          const about = lang === 'en' ? await this.chronicleAbout(title, text, focus, { yearHint: year, floor: CHRONICLE_MEANING_FLOOR + 0.05 }) : []
          const latest = about.length ? about : (await this.chronicle(title, 'en', [], year).catch(() => [])).slice(-6)
          if (latest.length) {
            country.chronicle = latest
            yearNote = about.length ? ` Events about it from Wikipedia’s ${title}.` : ` No dated events about it yet; the latest from Wikipedia’s ${title} show what else is happening there.`
            break
          }
        }
      }
      const related = lang === 'en' ? await this.relatedTopics(text, countryLabel, [root.label], byMeaning, query.countryCode).catch(() => []) : []
      // A subject topic the headline's words point to ("Xenophobia in South Africa") beats the whole country's history.
      const subject = await this.subjectTopic(text, countryLabel ?? root.label, related, true)
      if (subject && !query.topic) {
        const better = await this.headlineThread({ ...query, topic: subject.qid })
        if (better.context) {
          better.context.matchedBy = `No Wikipedia topic matched this headline's words directly; it is about ${subject.title}, a subject in ${root.label}, so that is shown.`
          better.context.candidates = unique.slice(0, 4).map((candidate) => ({ id: candidate.id, label: candidate.node.label, description: candidate.node.description }))
        }
        return better
      }
      return {
        ...country,
        context: {
          headline: query.text.replace(/\s+/g, ' ').trim().slice(0, 300),
          topicId: country.rootId,
          candidates: unique.slice(0, 4).map((candidate) => ({ id: candidate.id, label: candidate.node.label, description: candidate.node.description })),
          path: [{ node: root, relation: '', edge: null }],
          chapter: country.chapters ? chapterForYear(country.chapters, year, year) : null,
          chapterSource: country.chaptersSource ?? null,
          ...(related.length ? { related } : {}),
          matchedBy: `Geographic fallback: no specific Wikipedia subject or event clearly matched this headline${lang !== 'en' ? ` in ${lang} Wikipedia; add this language under Languages so headlines can be translated on this Mac first` : ''}. Showing ${root.label}'s place-level history.${yearNote}`,
        },
      }
    }

    // Part of a larger event, adding words the headline never uses ("Futsal at the 2026 Summer Youth Olympics" for
    // athletes leaving for the Youth Olympic Games): the larger event (Wikidata "part of") is the story.
    if (!query.topic && lang === 'en' && foreignNamesIn(chosen.node.label, text) > 0) {
      const parent = ids(chosen.entity, 'P361')[0]
      const parentEntity = parent ? (await this.entities([parent], 'en').catch(() => new Map<string, WikidataEntity>())).get(parent) : undefined
      const parentNode = parentEntity ? nodeFromEntity(parentEntity, 'en') : null
      if (parent && parentNode && foreignNamesIn(parentNode.label, text) < foreignNamesIn(chosen.node.label, text) && titleWordsIn(parentNode.label, text) >= titleWordsIn(chosen.node.label, text) - 1 && titleWordsIn(parentNode.label, text) > 0) {
        const better = await this.headlineThread({ ...query, topic: parent })
        if (better.context) {
          better.context.matchedBy = `${chosen.node.label} is part of ${parentNode.label}, which is what the headline is about.`
          better.context.candidates = [{ id: chosen.id, label: chosen.node.label, description: chosen.node.description }, ...better.context.candidates.filter((candidate) => candidate.id !== chosen.id)].slice(0, 4)
        }
        return better
      }
    }
    // "Jay-Z to perform at Super Bowl half-time show": the next one in the series (Wikidata "followed by"), not the last.
    if (!query.topic && UPCOMING.test(cleanHeadline(text))) {
      const next = ids(chosen.entity, 'P156')[0]
      const nextEntity = next ? (await this.entities([next], 'en').catch(() => new Map<string, WikidataEntity>())).get(next) : undefined
      const nextNode = nextEntity ? nodeFromEntity(nextEntity, 'en') : null
      const nextYear = Number(nextNode?.start?.iso.match(/^(\d{4})/)?.[1] ?? NaN)
      if (next && nextNode && nextYear >= currentYear) {
        const better = await this.headlineThread({ ...query, topic: next })
        if (better.context) {
          better.context.matchedBy = `The headline is about what comes next: ${nextNode.label}, which follows ${chosen.node.label} (Wikidata "followed by").`
          better.context.candidates = [{ id: chosen.id, label: chosen.node.label, description: chosen.node.description }, ...better.context.candidates.filter((candidate) => candidate.id !== chosen.id)].slice(0, 4)
        }
        return better
      }
    }
    const thread = await this.itemThread(chosen.id, 'en')
    // A long article: with Laya, its dated events closest to this story rather than its earliest and latest.
    if ((this.options.embed || this.options.meaning) && lang === 'en' && (thread.chronicle?.length ?? 0) >= 12) {
      const title = titleFromWikipediaUrl(chosen.node.wikipediaUrl)
      const relevant = title ? await this.chronicleAbout(title, text, [], { keep: 14, floor: 0.15 }) : []
      if (relevant.length >= 6) thread.chronicle = relevant
    }
    // A broad topic (a country, region or continent): keep only events about this story's subject.
    const description = chosen.node.description ?? ''
    const placeTypeDescription = /^(?:(?:one of the|a|an|the)\s+)?(?:(?:British|administrative|municipal|urban|coastal|inhabited|large|small|capital)\s+)*(?:Crown dependenc(?:y|ies)|island|city|town|village|municipality|borough|district|county)\b/i.test(description)
    const broad = ids(chosen.entity, 'P31').some((id) => BROAD_CLASSES.has(id))
      || /\b(region|country|continent|province|state of|subcontinent|territory)\b/i.test(description)
      || placeTypeDescription
      || /^History of /.test(chosen.node.label)
    // A place matched only by the headline's capitalised first word ("Česká liga…" → the village of Česká), and not a
    // known place in the story's country, is not where the story is: the outlet's own city or region is the better backdrop.
    if (broad && !query.topic && query.place && query.countryCode) {
      const afterOpening = cleanHeadline(text).replace(/^\S+\s*/, '')
      const openingOnly = titleWordsIn(chosen.node.label, text) > 0 && titleWordsIn(chosen.node.label, afterOpening) === 0
      const known = placesNamedIn(chosen.node.label, 1).some((place) => place.countryCode === query.countryCode)
      if (openingOnly && !known) {
        const local = await this.localFallback(query, lang, unique)
        if (local) return local
      }
    }
    if (broad && lang === 'en') {
      const focus = focusStems(text, chosen.node.label)
      const title = titleFromWikipediaUrl(chosen.node.wikipediaUrl)
      thread.chronicle = title ? await this.chronicleAbout(title, text, focus) : []
      if (!thread.chronicle.length) delete thread.chronicle
    }
    // A thin timeline for a story between two countries ("Trump" and "Beijing’s soft power"): add the
    // history of their relations as clearly attributed background (rivalry, the Cold War, normalisation).
    let backdropNote = ''
    if (!query.topic && lang === 'en' && (thread.chronicle?.length ?? 0) < 6 && query.countryCode) {
      const backdrop = await this.relationsBackdrop(text, query.countryCode, namedCountries).catch(() => null)
      if (backdrop?.entries.length) {
        const seen = new Set((thread.chronicle ?? []).map((entry) => entry.text))
        thread.chronicle = [...(thread.chronicle ?? []), ...backdrop.entries.filter((entry) => !seen.has(entry.text))]
          .sort((a, b) => a.at.iso.localeCompare(b.at.iso))
        backdropNote = ` Background from Wikipedia’s ${backdrop.title}.`
      }
    }
    const path = await this.pathBack(chosen.entity, chosen.node, countryQid)
    let chapter: OldsChapter | null = null
    let chapterSource: OldsContext['chapterSource'] = null
    // The chapter comes from the topic's own country: the outlet's if the topic is there, else the topic's first "country".
    const topicCountries = ids(chosen.entity, 'P17')
    const namesOutletCountry = !!query.countryCode && !!countryQid && (await this.entities([countryQid], 'en').catch(() => new Map<string, WikidataEntity>())).get(countryQid)?.labels?.['en']?.value
    const titleNamesCountry = typeof namesOutletCountry === 'string' && chosen.node.label.toLowerCase().includes(namesOutletCountry.toLowerCase())
    const chapterCountry = countryQid && (topicCountries.includes(countryQid) || topicCountries.length === 0 || titleNamesCountry)
      ? query.countryCode ?? null
      : topicCountries.length ? await this.isoCode(topicCountries[0]!).catch(() => null) : null
    if (chapterCountry) {
      const country = await this.thread({ kind: 'country', countryCode: chapterCountry }).catch(() => null)
      const years = path.map((step) => yearNumber(step.node.start)).filter((year): year is number => year !== null)
      const chapters = country?.chapters ?? []
      // News is about today: show the chapter the country is in now (the topic's own date is on the path).
      void years
      const year = new Date(this.now()).getUTCFullYear()
      chapter = chapterForYear(chapters, year, year) ?? (year >= new Date(this.now()).getUTCFullYear() - 30 ? chapters.filter((item) => item.start).at(-1) ?? null : null)
      chapterSource = country?.chaptersSource ?? null
    }
    const context: OldsContext = {
      headline: query.text.replace(/\s+/g, ' ').trim().slice(0, 300),
      topicId: chosen.id,
      candidates: unique.filter((candidate) => candidate.id !== chosen.id).slice(0, 4).map((candidate) => ({ id: candidate.id, label: candidate.node.label, description: candidate.node.description })),
      path,
      chapter,
      chapterSource,
      matchedBy: query.topic
        ? 'You chose this topic.'
        : lang === 'en'
          ? `Best match among English Wikipedia search results for the headline's words${translated ? ' (translated on this Mac)' : ''}${countryQid ? ', preferring topics in this country' : ''}${byMeaning ? ', checked by meaning with Laya on this Mac' : ''}.`
          : `Matched in ${lang} Wikipedia without translation, so this may be off. Add this language under Languages and headlines are translated on this Mac before matching.`,
    }
    if (backdropNote) context.matchedBy += backdropNote
    // No country from the outlet (international desks): use the topic's own country on Wikidata.
    let topicCountry = countryLabel
    let topicCountryCode = query.countryCode
    if (!topicCountry && topicCountries[0]) {
      topicCountry = (await this.entities([topicCountries[0]], 'en').catch(() => new Map<string, WikidataEntity>())).get(topicCountries[0])?.labels?.['en']?.value ?? null
      topicCountryCode = (await this.isoCode(topicCountries[0]).catch(() => null)) ?? undefined
    }
    // Still none: the country the headline itself names ("Israel to give verdict…").
    if (!topicCountry) {
      // "Brazil’s" → Brazil; "Latin America" is a region, not the United States.
      const plain = text.replace(/[’']s\b/g, '').replace(REGIONS_NOT_COUNTRIES, '')
      const named = placesNamedIn(plain, 4).find((place) => place.kind === 'country') ?? placesNamedIn(plain, 4)[0]
      if (named) {
        topicCountry = named.country
        topicCountryCode = named.countryCode
      }
    }
    const related = lang === 'en' ? await this.relatedTopics(text, topicCountry, [chosen.node.label, topicCountry ?? ''].filter(Boolean), byMeaning, topicCountryCode).catch(() => []) : []
    if (related.length) context.related = related
    // Matched a broad place, but a current event that fits the headline turned up ("2026 Brazilian general election"):
    // that event is what the story is about.
    if (broad && !query.topic) {
      const year = new Date(this.now()).getUTCFullYear()
      const event = related.find((topic) => {
        const leading = Number(topic.title.match(/^(\d{4})\b/)?.[1] ?? NaN)
        return leading >= year - 1 && isRelevantCandidate(topic.title, text, topicCountry ?? undefined, year)
      })
      const eventQid = event ? (await this.titleItems('en', [event.title]).catch(() => new Map<string, { qid: string; disambiguation: boolean }>())).get(event.title)?.qid : undefined
      if (eventQid && eventQid !== chosen.id) {
        const better = await this.headlineThread({ ...query, topic: eventQid })
        if (better.context) better.context.matchedBy = `The headline matched ${chosen.node.label}, a broad place; it is about ${event!.title}, so that is shown instead. Wikipedia and Wikidata, ${translated ? 'translated on this Mac, ' : ''}checked against the headline’s words.`
        return better
      }
      // A continent or region, with two countries in the story: their relations ("Ethiopia–Russia relations").
      const relation = topicCountry && !ids(chosen.entity, 'P31').some((id) => ['Q6256', 'Q3624078'].includes(id)) ? await this.subjectTopic(text, topicCountry, related, true) : null
      if (relation && / relations$/.test(relation.title) && relation.qid !== chosen.id) {
        const better = await this.headlineThread({ ...query, topic: relation.qid })
        if (better.context) better.context.matchedBy = `The headline matched ${chosen.node.label}, a broad region; it is about ${relation.title}, so that is shown instead.`
        return better
      }
    }
    // Matched only by the country's name ("South African Air Force" for anti-immigrant violence in South Africa):
    // a subject topic the headline's own words point to ("Xenophobia in South Africa") says more.
    if (!query.topic && topicCountry && related.length) {
      const countryWords = topicCountry.toLowerCase().split(/\s+/).join(' ')
      const subjectOnly = cleanHeadline(text).replace(new RegExp(`\\b(${countryWords.split(' ').map((word) => word.slice(0, 5)).join('|')})\\p{L}*`, 'giu'), ' ')
      // A place can be the exact name overlap while still being only the location
      // of a story. Give specific subject families a chance before calling the
      // place itself the subject.
      const weak = broad || ('weakOnly' in chosen && chosen.weakOnly === true) || ('general' in chosen && chosen.general === true)
      void subjectOnly
      const subject = weak ? await this.subjectTopic(text, topicCountry, related, false) : null
      const subjectQid = subject?.qid
      if (subjectQid && subjectQid !== chosen.id) {
        const better = await this.headlineThread({ ...query, topic: subjectQid })
        if (better.context) {
          better.context.matchedBy = `The headline's words matched ${chosen.node.label} only by the country's name; it is about ${subject!.title}, so that is shown instead.`
          better.context.candidates = [{ id: chosen.id, label: chosen.node.label, description: chosen.node.description }, ...better.context.candidates.filter((candidate) => candidate.id !== chosen.id)].slice(0, 4)
        }
        return better
      }
    }
    // The story as Wikipedia's Current events filed it: its threads, and every dated item under the chosen thread.
    if (filed && !query.topic) {
      context.filedUnder = { threads: filed.item.threads, item: filed.item.text, date: filed.item.date, url: filed.item.url }
      const viaMeaning = !!eventMeaning && eventMeaning[events.indexOf(filed.item)] != null ? ', matched by meaning with Laya on this Mac' : ''
      if (filed.item.threads.length) context.matchedBy = `Wikipedia’s Current events filed this story under ${filed.item.threads.join(' → ')} (${filed.item.date}${viaMeaning}). ${context.matchedBy}`
      const chosenTitle = titleFromWikipediaUrl(chosen.node.wikipediaUrl) ?? chosen.node.label
      const filedAs = [...filedThreads, ...filed.item.links].find((title) => title.toLowerCase() === chosenTitle.toLowerCase()) ?? filedThreads[0] ?? null
      const steps = filedAs ? threadItems(events, filedAs) : []
      const recent = (steps.length ? steps : [filed.item]).map(currentEventEntry)
      if (!steps.includes(filed.item)) recent.push(currentEventEntry(filed.item))
      thread.chronicle = mergeChronicles(thread.chronicle ?? [], recent)
    }
    // A "Timeline of …" article for the topic (often one per year): its dated entries are the recent run-up.
    if (!query.topic || filed) {
      const timeline = await this.timelineOf(titleFromWikipediaUrl(chosen.node.wikipediaUrl) ?? chosen.node.label, currentYear).catch(() => null)
      if (timeline && timeline.entries.length >= 3) {
        thread.chronicle = mergeChronicles(thread.chronicle ?? [], timeline.entries)
        context.matchedBy += ` Recent steps from Wikipedia’s ${timeline.title}.`
      }
    }
    // A closer article that is too new for Wikidata ("Cyclone Arnab", "Super Bowl LXI halftime show"): its timeline tells this story better.
    if (!query.topic && lang === 'en') {
      const named = new Set(namedEvents(text))
      const upcoming = UPCOMING.test(cleanHeadline(text))
      const chosenWords = titleWordsIn(chosen.node.label, text)
      const newer = [...articleOnly].find(([title, description]) => {
        if (isWorkOrThing(description) || !isRelevantCandidate(title, text, topicCountry ?? undefined, currentYear)) return false
        if (named.has(title)) return true
        const year = Number(`${title} ${description ?? ''}`.match(/\b(20\d{2})\b/)?.[1] ?? NaN)
        return upcoming && year >= currentYear && titleWordsIn(title, text) >= chosenWords
      })
      // Too new for Wikidata means recent: dates written without a year are this year's.
      const timeline = newer ? await this.chronicle(newer[0], 'en', [], currentYear).catch(() => []) : []
      if (newer && timeline.length >= 2) {
        thread.chronicle = timeline
        context.matchedBy += ` “How we got here” is from Wikipedia’s ${newer[0]}, which is too new to be on Wikidata.`
      }
    }
    if (broad && !query.topic) {
      const filedNote = filed?.item.threads.length
        ? ` Wikipedia’s Current events page filed it under ${filed.item.threads.join(' → ')} (${filed.item.date}), but that filing did not identify a narrower historical topic.`
        : ''
      context.matchedBy = `Geographic fallback: the headline matched ${chosen.node.label}, a broad place, but no specific subject or event was verified. Showing ${chosen.node.label}'s place-level history.${filedNote}`
    }
    return { ...thread, context }
  }

  /**
   * The "Timeline of …" article that covers a topic now: "Timeline of the
   * Sudanese civil war (2026)", "… (1 September 2026 – present)", or one with
   * no dates. Found by title prefix; dated entries come from its headings and lines.
   */
  private async timelineOf(topic: string, currentYear: number): Promise<{ title: string; entries: OldsChronicleEntry[] } | null> {
    const base = topic.replace(/\s*\(.*?\)\s*$/, '').trim()
    if (base.length < 4 || /^Timeline of /i.test(base)) return null
    const titles: string[] = []
    for (const prefix of [`Timeline of the ${base}`, `Timeline of ${base}`]) {
      const url = new URL('https://en.wikipedia.org/w/api.php')
      url.search = new URLSearchParams({ action: 'query', list: 'prefixsearch', pssearch: prefix, pslimit: '20', psnamespace: '0', format: 'json', formatversion: '2' }).toString()
      const payload = await this.getJson(url.toString(), 8_000) as { query?: { prefixsearch?: Array<{ title?: string }> } }
      for (const hit of payload.query?.prefixsearch ?? []) {
        // The same topic, maybe with dates in brackets: not "Timeline of the Sudanese civil war in Darfur".
        if (hit.title && hit.title.replace(/\s*\(.*?\)\s*$/, '').toLowerCase() === prefix.toLowerCase()) titles.push(hit.title)
      }
      if (titles.length) break
    }
    if (!titles.length) return null
    // The one reaching today: "present" or this year, else the latest year, else the undated one.
    const yearOf = (title: string): number => /present\)/i.test(title) ? 9999 : Math.max(0, ...[...title.matchAll(/\b(\d{4})\b/g)].map((match) => Number(match[1])))
    const best = [...titles].sort((a, b) => yearOf(b) - yearOf(a))[0]!
    const years = [...best.matchAll(/\b(\d{4})\b/g)].map((match) => Number(match[1]))
    const entries = await this.chronicle(best, 'en', [], years.length ? Math.max(...years) : currentYear)
    // Credit the timeline article, not its date heading ("From “14 October”").
    return { title: best, entries: entries.map((entry) => (/^\d{1,2} \p{L}+$|^\p{L}+ \d{1,2}$/u.test(entry.section) ? { ...entry, section: best } : entry)) }
  }

  /** The first specific subject topic among the related ones ("Xenophobia in South Africa", not "Politics of …"). */
  private async subjectTopic(text: string, country: string, related: OldsRelatedTopic[], allowRelations: boolean): Promise<{ qid: string; title: string } | null> {
    const family = new Set(relatedQueries(text, country, [], [], allowRelations ? otherCountries(text, country, namedCountryNames(text), this.peopleCountries.get(text) ?? []) : []).titles)
    const GENERIC = /^(Politics|Economy|Government|Law|Judiciary|Military|Armed Forces|Foreign relations|Elections|Taxation|Environment|Health|Healthcare|Health care|Education|Climate change|Natural disasters) (of|in) /
    // Families first ("Xenophobia in …"); two countries' relations only when nothing else fits.
    const subject = related.find((topic) => family.has(topic.title) && !GENERIC.test(topic.title) && !/ relations$/.test(topic.title))
      ?? related.find((topic) => family.has(topic.title) && / relations$/.test(topic.title))
    if (!subject) return null
    const qid = (await this.titleItems('en', [subject.title]).catch(() => new Map<string, { qid: string; disambiguation: boolean }>())).get(subject.title)?.qid
    return qid ? { qid, title: subject.title } : null
  }

  /**
   * Items from the last 45 days of Wikipedia's Current events, parsed into
   * threads. One request for up to 50 day pages; kept for three hours.
   */
  private currentEventsCache: { at: number; items: CurrentEventItem[] } | null = null
  private async currentEventItems(): Promise<CurrentEventItem[]> {
    const now = this.now()
    if (this.currentEventsCache && now - this.currentEventsCache.at < CURRENT_EVENTS_TTL_MS) return this.currentEventsCache.items
    const file = join(this.options.cacheDir, 'current-events.json')
    const saved = await readFile(file, 'utf8').then((raw) => JSON.parse(raw) as { at: number; items: CurrentEventItem[] }).catch(() => null)
    if (saved && now - saved.at < CURRENT_EVENTS_TTL_MS && Array.isArray(saved.items)) {
      this.currentEventsCache = saved
      return saved.items
    }
    const pages = dayPages(new Date(now), CURRENT_EVENTS_DAYS)
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.search = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: pages.map((page) => page.title).join('|'), format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString(), 20_000) as { query?: { pages?: Array<{ title?: string; missing?: boolean; revisions?: Array<{ slots?: { main?: { content?: string } } }> }> } }
    const dates = new Map(pages.map((page) => [page.title, page.date]))
    const items = (payload.query?.pages ?? []).flatMap((page) => {
      const content = page.revisions?.[0]?.slots?.main?.content
      const date = page.title ? dates.get(page.title) : undefined
      return content && date ? parseDayPage(content, date, page.title) : []
    })
    this.currentEventsCache = { at: now, items }
    await mkdir(this.options.cacheDir, { recursive: true }).catch(() => undefined)
    await writeFile(file, JSON.stringify(this.currentEventsCache)).catch(() => undefined)
    return items
  }

  /** Countries of the people a headline names, by headline (see otherCountries). */
  private readonly peopleCountries = new Map<string, string[]>()

  /** English labels of Wikidata items (labels only: cheap even for countries). */
  private async labelsOf(qids: string[]): Promise<string[]> {
    const url = new URL('https://www.wikidata.org/w/api.php')
    url.search = new URLSearchParams({ action: 'wbgetentities', ids: qids.join('|'), props: 'labels', languages: 'en', format: 'json' }).toString()
    const payload = await this.getJson(url.toString(), 10_000) as { entities?: Record<string, { labels?: { en?: { value?: string } } }> }
    return qids.map((qid) => payload.entities?.[qid]?.labels?.en?.value).filter((label): label is string => !!label)
  }

  /** People with articles in 60 or more Wikipedia languages: known worldwide. */
  private async famousAmong(people: WikidataEntity[]): Promise<Set<string>> {
    const ids = [...new Set(people.map((person) => person.id).filter((id): id is string => !!id && isQid(id)))].slice(0, 10)
    if (!ids.length) return new Set()
    // How many Wikipedias cover a person changes slowly: remembered on this Mac, so a busy or rate-limited Wikidata
    // never turns a known person (Mbappé) into an unknown one.
    const known = await this.fameCounts()
    const missing = ids.filter((id) => known[id] === undefined)
    if (missing.length) {
      const url = new URL('https://www.wikidata.org/w/api.php')
      url.search = new URLSearchParams({ action: 'wbgetentities', ids: missing.join('|'), props: 'sitelinks', format: 'json' }).toString()
      const payload = await this.getJson(url.toString(), 10_000).catch(() => null) as { entities?: Record<string, { sitelinks?: Record<string, unknown> }> } | null
      if (payload?.entities) {
        for (const [id, entity] of Object.entries(payload.entities)) {
          if (isQid(id)) known[id] = Object.keys(entity.sitelinks ?? {}).filter((site) => site.endsWith('wiki')).length
        }
        await this.saveFameCounts(known)
      }
    }
    return new Set(ids.filter((id) => (known[id] ?? 0) >= 60))
  }

  private fame: Record<string, number> | null = null

  private async fameCounts(): Promise<Record<string, number>> {
    if (this.fame) return this.fame
    try {
      const raw = JSON.parse(await readFile(join(this.options.cacheDir, 'fame.json'), 'utf8')) as unknown
      this.fame = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([id, count]) => isQid(id) && typeof count === 'number' && Number.isFinite(count)) as Array<[string, number]>)
        : {}
    } catch {
      this.fame = {}
    }
    return this.fame
  }

  private async saveFameCounts(counts: Record<string, number>): Promise<void> {
    // The latest 2,000 people are plenty; older entries are dropped first.
    const entries = Object.entries(counts).slice(-2_000)
    this.fame = Object.fromEntries(entries)
    await mkdir(this.options.cacheDir, { recursive: true }).catch(() => undefined)
    await writeFile(join(this.options.cacheDir, 'fame.json'), JSON.stringify(this.fame), { encoding: 'utf8', mode: 0o600 }).catch(() => undefined)
  }

  /** A country item's ISO 3166-1 alpha-2 code (P297). */
  private async isoCode(qid: string): Promise<string | null> {
    const entity = (await this.entities([qid], 'en')).get(qid)
    const value = (entity?.claims?.['P297']?.[0] as { mainsnak?: { datavalue?: { value?: unknown } } } | undefined)?.mainsnak?.datavalue?.value
    return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : null
  }

  /** Follow sourced links back from a topic: cause, then "part of", then "follows", up to four steps. */
  private async pathBack(topic: WikidataEntity, topicNode: OldsNode, countryQid: string | null): Promise<OldsPathStep[]> {
    const steps: OldsPathStep[] = [{ node: topicNode, relation: '', edge: null }]
    const visited = new Set([topicNode.id, ...(countryQid ? [countryQid] : [])])
    let current = topic
    let currentNode = topicNode
    for (let depth = 0; depth < 4; depth += 1) {
      const drafts = edgesFromEntity(current)
      let next: { draft: DraftEdge; target: string; relation: string } | null = null
      for (const choice of PATH_PROPERTIES) {
        const draft = drafts.find((edge) => edge.property === choice.property && !visited.has(edge.from === current.id ? edge.to : edge.from))
        if (draft) {
          next = { draft, target: draft.from === current.id ? draft.to : draft.from, relation: choice.relation }
          break
        }
      }
      if (!next) break
      const entity = (await this.entities([next.target], 'en').catch(() => new Map<string, WikidataEntity>())).get(next.target)
      const node = entity ? nodeFromEntity(entity, 'en') : null
      if (!entity || !node) break
      // Only dated events and periods make a path; undated themes, calendar units and states end it.
      const classes = ((entity.claims?.['P31'] ?? []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>).map((claim) => claim.mainsnak?.datavalue?.value?.id)
      if (!node.start || classes.some((id) => id && NOT_A_TOPIC.has(id))) break
      visited.add(node.id)
      const title = titleFromWikipediaUrl(currentNode.wikipediaUrl)
      const text = title ? await this.articleText(title, 'en').catch(() => '') : ''
      const { citationDrafts, supportLevel, ...edge } = next.draft
      steps.push({
        node,
        relation: next.relation,
        edge: {
          ...edge,
          citations: resolveCitations(citationDrafts, new Map()),
          support: { level: supportLevel ?? 'unreferenced', corroborated: text ? mentions(text, node.label, currentNode.label) : null, checkedIn: text ? title : null },
        },
      })
      current = entity
      currentNode = node
    }
    return steps
  }

  // ---- Cache -------------------------------------------------------------

  private cachePath(key: string): string {
    return join(this.options.cacheDir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`)
  }

  private async readCache(key: string): Promise<OldsThread | null> {
    try {
      const info = await stat(this.cachePath(key))
      if (info.size > 2_000_000) return null
      const parsed = JSON.parse(await readFile(this.cachePath(key), 'utf8')) as OldsThread
      return parsed && typeof parsed.fetchedAt === 'string' && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) ? parsed : null
    } catch {
      return null
    }
  }

  private async writeCache(key: string, thread: OldsThread): Promise<void> {
    await mkdir(this.options.cacheDir, { recursive: true })
    await writeFile(this.cachePath(key), JSON.stringify(thread), { encoding: 'utf8', mode: 0o600 })
    const files = await readdir(this.options.cacheDir)
    if (files.length <= MAX_CACHE_FILES) return
    const dated = await Promise.all(files.map(async (name) => ({ name, at: (await stat(join(this.options.cacheDir, name)).catch(() => null))?.mtimeMs ?? 0 })))
    dated.sort((a, b) => a.at - b.at)
    for (const file of dated.slice(0, files.length - MAX_CACHE_FILES)) await rm(join(this.options.cacheDir, file.name), { force: true })
  }
}

/** Bump when thread contents change shape or selection (v2: history chapters, trivial-event filter; v3: source checks, summaries). */
/** Wikidata classes for broad places, whose whole history is too wide for one story. */
/** Below this Laya cosine, a dated sentence is not about the story (calibrated on the Olds sample sets). */
const CHRONICLE_MEANING_FLOOR = 0.3
const CURRENT_EVENTS_DAYS = 45
const CURRENT_EVENTS_TTL_MS = 3 * 60 * 60 * 1_000
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A Current events item as a dated step in "How we got here". */
function currentEventEntry(item: CurrentEventItem): OldsChronicleEntry {
  const [year, month, day] = item.date.split('-').map(Number) as [number, number, number]
  return {
    at: { iso: item.date, precision: 'day', label: `${day} ${SHORT_MONTHS[month - 1]} ${year}` },
    text: item.text,
    section: 'Wikipedia Current events',
    url: item.url,
    link: item.links.find((link) => !item.threads.includes(link)) ?? null,
  }
}

/**
 * The article's own dated events (the deeper past) with the thread's recent
 * steps from Current events, in time order: at most 8 recent steps and 12
 * article events (earliest and latest kept), with near-duplicates dropped.
 */
export function mergeChronicles(article: OldsChronicleEntry[], recent: OldsChronicleEntry[]): OldsChronicleEntry[] {
  const seen = new Set<string>()
  const fresh = (entry: OldsChronicleEntry): boolean => {
    const key = `${entry.at.iso.slice(0, 10)}:${entry.text.toLowerCase().replace(/[^\p{L}\d]+/gu, ' ').slice(0, 50)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
  // De-duplicate first, so a repeated item never costs a real step.
  const latest = [...recent].sort((a, b) => a.at.iso.localeCompare(b.at.iso)).filter(fresh).slice(-8)
  const background = article.filter(fresh)
  const older = background.length > 12 ? [...background.slice(0, 4), ...background.slice(-8)] : background
  return [...older, ...latest].sort((a, b) => a.at.iso.localeCompare(b.at.iso))
}

/** Where a topic is: its country (P17); else a person's citizenship (P27); else an institution's jurisdiction (P1001). */
function countriesOf(entity: WikidataEntity): string[] {
  const claim = (property: string): string[] => ((entity.claims?.[property] ?? []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>)
    .map((statement) => statement.mainsnak?.datavalue?.value?.id).filter((id): id is string => typeof id === 'string')
  for (const property of ['P17', 'P27', 'P1001']) {
    const found = claim(property)
    if (found.length) return found
  }
  return []
}

/** Subject word stems from a headline, leaving out the topic's own words ("South Africa" in "History of South Africa"). */
function focusStems(text: string, topicLabel: string): string[] {
  const topicWords = new Set(topicLabel.toLowerCase().split(/\s+/))
  return [...new Set([...properPhrases(cleanHeadline(text)).flatMap((phrase) => phrase.split(/\s+/)), ...subjectTerms(text).flatMap((term) => term.split(' '))]
    .map((word) => word.toLowerCase().replace(/[’']s$/, ''))
    .filter((word) => word.length >= 4 && !topicWords.has(word))
    .map((word) => word.slice(0, 5)))].slice(0, 8)
}

/** The headline without the countries it names (and their adjectives: "South African", "German"). */
export function withoutCountryNames(text: string, extra?: string | null): string {
  // Expand "US", "UK" first, as matching does, so they are removed too.
  // Accents folded: a country is removed under any of its names ("Côte d’Ivoire" as well as "Ivory Coast").
  const plain = foldAccents(cleanHeadline(text).replace(/[’']s\b/g, ''))
  const countries = placesNamedIn(plain, 6).filter((place) => place.kind === 'country')
  const names = [...countries.flatMap((place) => [place.name, ...placeNames(place.id)]), ...(extra ? [extra] : [])].map((name) => foldAccents(name))
  const stems = [...new Set(names.flatMap((name) => name.split(/\s+/)).filter((word) => word.length >= 4).map((word) => word.slice(0, Math.min(5, word.length - 1))))]
  if (!stems.length) return plain
  // "Russia-Ukraine ceasefire" → "ceasefire", not " - ceasefire" (which would read as an outlet suffix).
  return plain.replace(new RegExp(`\\b(${stems.map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\p{L}*`, 'giu'), ' ').replace(/\s*[-–—]\s*(?=\s|$)/g, ' ').replace(/(^|\s)[-–—]\s*/g, ' ')
}

/** A description whose head noun is a work or a thing, not a topic: "1991 British television series", "species of tree", "2026 documentary film". */
export function isWorkOrThing(description: string | null | undefined, aboutAWork = false): boolean {
  if (!description) return false
  // A story about a film or game may be about the work itself, never about a food or a coin.
  if (aboutAWork) return isThing(description)
  // Plants and trees are things; dinosaurs and viruses can be news ("Nanotyrannus").
  if (/\b(species|genus|cultivar|variety) of (tree|plant|flowering plant|shrub|grass|herb|fungus|palm|cactus)\b/i.test(description)) return true
  const head = description.toLowerCase().replace(/\s+(by|directed|written|starring|from|produced|created|released|launched|issued|named|associated|owned|based|bearing|with|that|which|used|about|featuring|for|in|of|on)\b.*$/, '').replace(/,.*$/, '').trim()
  return /\b(film|movie|documentary|album|song|single|novel|book|(television|tv|drama|comedy|web|animated|anime|reality)( drama| comedy)? series|miniseries|sitcom|episode|video game|band|musical|opera|painting|comic|manga|anime|cultivar|dish|food|snack|nut|drink|beverage|brand|character|surname|given name|family name|name|coin|meme coin|memecoin|cryptocurrency|token|phrase|slogan|idiom|catchphrase|expression|proverb)$/.test(head)
}

/** Common European languages by their function words, for headlines whose feed gave no language. */
export function guessLanguage(text: string): string | null {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
  if (words.length < 4) return null
  const markers: Record<string, string[]> = {
    es: ['el', 'la', 'los', 'las', 'del', 'que', 'por', 'para', 'con', 'una', 'ante', 'sus', 'según', 'también'],
    pt: ['o', 'os', 'as', 'do', 'da', 'dos', 'das', 'que', 'para', 'com', 'uma', 'não', 'pelo', 'pela', 'em'],
    fr: ['le', 'les', 'des', 'du', 'au', 'aux', 'est', 'une', 'pour', 'avec', 'sur', 'dans', 'qui', 'et'],
    de: ['der', 'die', 'das', 'den', 'dem', 'und', 'mit', 'für', 'auf', 'ist', 'nicht', 'eine', 'nach', 'vom'],
    it: ['il', 'gli', 'della', 'delle', 'del', 'che', 'per', 'con', 'una', 'nel', 'sono', 'alla'],
    nl: ['het', 'een', 'van', 'voor', 'met', 'op', 'niet', 'naar', 'bij', 'zijn', 'wordt'],
  }
  const english = new Set(['the', 'of', 'and', 'to', 'in', 'for', 'on', 'with', 'is', 'as', 'at', 'by', 'from', 'after', 'over'])
  const englishHits = words.filter((word) => english.has(word)).length
  let best: { code: string; hits: number } | null = null
  for (const [code, list] of Object.entries(markers)) {
    const hits = words.filter((word) => list.includes(word)).length
    if (hits >= 2 && hits > englishHits && (!best || hits > best.hits)) best = { code, hits }
  }
  return best?.code ?? null
}

const STOPWORDS_FOR_CONCEPTS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'over', 'after', 'about', 'says', 'said', 'will', 'would', 'could', 'should', 'have', 'has', 'had', 'are', 'was', 'were', 'been', 'being', 'this', 'that', 'than', 'then', 'its', 'their', 'his', 'her', 'our', 'your', 'new', 'more', 'most', 'amid', 'against', 'during', 'while', 'what', 'why', 'how', 'who', 'when'])

/** Things (foods, coins, names, phrases), as opposed to works. */
function isThing(description: string): boolean {
  if (/\b(species|genus|cultivar|variety) of (tree|plant|flowering plant|shrub|grass|herb|fungus|palm|cactus)\b/i.test(description)) return true
  const head = description.toLowerCase().replace(/\s+(by|directed|written|starring|from|produced|created|released|launched|issued|named|associated|owned|based|bearing|with|that|which|used|about|featuring|for|in|of|on)\b.*$/, '').replace(/,.*$/, '').trim()
  return /\b(cultivar|dish|food|snack|nut|drink|beverage|surname|given name|family name|name|coin|meme coin|memecoin|cryptocurrency|token|phrase|slogan|idiom|catchphrase|expression|proverb)$/.test(head)
}

/** Names of the countries a text names (see headlineCountries). */
function namedCountryNames(text: string): string[] {
  const codes = new Set(headlineCountries(text))
  const plain = cleanHeadline(text).replace(REGIONS_NOT_COUNTRIES, '')
  return [...new Set(placesNamedIn(plain, 6).filter((place) => place.kind === 'country' && codes.has(place.countryCode)).map((place) => place.name))]
}

/** Headlines about something still to come. */
const UPCOMING = /\b(to (perform|headline|host|play|stage|hold|open|launch|face|meet|visit|run)|will|set to|plans? to|next|upcoming|ahead of|announced as|named as|to be held)\b/i

/** Regions whose names contain a country's ("Latin America", "América Latina"), removed before looking for countries. */
const REGIONS_NOT_COUNTRIES = /\b(Latin|South|North|Central) America\b|\bAm[eé]rica (Latina|del Sur|del Norte|Central|do Sul|do Norte)\b|\b(Latinoam[eé]rica|Sudam[eé]rica|Centroam[eé]rica|Norteam[eé]rica)\b/giu

/** Words that say a headline is about a work: then a film, game or book is a fair topic. */
const WORK_WORDS = /\b(film|films|movie|movies|documentary|series|sitcom|episode|season finale|trailer|premiere[sd]?|box office|album|song|single|novel|book|memoir|video game|game|sequel|remake|soundtrack|musical|opera|exhibition|painting)\b/i

const FIRST_NAME_COUNTRIES = new Set(['Jordan', 'Chad', 'Georgia', 'India', 'Israel', 'Kenya', 'Niger', 'Chile', 'Cuba', 'Mali', 'Peru', 'Togo'])

/** Countries a text names, in order ("Brazil’s" → BR; "Latin America" is a region, not the United States). */
/** Capitals used for their government ("Beijing’s soft power", "Moscow says"): the country whose capital is named. */
export function capitalCountries(raw: string): string[] {
  const text = cleanHeadline(raw).replace(/[’']s\b/g, '')
  const out: string[] = []
  for (const place of placesNamedIn(text, 4)) {
    // Beijing and Moscow are also first-level regions; a region centred on the capital counts too.
    if (place.kind === 'country') continue
    const row = COUNTRY_ROWS.find((country) => country[0] === place.countryCode)
    if (!row) continue
    // The bundled country coordinates are the capital's.
    const km = Math.hypot((place.lat - row[2]) * 111, (place.lon - row[3]) * 111 * Math.cos((row[2] * Math.PI) / 180))
    if (km <= 40 && !out.includes(row[0])) out.push(row[0])
  }
  return out
}

export function headlineCountries(raw: string): string[] {
  const text = cleanHeadline(raw)
  const found = countriesByName(text)
  return found.length ? found : countriesByAdjective(text)
}

/** "Ukrainian City of Oleshky" → UA; "Brazilian", "Israeli", "Chinese". Short stems ("Indian": Ocean or India?) are skipped. */
export function countriesByAdjective(text: string): string[] {
  const out: string[] = []
  for (const word of text.split(/[^\p{L}]+/u)) {
    if (!/^\p{Lu}/u.test(word)) continue
    const stem = word.replace(/(?<=i)s$/, '').replace(/(ian|ean|an|ese|ish|i)$/, '') // "Israelis" → "Israel"
    if (stem.length < 4 || stem === word) continue
    // A one-word name or alias ("Palestinian" → "Palestine", an alias of the Palestinian Territory).
    const lower = stem.toLowerCase()
    const row = COUNTRY_ROWS.find((country) => country[1] !== word && country[1].startsWith(stem) && country[1].split(' ').length === 1)
      ?? COUNTRY_ROWS.find((country) => placeNames(`country:${country[0]}`).some((name) => !name.includes(' ') && name.startsWith(lower) && name !== word.toLowerCase()))
    if (row && !out.includes(row[0])) out.push(row[0])
  }
  return out
}

function countriesByName(text: string): string[] {
  // "North and South Korea" → North Korea and South Korea.
  const expanded = text.replace(/\b(\p{Lu}\p{Ll}+) (and|&|or) (\p{Lu}\p{Ll}+) (\p{Lu}\p{Ll}+)\b/gu, (all, a: string, joiner: string, b: string, name: string) =>
    COUNTRY_ROWS.some((row) => row[1] === `${a} ${name}`) && COUNTRY_ROWS.some((row) => row[1] === `${b} ${name}`) ? `${a} ${name} ${joiner} ${b} ${name}` : all)
  const plain = expanded.replace(/[’']s\b/g, '').replace(REGIONS_NOT_COUNTRIES, '')
  // Countries that are also first names: followed by another capitalised word in a sentence-case headline, it's a person ("Jordan Peterson").
  const words = plain.split(/\s+/).filter((word) => word.length > 3)
  const titleCase = words.filter((word) => /^\p{Lu}/u.test(word)).length > words.length * 0.75
  const isPersonName = (name: string): boolean => FIRST_NAME_COUNTRIES.has(name) && !titleCase && new RegExp(`\\b${name}\\s+\\p{Lu}\\p{Ll}`, 'u').test(text)
  return [...new Set(placesNamedIn(plain, 6).filter((place) => place.kind === 'country' && !isPersonName(place.name)).map((place) => place.countryCode))]
}

const BROAD_CLASSES = new Set(['Q6256', 'Q3624078', 'Q5107', 'Q82794', 'Q35657', 'Q10864048', 'Q1620908', 'Q15642541', 'Q7275', 'Q3336843', 'Q11828004', 'Q107390', 'Q34876', 'Q515'])

const CACHE_VERSION = 'v19'

function cacheKey(query: OldsQuery): string {
  return `${CACHE_VERSION}|${rawCacheKey(query)}`
}

function rawCacheKey(query: OldsQuery): string {
  if (query.kind === 'wikipedia') return `wikipedia|${query.lang ?? 'en'}|${query.title.replace(/_/g, ' ').toLowerCase()}`
  if (query.kind === 'qid') return `qid|${query.qid}`
  if (query.kind === 'chapter') return `chapter|${query.article.toLowerCase()}|${query.section.toLowerCase()}`
  if (query.kind === 'headline') return `headline|${query.lang ?? 'en'}|${query.countryCode ?? ''}|${query.topic ?? ''}|${query.place ?? ''}|${query.text.toLowerCase()}`
  return `country|${query.countryCode}`
}

function titleFromWikipediaUrl(url: string | null): string | null {
  const match = url?.match(/\/wiki\/(.+)$/)
  return match ? decodeURIComponent(match[1]!).replace(/_/g, ' ') : null
}

function yearNumber(date: { iso: string } | null): number | null {
  const match = date?.iso.match(/^(-?\d{1,6})/)
  return match ? Number(match[1]) : null
}

function qidFromUri(value: string | undefined): string | null {
  const id = value?.match(/\/entity\/(Q\d+)$/)?.[1]
  return isQid(id) ? id : null
}

/** Events that say little about one place's history (see TRIVIAL_CLASSES). */
export function isTrivialHere(entity: WikidataEntity): boolean {
  const ids = (property: string): string[] => ((entity.claims?.[property] ?? []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>)
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter((id): id is string => typeof id === 'string')
  if (new Set(ids('P17')).size >= 3) return true
  return ids('P31').some((id) => TRIVIAL_CLASSES.has(id))
}

/** The history article could not be fetched right now (network or rate limit), as opposed to not existing. */
class HistoryUnavailable extends Error {}
