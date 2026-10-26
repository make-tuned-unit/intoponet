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
import { edgesFromEntity, nodeFromEntity, resolveCitations, statedInIds, type DraftEdge, type WikidataEntity } from './wikidata'

const USER_AGENT = 'Intoponet/0.1 (+https://github.com/make-tuned-unit/intoponet; The Olds)'
const TIMEOUT_MS = 15_000
const TTL_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_CACHE_FILES = 300
const MAX_MEMORY = 100
const ENTITY_BATCH = 50
const COUNTRY_EVENTS = 30

export type OldsServiceOptions = { cacheDir: string; fetchImpl?: typeof fetch; now?: () => number }

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
      : await this.itemThread(query.kind === 'qid' ? query.qid : await this.resolveTitle(query.title, lang), lang)
    this.remember(key, thread)
    await this.writeCache(key, thread).catch(() => undefined)
    return thread
  }

  private remember(key: string, thread: OldsThread): void {
    this.memory.delete(key)
    this.memory.set(key, thread)
    while (this.memory.size > MAX_MEMORY) this.memory.delete(this.memory.keys().next().value!)
  }

  // ---- Network -----------------------------------------------------------

  private async getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/sparql-results+json, application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if ((response.status === 429 || response.status === 503) && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(10, retryAfter) * 1_000 : 1_000 * 3 ** attempt
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
    return this.assemble(rootNode, drafts, 'en')
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
    for (const id of neighbourIds) {
      const entity = lookups.get(id)
      const node = entity ? nodeFromEntity(entity, lang) : null
      if (node) nodes.set(id, node)
    }
    const statedIn = new Map<string, OldsNode>()
    for (const [id, entity] of lookups) {
      const node = nodeFromEntity(entity, lang)
      if (node) statedIn.set(id, node)
    }
    const edges: OldsEdge[] = kept
      .filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
      .map(({ citationDrafts, ...edge }) => ({ ...edge, citations: resolveCitations(citationDrafts, statedIn) }))
    return {
      rootId: rootNode.id,
      nodes: [...nodes.values()],
      edges,
      fetchedAt: new Date(this.now()).toISOString(),
      attribution: OLDS_ATTRIBUTION,
      note: OLDS_NOTE,
    }
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

function cacheKey(query: OldsQuery): string {
  if (query.kind === 'wikipedia') return `wikipedia|${query.lang ?? 'en'}|${query.title.replace(/_/g, ' ').toLowerCase()}`
  if (query.kind === 'qid') return `qid|${query.qid}`
  return `country|${query.countryCode}`
}

function qidFromUri(value: string | undefined): string | null {
  const id = value?.match(/\/entity\/(Q\d+)$/)?.[1]
  return isQid(id) ? id : null
}
