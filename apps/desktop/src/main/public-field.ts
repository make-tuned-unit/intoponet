import { join } from 'node:path'
import {
  articleCandidates,
  eonetFeed,
  pageInfoFromPayload,
  publicFieldSnapshot,
  READING_NOW_LIMITS,
  recordsFromEonet,
  recordsFromQuakes,
  recordsFromTopArticles,
  topArticlesFromPayload,
  usgsFeed,
  wikipediaPageInfoUrl,
  wikipediaTopUrl,
  viewsByTitle,
  type FieldSnapshot,
  type PageInfo,
  type SourceRecord,
} from '@intoponet/field-snapshot'
import { app } from 'electron'
import type { PublicFieldStatus } from '@intoponet/browser-api'
import { SharedPublicSnapshotClient, SHARED_SNAPSHOT_STALE_AFTER_MS, type SharedSnapshotStatus } from './shared-public-field'
import { readLocalPublicFieldCache, writeLocalPublicFieldCache } from './public-field-cache'

// Wikimedia asks API clients for a descriptive agent with a contact URL.
const userAgent = 'Intoponet/0.1 (local spatial browser; public field snapshot; https://github.com/make-tuned-unit/intoponet)'
/** Earthquakes and natural events. */
export const PUBLIC_FIELD_REFRESH_MS = 20 * 60 * 1000
/** Wikipedia publishes one top-articles list per UTC day; check at most this often. */
export const READING_CHECK_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

