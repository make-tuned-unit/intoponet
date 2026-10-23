import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  hitsFromGeosearch,
  parseFieldSnapshot,
  publicAnchors,
  publicFieldSnapshot,
  recordsFromHits,
  recordsFromQuakes,
  usgsFeed,
  viewsFromPayload,
  wikipediaTitlePath,
  type FieldSnapshot,
  type SourceRecord,
} from '@intoponet/field-snapshot'
import { app } from 'electron'

const userAgent = 'Intoponet/0.1 (local spatial browser; public field snapshot)'
const refreshMs = 6 * 60 * 60 * 1000

function cachePath(): string {
  return join(app.getPath('userData'), 'public-field-snapshot.json')
}

export function cachedPublicField(): string | null {
  if (!existsSync(cachePath())) return null
  try {
    const snapshot = parseFieldSnapshot(readFileSync(cachePath(), 'utf8'))
    return snapshot ? JSON.stringify(snapshot) : null
  } catch {
    return null
  }
}

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 3_000 * (attempt + 1)))
      continue
    }
    if (!response.ok) throw new Error(`Public source responded ${response.status}`)
    return response.json() as Promise<unknown>
  }
  throw new Error('Public source responded 429')
}

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

async function fetchWikipediaRecords(): Promise<SourceRecord[]> {
  const end = new Date()
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
  const records: SourceRecord[] = []
  for (const anchor of publicAnchors) {
    const geo = new URL('https://en.wikipedia.org/w/api.php')
    geo.searchParams.set('action', 'query')
    geo.searchParams.set('list', 'geosearch')
    geo.searchParams.set('gscoord', `${anchor.lat}|${anchor.lon}`)
    geo.searchParams.set('gsradius', '10000')
    geo.searchParams.set('gslimit', '4')
    geo.searchParams.set('format', 'json')
    const hits = hitsFromGeosearch(await getJson(geo.toString()))
    const views = new Map<string, number>()
    for (const hit of hits) {
      const viewUrl = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${wikipediaTitlePath(hit.title)}/daily/${dayStamp(start)}/${dayStamp(end)}`
      try {
        views.set(hit.title, viewsFromPayload(await getJson(viewUrl)))
      } catch {
        views.set(hit.title, 0)
      }
    }
    records.push(...recordsFromHits(hits, anchor.topic, views, new Date().toISOString()))
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return records
}

async function fetchUsgsRecords(): Promise<SourceRecord[]> {
  return recordsFromQuakes(await getJson(usgsFeed), new Date().toISOString())
}

function cachedByPrefix(snapshot: FieldSnapshot | null, prefix: string): SourceRecord[] {
  return snapshot?.sources.filter((source) => source.id.startsWith(prefix)) ?? []
}

export async function loadPublicField(): Promise<FieldSnapshot | null> {
  const cached = cachedPublicField()
  const parsed = cached ? parseFieldSnapshot(cached) : null
  const age = parsed ? Date.now() - Date.parse(parsed.createdAt) : Number.POSITIVE_INFINITY
  const cacheFresh = Boolean(parsed) && age < refreshMs
  const cacheHasUsgs = parsed?.coverageNote.includes('USGS') ?? false
  if (cacheFresh && cacheHasUsgs) return parsed
  let wiki: SourceRecord[] = []
  let usgs: SourceRecord[] = []
  let wikiFresh = false
  let usgsFresh = false
  if (cacheFresh) {
    wiki = cachedByPrefix(parsed, 'wiki-')
    wikiFresh = wiki.length > 0
  } else {
    try {
      wiki = await fetchWikipediaRecords()
      wikiFresh = wiki.length > 0
    } catch (error) {
      console.error(
        'Wikipedia field refresh failed.',
        error instanceof Error ? error.message : error,
      )
    }
  }
  try {
    usgs = await fetchUsgsRecords()
    usgsFresh = true
  } catch (error) {
    console.error('USGS field refresh failed.', error instanceof Error ? error.message : error)
  }
  if (!wikiFresh) wiki = cachedByPrefix(parsed, 'wiki-')
  if (!usgsFresh) usgs = cachedByPrefix(parsed, 'usgs-')
  const records = [...wiki, ...usgs]
  if (records.length === 0) return parsed
  const snapshot = publicFieldSnapshot(records, Date.now(), usgsFresh)
  writeFileSync(cachePath(), JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o644 })
  return snapshot
}
