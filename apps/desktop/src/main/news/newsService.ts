import type { PlaceQuery, PlaceTrends } from '../../shared/news/placeTrends'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeEntities } from '../articlePreview'
import type { PublicItem } from '@intoponet/field-snapshot'
import { createAtomicFeedStorage, FeedFetchService, type FeedRegistry, type FeedRegistrySource } from '../feed-service'
import { addCoverage, NEWS_COVERAGE_TOLERANCE_MS, parseNewsDigest, type CoverageIntervals, type NewsFeedHealth, type NewsItemInput, type NewsSourceMeta } from '../../shared/news/newsDigest'
import type { FeedFetchResult } from '../feed-service'
import newsFeeds from './newsFeeds.json'
import internationalFeeds from './internationalFeeds.json'
import { inlineDigestBuilder, NeedsFullUpdate, type DigestBuilder, type DigestOutput, type DigestUpdate } from './digestBuild'
import { fetchInTheNews } from './inTheNews'
import { localPlaceNames } from './placeNames'
import type { WikiNewsItem } from '../../shared/news/newsDigest'

/** One verified local news feed (see docs/data/news-feeds.md for provenance). */
export type NewsFeedEntry = {
  sourceId: string
  countryCode: string
  url: string
  format: 'rss' | 'atom'
  publisherName: string
  publisherType: string
  section: string
  languageTags: string[]
  geographicScope: 'national' | 'regional' | 'local' | 'international'
  regionName: string | null
  cityName: string | null
  independentPublisherGroupId: string
  termsUrl: string | null
}

/** Only headline, link, id and publish time are kept; bodies and media never are. */
const APPROVED_FIELDS = ['title', 'canonicalItemUrl', 'guid', 'publishedAt']
const POLL_SECONDS = 20 * 60
/** Four days, so the 24 h and previous-24 h windows stay comparable across restarts. */
const RETENTION_DAYS = 4
const COVERAGE_KEEP_MS = 4 * 24 * 60 * 60 * 1000
const COVERAGE_SCHEMA_VERSION = 2
const MAX_COVERAGE_CONTINUITY_MS = Math.max(POLL_SECONDS * 3 * 1_000, NEWS_COVERAGE_TOLERANCE_MS)
const DIGEST_DEBOUNCE_MS = 4_000
const DIGEST_REFRESH_MS = 60_000

/** Record only continuous successful observation; an RSS item's publication date is not a fetch observation. */
export function observeNewsCoverage(
  result: Pick<FeedFetchResult, 'sourceId' | 'status' | 'persistenceAllowed'>,
  coverage: CoverageIntervals,
  lastFetch: Map<string, number>,
  now = Date.now(),
): void {
  const sourceId = result.sourceId
  const previousFetch = lastFetch.get(sourceId)
  if ((previousFetch !== undefined && now < previousFetch) || (coverage[sourceId] ?? []).some(([, end]) => end > now)) {
    // Wall-clock rollback invalidates future-dated observation spans.
    coverage[sourceId] = []
    lastFetch.delete(sourceId)
  }
  if (!result.persistenceAllowed || result.status === 'error') {
    lastFetch.delete(sourceId)
    if (!result.persistenceAllowed) coverage[sourceId] = []
    return
  }
  if (result.status !== 'updated' && result.status !== 'not-modified') return

  // A 200 refresh can contain old stories without proving the service observed
  // that whole period. Start at the prior successful poll, or at this poll when
  // continuity is unknown (including after an app restart or a failed request).
  const prior = lastFetch.get(sourceId)
  const start = prior !== undefined && now - prior <= MAX_COVERAGE_CONTINUITY_MS
    ? prior
    : now
  lastFetch.set(sourceId, now)
  coverage[sourceId] = addCoverage(coverage[sourceId] ?? [], [start, now], now - COVERAGE_KEEP_MS)
}

export function newsFeedEntries(): NewsFeedEntry[] {
  const seen = new Set<string>()
  // International desks first: they are few, and world stories depend on them.
  return ([...internationalFeeds.feeds, ...newsFeeds.feeds] as NewsFeedEntry[]).filter((feed) => {
    if (seen.has(feed.sourceId)) return false
    seen.add(feed.sourceId)
    return true
  })
}

/**
 * Fetch order: international desks, then one feed per country in turn, so every
 * country has some coverage within the first minute instead of the alphabet's
 * first few (the US was ~2,800th, over four minutes into a cold start).
 */