type SourceGroup = 'reading' | 'usgs' | 'eonet'
const groupPrefix: Record<SourceGroup, string> = { reading: 'wikitop-', usgs: 'usgs-', eonet: 'eonet-' }

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Public source responded ${status}`)
  }
}

function cachePath(): string {
  return join(app.getPath('userData'), 'public-field-snapshot.json')
}

function sharedCachePath(): string {
  return join(app.getPath('userData'), 'public-field-shared-snapshot.json')
}

let configuredSharedClient: SharedPublicSnapshotClient | null | undefined
function sharedClient(): SharedPublicSnapshotClient | null {
  if (configuredSharedClient !== undefined) return configuredSharedClient
  if (!Object.hasOwn(process.env, 'INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL')) {
    configuredSharedClient = null
    return null
  }
  configuredSharedClient = new SharedPublicSnapshotClient({
    endpoint: process.env['INTOPONET_SHARED_PUBLIC_SNAPSHOT_URL'] ?? '',
    cachePath: sharedCachePath(),
  })
  latestStatus = sharedStatus(configuredSharedClient.status())
  return configuredSharedClient
}

let current: FieldSnapshot | null = null
let readingCheckedAt = 0
const failing = new Set<SourceGroup>()
let latestStatus: PublicFieldStatus = {
  mode: 'local',
  sourceLabel: 'Wikipedia · USGS · NASA EONET',
  configuredOrigin: null,
  state: 'fetching',
  evaluationTime: null,
  message: 'Checking independent public sources.',
}
let statusListener: ((status: PublicFieldStatus) => void) | null = null

function publishStatus(status: PublicFieldStatus): void {
  latestStatus = status
  statusListener?.(status)
}

function localStatus(state: PublicFieldStatus['state'], message: string, evaluationTime = current?.createdAt ?? null): PublicFieldStatus {
  return {
    mode: 'local',
    sourceLabel: 'Wikipedia · USGS · NASA EONET',
    configuredOrigin: null,
    state,
    evaluationTime,
    message,
  }
}

function sharedStatus(status: SharedSnapshotStatus, stateOverride?: PublicFieldStatus['state']): PublicFieldStatus {
  const state = stateOverride ?? (status.state === 'fresh' ? 'current'
    : status.state === 'stale' ? 'stale'
      : status.state === 'error' || status.state === 'invalid-configuration' ? 'error'
        : 'current')
  return {
    mode: 'shared',
    sourceLabel: 'Shared public snapshot',
    configuredOrigin: status.endpointOrigin,
    state,
    evaluationTime: status.evaluationTime,
    message: status.message,
  }
}

function readCache(): FieldSnapshot | null {
  return readLocalPublicFieldCache(cachePath())
}

/** Latest snapshot as JSON: in-memory first, then the on-disk cache. */
export function cachedPublicField(now = Date.now()): string | null {
  const shared = sharedClient()
  if (shared) {
    const result = shared.cached(now)
    current = result.snapshot
    publishStatus(sharedStatus(result.status))
    return current ? JSON.stringify(current) : null
  }
  current ??= readCache()
  // A cache read must not erase an earlier refresh/source failure disclosure.
  if (latestStatus.state !== 'error' && latestStatus.state !== 'stale') {
    const stale = current !== null && now - Date.parse(current.createdAt) > SHARED_SNAPSHOT_STALE_AFTER_MS
    publishStatus(current
      ? stale
        ? localStatus('stale', 'Showing this device’s cached public snapshot, which is older than 2 hours.', current.createdAt)
        : localStatus('current', 'Showing the latest independently collected public snapshot from this device.', current.createdAt)
      : localStatus('error', 'No verified public snapshot is cached on this device.'))
  }
  return current ? JSON.stringify(current) : null
}

/** A renderer-safe status record; it contains only public source state, never personal data. */
export function publicFieldStatus(): PublicFieldStatus {
  sharedClient()
  return latestStatus
}

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': userAgent, 'api-user-agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 429 && attempt < 2) {
      await delay(3_000 * (attempt + 1))
      continue
    }
    if (!response.ok) throw new HttpError(response.status)
    return response.json() as Promise<unknown>
  }
  throw new HttpError(429)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function recordsOf(snapshot: FieldSnapshot | null, group: SourceGroup): SourceRecord[] {
  return snapshot?.sources.filter((source) => source.id.startsWith(groupPrefix[group])) ?? []
}

function readingDayOf(snapshot: FieldSnapshot | null): string | null {
  return recordsOf(snapshot, 'reading')[0]?.measurement.windowEnd ?? null
}

function utcMidnight(time: number): Date {
  const date = new Date(time)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** The newest complete UTC day Wikimedia has published, falling back one day. */
export async function fetchReadingNow(now = Date.now()): Promise<SourceRecord[]> {
  const retrievedAt = new Date(now).toISOString()
  for (const back of [1, 2]) {
    const day = new Date(utcMidnight(now).getTime() - back * DAY_MS)
    let top
    try {
      top = topArticlesFromPayload(await getJson(wikipediaTopUrl(day)))
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) continue
      throw error
    }
    if (!top.length) continue
    const pages = new Map<string, PageInfo>()
    for (let index = 0; index < top.length; index += READING_NOW_LIMITS.titlesPerLookup) {
      const batch = top.slice(index, index + READING_NOW_LIMITS.titlesPerLookup).map((article) => article.title)
      for (const [title, info] of pageInfoFromPayload(await getJson(wikipediaPageInfoUrl(batch)))) pages.set(title, info)
      await delay(350)
    }
    return recordsFromTopArticles(top, pages, day, retrievedAt, READING_NOW_LIMITS.located, await previousDayViews(day))
  }
  return []
}

/** Previous UTC day's top list, cached by day; null when unavailable (no comparison shown). */
const previousDayCache = new Map<string, Map<string, number>>()
async function previousDayViews(day: Date): Promise<Map<string, number> | null> {
  const previous = new Date(day.getTime() - DAY_MS)
  const key = previous.toISOString().slice(0, 10)
  const cached = previousDayCache.get(key)
  if (cached) return cached
  try {
    const views = viewsByTitle(topArticlesFromPayload(await getJson(wikipediaTopUrl(previous))))
    if (!views.size) return null
    previousDayCache.clear()
    previousDayCache.set(key, views)
    return views
  } catch {
    return null
  }
}

export async function fetchQuakes(now = Date.now()): Promise<SourceRecord[]> {
  return recordsFromQuakes(await getJson(usgsFeed), new Date(now).toISOString())
}

export async function fetchNaturalEvents(now = Date.now()): Promise<SourceRecord[]> {
  const records = recordsFromEonet(await getJson(eonetFeed), new Date(now).toISOString())
  return attachArticles(records, new Date(now).getUTCFullYear()).catch(() => records)
}

/**
 * Give each natural event a Wikipedia article when one exists (named storms,
 * volcanoes, large fires), checked with one batched query. A bare storm name is
 * reused across years ("Hurricane Vance"), so it counts only when its title or
 * description names this event's year. Events without an article keep none:
 * "Read about it" then opens the agency's own page, never a search.
 */
async function attachArticles(records: SourceRecord[], year: number): Promise<SourceRecord[]> {
  const candidates = new Map(records.map((record) => [record.id, articleCandidates(record.title, year)]))
  const titles = [...new Set([...candidates.values()].flat())]
  const found = new Map<string, { title: string; description: string }>()
  for (let i = 0; i < titles.length; i += 50) {
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.search = new URLSearchParams({ action: 'query', prop: 'description|pageprops', ppprop: 'disambiguation', titles: titles.slice(i, i + 50).join('|'), redirects: '1', format: 'json', formatversion: '2' }).toString()
    const payload = await getJson(url.toString()) as { query?: { pages?: Array<{ title?: string; missing?: boolean; description?: string; pageprops?: { disambiguation?: string } }>; redirects?: Array<{ from: string; to: string }>; normalized?: Array<{ from: string; to: string }> } }
    const pages = new Map((payload.query?.pages ?? []).filter((page) => page.title && !page.missing && page.pageprops?.disambiguation === undefined).map((page) => [page.title!, page.description ?? '']))
    const resolve = new Map<string, string>()
    for (const step of [...(payload.query?.normalized ?? []), ...(payload.query?.redirects ?? [])]) resolve.set(step.from, resolve.get(step.to) ?? step.to)
    for (const asked of titles.slice(i, i + 50)) {
      const target = resolve.get(asked) ?? asked
      if (pages.has(target)) found.set(asked, { title: target, description: pages.get(target)! })
    }
  }
  return records.map((record) => {
    for (const asked of candidates.get(record.id) ?? []) {
      const page = found.get(asked)
      if (!page) continue
      const recurring = /^(Hurricane|Typhoon|Cyclone|Tropical Storm|Tropical Depression)\b/i.test(page.title)
      if (recurring && !page.title.includes(String(year)) && !page.description.includes(String(year))) continue
      return { ...record, articleUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` }
    }
    return record
  })
}

