import { placeTrends, type PlaceQuery, type PlaceTrends } from '../../shared/news/placeTrends'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PublicItem } from '@intoponet/field-snapshot'
import { createAtomicFeedStorage, FeedFetchService, type FeedRegistry, type FeedRegistrySource } from '../feed-service'
import { addCoverage, buildNewsDigest, type CoverageIntervals, type NewsFeedHealth, type NewsItemInput, type NewsSourceMeta } from '../../shared/news/newsDigest'
import type { FeedFetchResult } from '../feed-service'
import newsFeeds from './newsFeeds.json'
import internationalFeeds from './internationalFeeds.json'
import { buildGlobalStories } from '../../shared/news/globalStories'
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
const DIGEST_DEBOUNCE_MS = 4_000

export function newsFeedEntries(): NewsFeedEntry[] {
  const seen = new Set<string>()
  // International desks first: they are few, and world stories depend on them.
  return ([...internationalFeeds.feeds, ...newsFeeds.feeds] as NewsFeedEntry[]).filter((feed) => {
    if (seen.has(feed.sourceId)) return false
    seen.add(feed.sourceId)
    return true
  })
}

export function newsRegistry(feeds: NewsFeedEntry[]): FeedRegistry {
  const sources: FeedRegistrySource[] = feeds.map((feed) => ({
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
export function startNewsService(options: { userData: string; emit: (payload: string) => void }): { stop: () => void; latest: () => string | null; trends: (place: PlaceQuery & { geonameId?: string }) => Promise<PlaceTrends> } {
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
  try {
    if (existsSync(digestPath)) latest = readFileSync(digestPath, 'utf8')
  } catch {
    latest = null
  }
  if (latest) options.emit(latest)
  if (!feeds.length) return { stop: () => undefined, latest: () => latest, trends: async () => ({ rising: [], fading: [], recentStories: 0, previousStories: 0, outlets: 0, uncompared: 0, latest: [], earlier: [] }) }

  let digestTimer: ReturnType<typeof setTimeout> | null = null
  // The latest items behind the digest, for place trends (in memory only).
  let lastItems: NewsItemInput[] = []
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
    const now = Date.now()
    let start: number | null = null
    if (result.status === 'updated') {
      // The feed's own output spans from its oldest item to now.
      const times = result.receivedItems.map((item) => Date.parse(item.publishedAt ?? item.discoveredAt)).filter(Number.isFinite)
      if (times.length) start = Math.min(...times)
    } else if (result.status === 'not-modified') {
      // Unchanged since our previous successful fetch.
      start = lastFetch.get(result.sourceId) ?? coverage[result.sourceId]?.at(-1)?.[1] ?? null
    }
    if (result.status === 'updated' || result.status === 'not-modified') lastFetch.set(result.sourceId, now)
    if (start === null || start > now) return
    coverage[result.sourceId] = addCoverage(coverage[result.sourceId] ?? [], [start, now], now - COVERAGE_KEEP_MS)
  }
  const service = new FeedFetchService({
    registry: newsRegistry(feeds),
    storage: createAtomicFeedStorage(join(options.userData, 'news-feed-cache.json'), 64 * 1024 * 1024),
    maxEnabledSources: 800,
    maxConcurrency: 6,
    maxCacheBytes: 64 * 1024 * 1024,
    persistDebounceMs: 15_000,
    tolerant: true,
    onResult: (result) => {
      // no-store feeds: keep their latest headlines in memory only, never on disk.
      if (!result.persistenceAllowed && result.status === 'updated') transient.set(result.sourceId, result.receivedItems)
      else if (result.persistenceAllowed && result.status === 'updated') transient.delete(result.sourceId)
      observe(result)
      scheduleDigest()
    },
  })

  const publish = async (): Promise<void> => {
    const snapshot = await service.snapshot()
    const stored: NewsItemInput[] = []
    const health: Record<string, NewsFeedHealth> = {}
    const toInput = (sourceId: string, item: PublicItem): NewsItemInput => ({
      sourceId, title: item.title, url: item.canonicalUrl, publishedAt: item.publishedAt, discoveredAt: item.discoveredAt,
    })
    for (const [sourceId, state] of Object.entries(snapshot.sources)) {
      health[sourceId] = state.health
      for (const item of state.items) stored.push(toInput(sourceId, item))
    }
    const memoryOnly = [...transient.entries()].flatMap(([sourceId, items]) => items.map((item) => toInput(sourceId, item)))
    const now = Date.now()
    const all = [...stored, ...memoryOnly]
    lastItems = all
    latest = JSON.stringify({
      ...buildNewsDigest({ sources: meta, items: all, health, now, coverage }),
      global: buildGlobalStories({ sources: meta, items: all, now }),
      inTheNews,
    })
    options.emit(latest)
    try {
      // The on-disk copy (shown at the next launch) excludes no-store feeds.
      writeFileSync(digestPath, JSON.stringify({
        ...buildNewsDigest({ sources: meta, items: stored, health, now, coverage }),
        global: buildGlobalStories({ sources: meta, items: stored, now }),
        inTheNews,
      }), { encoding: 'utf8', mode: 0o644 })
      writeFileSync(coveragePath, JSON.stringify(coverage), { encoding: 'utf8', mode: 0o644 })
    } catch {
      // The digest is rebuilt from the feed cache on the next update.
    }
  }

  function scheduleDigest(): void {
    if (digestTimer) return
    digestTimer = setTimeout(() => {
      digestTimer = null
      void publish().catch((error: unknown) => {
        console.error('News digest failed.', error instanceof Error ? error.message : error)
      })
    }, DIGEST_DEBOUNCE_MS)
    digestTimer.unref?.()
  }

  void service.start().then(() => scheduleDigest()).catch((error: unknown) => {
    console.error('News feeds could not start.', error instanceof Error ? error.message : error)
  })

  return {
    stop: () => {
      if (digestTimer) clearTimeout(digestTimer)
      clearInterval(inTheNewsTimer)
      service.stop()
      void service.flush()
    },
    latest: () => latest,
    /** What is rising and fading in one place's news, from the latest feeds. */
    trends: async ({ geonameId, ...place }: PlaceQuery & { geonameId?: string }): Promise<PlaceTrends> => {
      // A city is also named in its outlets' own languages ("Roma", "Bruxelles"); found once, then cached.
      const languages = [...new Set(meta.filter((source) => source.countryCode === place.countryCode && source.language).map((source) => source.language!))]
      const local = place.name && geonameId ? await localPlaceNames(geonameId, languages).catch(() => []) : []
      const aliases = [...new Set([...(place.aliases ?? []), ...local])].filter((alias) => alias !== place.name)
      return placeTrends({ sources: meta, items: lastItems, coverage, now: Date.now(), place: { ...place, ...(aliases.length ? { aliases } : {}) } })
    },
  }
}

/** Persisted observation spans per feed; malformed or unknown entries are dropped. */
export function readCoverage(path: string, known: ReadonlySet<string>, now = Date.now()): CoverageIntervals {
  const result: CoverageIntervals = {}
  try {
    if (!existsSync(path)) return result
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result
    for (const [sourceId, spans] of Object.entries(raw as Record<string, unknown>)) {
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