export function fetchOrder(feeds: NewsFeedEntry[]): NewsFeedEntry[] {
  const desks = feeds.filter((feed) => feed.geographicScope === 'international')
  const byCountry = new Map<string, NewsFeedEntry[]>()
  for (const feed of feeds) {
    if (feed.geographicScope === 'international') continue
    const list = byCountry.get(feed.countryCode)
    if (list) list.push(feed)
    else byCountry.set(feed.countryCode, [feed])
  }
  // National desks lead each country's turn: they carry the stories the whole country is reading.
  const queues = [...byCountry.values()].map((list) => [...list.filter((feed) => feed.geographicScope === 'national'), ...list.filter((feed) => feed.geographicScope !== 'national')])
  const result = [...desks]
  for (let i = 0; result.length < feeds.length; i += 1) {
    let added = false
    for (const queue of queues) {
      if (queue[i]) { result.push(queue[i]!); added = true }
    }
    if (!added) break
  }
  return result
}

export function newsRegistry(feeds: NewsFeedEntry[]): FeedRegistry {
  const sources: FeedRegistrySource[] = fetchOrder(feeds).map((feed) => ({
    sourceId: feed.sourceId,
    kind: feed.format,
    url: feed.url,
    publisherName: feed.publisherName,
    languageTags: feed.languageTags.length ? feed.languageTags : ['und'],
    candidateState: 'admitted-enabled',
    licenseStatus: 'approved',
    approvedFields: APPROVED_FIELDS,
    proposedPollingMinSeconds: POLL_SECONDS,
    activePollingMinSeconds: POLL_SECONDS,
    retentionDays: RETENTION_DAYS,
  }))
  return { enabledSourceIds: sources.map((source) => source.sourceId), sources }
}

export function newsSourceMeta(feeds: NewsFeedEntry[]): NewsSourceMeta[] {
  return feeds.map((feed) => ({
    sourceId: feed.sourceId,
    countryCode: feed.countryCode,
    publisherName: feed.publisherName,
    publisherGroupId: feed.independentPublisherGroupId,
    scope: feed.geographicScope,
    cityName: feed.cityName,
    regionName: feed.regionName,
    language: feed.languageTags[0] ?? null,
  }))
}

/**
 * Polls every registered local news feed and publishes a digest of what each
 * country's outlets are reporting. Runs in the main process; nothing personal
 * is sent, and the renderer only ever receives the validated digest.
 */