async function attempt(group: SourceGroup, run: () => Promise<SourceRecord[]>): Promise<SourceRecord[] | null> {
  try {
    const records = await run()
    if (failing.delete(group)) console.info(`Public field source recovered: ${group}.`)
    return records
  } catch (error) {
    // Log the first failure only; keep the cached records for this source.
    if (!failing.has(group)) {
      failing.add(group)
      console.error(`Public field source ${group} failed; keeping cached records.`, error instanceof Error ? error.message : error)
    }
    return null
  }
}

/**
 * Refresh each source independently. A failed source keeps its cached
 * records; the old four-anchor geosearch records are no longer carried.
 */
export async function refreshPublicField(now = Date.now()): Promise<FieldSnapshot | null> {
  const shared = sharedClient()
  if (shared) {
    const prior = shared.cached(now)
    publishStatus({
      ...sharedStatus(prior.status, 'fetching'),
      message: prior.snapshot ? 'Checking the configured shared source; its verified snapshot remains available.' : 'Fetching the configured shared public snapshot.',
    })
    const result = await shared.refresh(now)
    current = result.snapshot
    publishStatus(sharedStatus(result.status))
    if (result.status.state === 'error' || result.status.state === 'stale' || result.status.state === 'invalid-configuration') {
      console.error(`Shared public field ${result.status.state}: ${result.status.message}`)
    }
    return result.snapshot
  }
  current ??= readCache()
  const previous = current
  publishStatus(localStatus('fetching', 'Refreshing independent public sources.', previous?.createdAt ?? null))
  const expectedDay = utcMidnight(now - DAY_MS).toISOString().slice(0, 10).replace(/-/g, '')
  const readingDue = readingDayOf(previous) !== expectedDay && now - readingCheckedAt >= READING_CHECK_MS
  const [reading, usgs, eonet] = await Promise.all([
    readingDue ? attempt('reading', () => fetchReadingNow(now)) : Promise.resolve(null),
    attempt('usgs', () => fetchQuakes(now)),
    attempt('eonet', () => fetchNaturalEvents(now)),
  ])
  if (readingDue) readingCheckedAt = now
  const records = [
    ...(reading && reading.length ? reading : recordsOf(previous, 'reading')),
    ...(usgs ?? recordsOf(previous, 'usgs')),
    ...(eonet ?? recordsOf(previous, 'eonet')),
  ]
  if (records.length === 0) {
    publishStatus(previous
      ? localStatus('stale', `Public source refresh failed (${[...failing].join(', ')}); keeping this device's last verified snapshot.`, previous.createdAt)
      : localStatus('error', 'No public source returned a verified snapshot.'))
    return previous
  }
  const snapshot = publicFieldSnapshot(records, now, usgs !== null)
  current = snapshot
  let cacheWriteFailed = false
  try {
    writeLocalPublicFieldCache(cachePath(), snapshot)
  } catch (error) {
    cacheWriteFailed = true
    console.error('Could not cache the public field snapshot.', error instanceof Error ? error.message : error)
  }
  const failedGroups = [...failing]
  if (cacheWriteFailed) {
    const retained = failedGroups.length
      ? ` Some sources also failed (${failedGroups.join(', ')}), so their prior cached records were retained.`
      : ''
    publishStatus(localStatus('error', `The refreshed public snapshot is available in memory, but its local cache could not be written.${retained}`, snapshot.createdAt))
  } else {
    publishStatus(failedGroups.length
      ? localStatus('stale', `Some independent public sources failed (${failedGroups.join(', ')}); cached records were retained for those sources.`, snapshot.createdAt)
      : localStatus('current', 'Using independently collected public sources from this device.', snapshot.createdAt))
  }
  return snapshot
}

/** One-shot load kept for callers that only want the current snapshot. */
export async function loadPublicField(): Promise<FieldSnapshot | null> {
  return refreshPublicField()
}

/**
 * Emit the cached field immediately, refresh now, then every 20 minutes.
 * Returns a stop function; timers never keep the process alive.
 */
export function startPublicFieldRefresh(
  emit: (snapshot: FieldSnapshot) => void,
  emitStatus?: (status: PublicFieldStatus) => void,
): () => void {
  statusListener = emitStatus ?? null
  const cached = cachedPublicField()
  emitStatus?.(publicFieldStatus())
  if (cached && current) emit(current)
  let running = false
  const tick = (): void => {
    if (running) return
    running = true
    void refreshPublicField()
      .then((snapshot) => { if (snapshot) emit(snapshot) })
      .catch((error: unknown) => console.error('Public field refresh failed.', error instanceof Error ? error.message : error))
      .finally(() => { running = false })
  }
  tick()
  const timer = setInterval(tick, PUBLIC_FIELD_REFRESH_MS)
  timer.unref()
  return () => {
    clearInterval(timer)
    if (statusListener === emitStatus) statusListener = null
  }
}
