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
import { cleanHeadline, foreignNamesIn, mentions, NOT_A_TOPIC, PATH_PROPERTIES, scoreCandidate, searchQueries, titleWordsIn } from './headline'

const USER_AGENT = 'Intoponet/0.1 (+https://github.com/make-tuned-unit/intoponet; The Olds)'
const TIMEOUT_MS = 15_000
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
      const response = await this.fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/sparql-results+json, application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
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
    return {
      rootId: rootNode.id,
      nodes: [...nodes.values()],
      edges,
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

  private async search(lang: string, query: string, limit: number): Promise<string[]> {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), srnamespace: '0', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString(), 8_000) as { query?: { search?: Array<{ title?: unknown }> } }
    return (payload.query?.search ?? []).map((hit) => hit.title).filter((title): title is string => typeof title === 'string')
  }

  /** Titles → Wikidata ids on one wiki, noting disambiguation pages. */
  private async titleItems(lang: string, titles: string[]): Promise<Map<string, { qid: string; disambiguation: boolean }>> {
    const out = new Map<string, { qid: string; disambiguation: boolean }>()
    if (!titles.length) return out
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item|disambiguation', titles: titles.slice(0, 40).join('|'), redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await this.getJson(url.toString()) as { query?: { pages?: Array<{ title?: string; pageprops?: { wikibase_item?: unknown; disambiguation?: unknown } }> } }
    for (const page of payload.query?.pages ?? []) {
      const qid = page.pageprops?.wikibase_item
      if (page.title && isQid(qid)) out.set(page.title, { qid, disambiguation: page.pageprops?.disambiguation !== undefined })
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
    let lang = query.lang && query.lang !== 'en' ? query.lang : 'en'
    let translated = false
    if (lang !== 'en' && this.options.translateToEnglish) {
      const english = await this.options.translateToEnglish(query.text, lang).catch(() => null)
      if (english && english.trim()) {
        text = english
        lang = 'en'
        translated = true
      }
    }
    const ranked: string[] = []
    const queries = searchQueries(text)
    for (const q of queries) {
      if (ranked.length >= 10) break
      const titles = await this.search(lang, q, 8).catch(() => [])
      for (const title of titles) if (!ranked.includes(title)) ranked.push(title)
    }
    const items = await this.titleItems(lang, ranked).catch(() => new Map<string, { qid: string; disambiguation: boolean }>())
    const countryQid = query.countryCode ? await this.countryQid(query.countryCode).catch(() => null) : null
    const qids = [...new Set([...items.values()].map((item) => item.qid))]
    const entities = await this.entities([...qids, ...(query.topic ? [query.topic] : [])], 'en')
    const ids = (entity: WikidataEntity | undefined, property: string): string[] => ((entity?.claims?.[property] ?? []) as Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>)
      .map((claim) => claim.mainsnak?.datavalue?.value?.id).filter((id): id is string => typeof id === 'string')
    const scored = ranked.flatMap((title, rank) => {
      const item = items.get(title)
      const entity = item ? entities.get(item.qid) : undefined
      if (!item || !entity || ids(entity, 'P31').some((id) => NOT_A_TOPIC.has(id))) return []
      const node = nodeFromEntity(entity, 'en')
      if (!node) return []
      const score = scoreCandidate({
        rank,
        eventLike: isEventLike(entity),
        inCountry: !!countryQid && (ids(entity, 'P17').includes(countryQid) || ids(entity, 'P276').includes(countryQid)),
        isPerson: ids(entity, 'P31').includes('Q5'),
        isCountry: item.qid === countryQid || ids(entity, 'P31').some((id) => ['Q6256', 'Q3624078', 'Q7275', 'Q3024240', 'Q1763527', 'Q417175'].includes(id)),
        isDisambiguation: item.disambiguation,
        titleWordsInHeadline: titleWordsIn(node.label, text),
        foreignNames: foreignNamesIn(node.label, text),
        otherCountry: !!countryQid && ids(entity, 'P17').length > 0 && !ids(entity, 'P17').includes(countryQid),
      })
      return Number.isFinite(score) ? [{ id: item.qid, node, score, entity }] : []
    }).sort((a, b) => b.score - a.score)
    const unique = scored.filter((candidate, index) => scored.findIndex((other) => other.id === candidate.id) === index)
    const chosen = query.topic ? { id: query.topic, entity: entities.get(query.topic), node: entities.get(query.topic) ? nodeFromEntity(entities.get(query.topic)!, 'en') : null } : unique[0]
    if (!chosen?.entity || !chosen.node) {
      // No topic: still place the story in its country's history, and say why.
      if (!query.countryCode) throw new Error('No Wikipedia topic matched this headline.')
      const country = await this.thread({ kind: 'country', countryCode: query.countryCode })
      const year = new Date(this.now()).getUTCFullYear()
      const root = country.nodes.find((node) => node.id === country.rootId)!
      return {
        ...country,
        context: {
          headline: cleanHeadline(query.text),
          topicId: country.rootId,
          candidates: [],
          path: [{ node: root, relation: '', edge: null }],
          chapter: country.chapters ? chapterForYear(country.chapters, year, year) : null,
          chapterSource: country.chaptersSource ?? null,
          matchedBy: `No Wikipedia topic matched this headline${lang !== 'en' ? ` in ${lang} Wikipedia; add this language under Languages so headlines can be translated on this Mac first` : ''}. Showing the history of ${root.label} instead.`,
        },
      }
    }

    const thread = await this.itemThread(chosen.id, 'en')
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
      headline: cleanHeadline(query.text),
      topicId: chosen.id,
      candidates: unique.filter((candidate) => candidate.id !== chosen.id).slice(0, 4).map((candidate) => ({ id: candidate.id, label: candidate.node.label, description: candidate.node.description })),
      path,
      chapter,
      chapterSource,
      matchedBy: query.topic
        ? 'You chose this topic.'
        : lang === 'en'
          ? `Best match among English Wikipedia search results for the headline's words${translated ? ' (translated on this Mac)' : ''}${countryQid ? ', preferring topics in this country' : ''}.`
          : `Matched in ${lang} Wikipedia without translation, so this may be off. Add this language under Languages and headlines are translated on this Mac before matching.`,
    }
    return { ...thread, context }
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
const CACHE_VERSION = 'v6'

function cacheKey(query: OldsQuery): string {
  return `${CACHE_VERSION}|${rawCacheKey(query)}`
}

function rawCacheKey(query: OldsQuery): string {
  if (query.kind === 'wikipedia') return `wikipedia|${query.lang ?? 'en'}|${query.title.replace(/_/g, ' ').toLowerCase()}`
  if (query.kind === 'qid') return `qid|${query.qid}`
  if (query.kind === 'chapter') return `chapter|${query.article.toLowerCase()}|${query.section.toLowerCase()}`
  if (query.kind === 'headline') return `headline|${query.lang ?? 'en'}|${query.countryCode ?? ''}|${query.topic ?? ''}|${query.text.toLowerCase()}`
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