export function startNewsService(options: { userData: string; emit: (payload: string) => void; digestBuilder?: DigestBuilder }): { stop: () => Promise<void>; latest: () => string | null; trends: (place: PlaceQuery & { geonameId?: string }) => Promise<PlaceTrends>; retryOffline: () => void } {
  const feeds = newsFeedEntries()
  const meta = newsSourceMeta(feeds)
  const digestPath = join(options.userData, 'news-digest.json')
  // Atomic writes interrupted by a quit leave `<file>.<uuid>.tmp` behind; tidy any older than an hour.
  try {
    for (const name of readdirSync(options.userData)) {
      if (!/^news-feed-cache\.json\.[0-9a-f-]{36}\.tmp$/.test(name)) continue
      const path = join(options.userData, name)
      if (Date.now() - statSync(path).mtimeMs > 3_600_000) rmSync(path, { force: true })
    }
  } catch {
    // Best effort only.
  }
  let latest: string | null = null
  latest = readCachedNewsDigest(digestPath)
  if (latest) options.emit(latest)
  if (!feeds.length) return { stop: async () => undefined, latest: () => latest, retryOffline: () => undefined, trends: async () => ({ rising: [], fading: [], recentStories: 0, previousStories: 0, outlets: 0, uncompared: 0, latest: [], earlier: [] }) }

  const builder = options.digestBuilder ?? inlineDigestBuilder()
  // The items array last sent for each feed (feeds replace the array whenever their items change).
  const sent = new Map<string, readonly PublicItem[]>()
  let stopped = false
  let building = false
  let digestTimer: ReturnType<typeof setTimeout> | null = null
  let lastBuildMs = 0
  const startedAt = Date.now()
  // Wikipedia's "In the news", refreshed every two hours.
  let inTheNews: WikiNewsItem[] = []
  const refreshInTheNews = (): void => {
    void fetchInTheNews(new Date()).then((items) => {
      if (!items.length) return
      inTheNews = items
      scheduleDigest()
    }).catch(() => undefined)
  }
  refreshInTheNews()
  const inTheNewsTimer = setInterval(refreshInTheNews, 2 * 3_600_000)
  inTheNewsTimer.unref?.()
  const transient = new Map<string, PublicItem[]>()
  const coveragePath = join(options.userData, 'news-coverage.json')
  const coverage: CoverageIntervals = readCoverage(coveragePath, new Set(feeds.map((feed) => feed.sourceId)))
  const lastFetch = new Map<string, number>()
  const observe = (result: FeedFetchResult): void => {
    observeNewsCoverage(result, coverage, lastFetch)
  }
  const service = new FeedFetchService({
    registry: newsRegistry(feeds),
    storage: createAtomicFeedStorage(join(options.userData, 'news-feed-cache.json'), 192 * 1024 * 1024),
    maxEnabledSources: 6_000,
    maxConcurrency: 20,
    maxCacheBytes: 192 * 1024 * 1024,
    // Saving serializes the whole cache (~35 MB) on this thread; it is only a restart cache and is flushed on quit.
    persistDebounceMs: 60_000,
    tolerant: true,
    onResult: (result) => {
      // no-store feeds: keep their latest headlines in memory only, never on disk.
      if (!result.persistenceAllowed && result.status === 'updated') transient.set(result.sourceId, result.receivedItems)
      else if (!result.persistenceAllowed) transient.delete(result.sourceId)
      else if (result.persistenceAllowed && result.status === 'updated') transient.delete(result.sourceId)
      observe(result)
      scheduleDigest()
    },
  })

  const toInput = (sourceId: string, item: PublicItem): NewsItemInput => ({
    // Some feeds encode their titles twice ("Iran&#039;s IRGC…"): what is left after parsing is decoded here.
    sourceId, title: /&(#\d+|#x[\da-f]+|[a-z]+);/i.test(item.title) ? decodeEntities(item.title) : item.title, url: item.canonicalUrl, publishedAt: item.publishedAt, discoveredAt: item.discoveredAt,
  })
  /** What changed since the last build (everything when `full`). */
  const update = async (full: boolean): Promise<DigestUpdate> => {
    if (full) sent.clear()
    const sources = await service.liveSources()
    const changed: Record<string, NewsItemInput[]> = {}
    const health: Record<string, NewsFeedHealth> = {}
    for (const [sourceId, state] of Object.entries(sources)) {
      health[sourceId] = state.health
      if (sent.get(sourceId) === state.items) continue
      sent.set(sourceId, state.items)
      changed[sourceId] = state.items.map((item) => toInput(sourceId, item))
    }
    const memoryOnly = [...transient.entries()].flatMap(([sourceId, items]) => items.map((item) => toInput(sourceId, item)))
    return { full, schemaVersion: COVERAGE_SCHEMA_VERSION, ...(full ? { sources: meta } : {}), changed, memoryOnly, health, coverage, inTheNews, now: Date.now() }
  }
  /** Build on the worker thread (the main process stays responsive), sending a full update if it lost its state. */
  const buildDigest = async (): Promise<DigestOutput> => {
    try {
      return await builder.build(await update(sent.size === 0))
    } catch (error) {
      if (!(error instanceof NeedsFullUpdate)) throw error
      return builder.build(await update(true))
    }
  }

  const publish = async (): Promise<void> => {
    const coverageJson = JSON.stringify({ schemaVersion: COVERAGE_SCHEMA_VERSION, sources: coverage })
    const output = await buildDigest()
    if (stopped) return
    latest = output.latest
    options.emit(latest)
    lastBuildMs = output.ms
    if (process.env.INTOPONET_DEBUG_NEWS) console.log(`[news] digest ${Math.round(output.ms)} ms, ${output.items} items, ${Math.round(output.latest.length / 1024)} KB`)
    // The on-disk copy (shown at the next launch) excludes no-store feeds.
    await Promise.all([
      writeFile(digestPath, output.disk ?? output.latest, { encoding: 'utf8', mode: 0o644 }),
      writeFile(coveragePath, coverageJson, { encoding: 'utf8', mode: 0o644 }),
    ]).catch(() => undefined) // rebuilt from the feed cache on the next update
  }

  function scheduleDigest(): void {
    if (digestTimer) return
    digestTimer = setTimeout(() => {
      digestTimer = null
      // One build at a time; results arriving meanwhile are picked up by the next one.
      if (building) return scheduleDigest()
      building = true
      void publish().catch((error: unknown) => {
        if (!stopped) console.error('News digest failed.', error instanceof Error ? error.message : error)
      }).finally(() => { building = false })
    // The first digest comes quickly. After that, rebuild at most once a minute: feeds arrive every
    // fraction of a second while polling, and each build (a few seconds of worker CPU) also restarts
    // the globe's terrain transition.
    // While the first pass over every feed is still arriving (about five minutes), every 20 s.
    }, latest && lastBuildMs ? Math.max(Date.now() - startedAt < 5 * 60_000 ? 20_000 : DIGEST_REFRESH_MS, lastBuildMs * 3) : DIGEST_DEBOUNCE_MS)
    digestTimer.unref?.()
  }

  void service.start().then(() => scheduleDigest()).catch((error: unknown) => {
    console.error('News feeds could not start.', error instanceof Error ? error.message : error)
  })

  return {
    stop: () => {
      stopped = true
      builder.close()
      if (digestTimer) clearTimeout(digestTimer)
      clearInterval(inTheNewsTimer)
      service.stop()
      // Quitting waits for this (see before-quit): an unsaved cache means the next launch starts from nothing.
      return service.flush()
    },
    latest: () => latest,
    /** Back online (or awake): feeds that failed for want of a network are fetched now, and In the news with them. */
    retryOffline: () => {
      if (stopped) return
      if (service.retryNetworkFailures() > 0 && !inTheNews.length) refreshInTheNews()
    },
    /** What is rising and fading in one place's news, from the latest feeds. */
    trends: async ({ geonameId, ...place }: PlaceQuery & { geonameId?: string }): Promise<PlaceTrends> => {
      // A city is also named in its outlets' own languages ("Roma", "Bruxelles"); found once, then cached.
      const languages = [...new Set(meta.filter((source) => source.countryCode === place.countryCode && source.language).map((source) => source.language!))]
      const local = place.name && geonameId ? await localPlaceNames(geonameId, languages).catch(() => []) : []
      const aliases = [...new Set([...(place.aliases ?? []), ...local])].filter((alias) => alias !== place.name)
      const query = { ...place, ...(aliases.length ? { aliases } : {}) }
      try {
        return await builder.trends(query, Date.now())
      } catch (error) {
        if (!(error instanceof NeedsFullUpdate)) throw error
        await buildDigest()
        return builder.trends(query, Date.now())
      }
    },
  }
}

/** Cached trends are emitted only when their observation-provenance version is current. */
export function readCachedNewsDigest(path: string, now = Date.now()): string | null {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf8')
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    if ((value as Record<string, unknown>)['coverageSchemaVersion'] !== COVERAGE_SCHEMA_VERSION) return null
    const digest = parseNewsDigest(raw)
    if (!digest) return null
    const generatedAt = Date.parse(digest.generatedAt)
    if (!Number.isFinite(generatedAt) || generatedAt > now + 60_000 || now - generatedAt > NEWS_COVERAGE_TOLERANCE_MS) return null
    return raw
  } catch {
    return null
  }
}

