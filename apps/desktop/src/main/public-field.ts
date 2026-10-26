import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  eonetFeed,
  pageInfoFromPayload,
  parseFieldSnapshot,
  publicFieldSnapshot,
  READING_NOW_LIMITS,
  recordsFromEonet,
  recordsFromQuakes,
  recordsFromTopArticles,
  topArticlesFromPayload,
  usgsFeed,
  wikipediaPageInfoUrl,
  wikipediaTopUrl,
  type FieldSnapshot,
  type PageInfo,
  type SourceRecord,
} from '@intoponet/field-snapshot'
import { app } from 'electron'

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

let current: FieldSnapshot | null = null
let readingCheckedAt = 0
const failing = new Set<SourceGroup>()

function readCache(): FieldSnapshot | null {
  if (!existsSync(cachePath())) return null
  try {
    return parseFieldSnapshot(readFileSync(cachePath(), 'utf8'))
  } catch {
    return null
  }
}

/** Latest snapshot as JSON: in-memory first, then the on-disk cache. */
export function cachedPublicField(): string | null {
  current ??= readCache()
  return current ? JSON.stringify(current) : null
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
    return recordsFromTopArticles(top, pages, day, retrievedAt)
  }
  return []
}

export async function fetchQuakes(now = Date.now()): Promise<SourceRecord[]> {
  return recordsFromQuakes(await getJson(usgsFeed), new Date(now).toISOString())
}

export async function fetchNaturalEvents(now = Date.now()): Promise<SourceRecord[]> {
  return recordsFromEonet(await getJson(eonetFeed), new Date(now).toISOString())
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
  current ??= readCache()
  const previous = current
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
  if (records.length === 0) return previous
  const snapshot = publicFieldSnapshot(records, now, usgs !== null)
  current = snapshot
  try {
    writeFileSync(cachePath(), JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o644 })
  } catch (error) {
    console.error('Could not cache the public field snapshot.', error instanceof Error ? error.message : error)
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
export function startPublicFieldRefresh(emit: (snapshot: FieldSnapshot) => void): () => void {
  const cached = cachedPublicField()
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
  return () => clearInterval(timer)
}
