import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PublicItem } from '@intoponet/field-snapshot'
import { createAtomicFeedStorage, FeedFetchService, type FeedRegistry, type FeedRegistrySource } from '../feed-service'
import { buildNewsDigest, type NewsFeedHealth, type NewsItemInput, type NewsSourceMeta } from '../../shared/news/newsDigest'
import newsFeeds from './newsFeeds.json'

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
  geographicScope: 'national' | 'regional' | 'local'
  regionName: string | null
  cityName: string | null
  independentPublisherGroupId: string
  termsUrl: string | null
}

/** Only headline, link, id and publish time are kept; bodies and media never are. */
const APPROVED_FIELDS = ['title', 'canonicalItemUrl', 'guid', 'publishedAt']
const POLL_SECONDS = 20 * 60
const RETENTION_DAYS = 3
const DIGEST_DEBOUNCE_MS = 4_000

export function newsFeedEntries(): NewsFeedEntry[] {
  const seen = new Set<string>()
  return (newsFeeds.feeds as NewsFeedEntry[]).filter((feed) => {
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
  }))
}

/**
 * Polls every registered local news feed and publishes a digest of what each
 * country's outlets are reporting. Runs in the main process; nothing personal
 * is sent, and the renderer only ever receives the validated digest.
 */
export function startNewsService(options: { userData: string; emit: (payload: string) => void }): { stop: () => void; latest: () => string | null } {
  const feeds = newsFeedEntries()
  const meta = newsSourceMeta(feeds)
  const digestPath = join(options.userData, 'news-digest.json')
  let latest: string | null = null
  try {
    if (existsSync(digestPath)) latest = readFileSync(digestPath, 'utf8')
  } catch {
    latest = null
  }
  if (latest) options.emit(latest)
  if (!feeds.length) return { stop: () => undefined, latest: () => latest }

  let digestTimer: ReturnType<typeof setTimeout> | null = null
  const transient = new Map<string, PublicItem[]>()
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
    latest = JSON.stringify(buildNewsDigest({ sources: meta, items: [...stored, ...memoryOnly], health, now }))
    options.emit(latest)
    try {
      // The on-disk copy (shown at the next launch) excludes no-store feeds.
      writeFileSync(digestPath, JSON.stringify(buildNewsDigest({ sources: meta, items: stored, health, now })), { encoding: 'utf8', mode: 0o644 })
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
      service.stop()
      void service.flush()
    },
    latest: () => latest,
  }
}