/** Persisted observation spans per feed; malformed or unknown entries are dropped. */
export function readCoverage(path: string, known: ReadonlySet<string>, now = Date.now()): CoverageIntervals {
  const result: CoverageIntervals = {}
  try {
    if (!existsSync(path)) return result
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result
    const envelope = raw as Record<string, unknown>
    // Legacy coverage was inferred from article dates and could bridge outages.
    // Invalidate it rather than treating that history as verified monitoring.
    if (envelope['schemaVersion'] !== COVERAGE_SCHEMA_VERSION || typeof envelope['sources'] !== 'object' || envelope['sources'] === null || Array.isArray(envelope['sources'])) return result
    for (const [sourceId, spans] of Object.entries(envelope['sources'] as Record<string, unknown>)) {
      if (!known.has(sourceId) || !Array.isArray(spans)) continue
      const valid = spans.filter((span): span is [number, number] =>
        Array.isArray(span) && span.length === 2 && Number.isFinite(span[0]) && Number.isFinite(span[1]) && span[0] <= span[1] && span[1] <= now + 60_000)
      let merged: Array<[number, number]> = []
      for (const span of valid) merged = addCoverage(merged, span, now - COVERAGE_KEEP_MS)
      if (merged.length) result[sourceId] = merged
    }
  } catch {
    return {}
  }
  return result
}
