import { aggregateSnapshot } from './aggregate'
import { fieldSnapshotSchema, type FieldSnapshot, type SourceRecord } from './types'

export const wikipediaAttribution = 'Wikipedia contributors, CC BY-SA 4.0'
export const wikipediaCoverage =
  'English Wikipedia articles near four public anchors, weighted by recent public pageviews. Not the whole web, and not a measure of importance.'

export const publicAnchors = [
  { topic: 'open-knowledge', lat: 40.7, lon: -74 },
  { topic: 'civic-memory', lat: 35.7, lon: 139.8 },
  { topic: 'local-archives', lat: 4.7, lon: -74.1 },
  { topic: 'open-research', lat: -33.9, lon: 18.4 },
] as const

export type WikipediaHit = {
  pageid: number
  title: string
  lat: number
  lon: number
}

const staleAfterMs = 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hitsFromGeosearch(payload: unknown): WikipediaHit[] {
  if (!isRecord(payload) || !isRecord(payload['query']) || !Array.isArray(payload['query']['geosearch'])) {
    return []
  }
  return payload['query']['geosearch'].flatMap((item): WikipediaHit[] => {
    if (!isRecord(item) || typeof item['title'] !== 'string' || typeof item['pageid'] !== 'number') return []
    if (typeof item['lat'] !== 'number' || typeof item['lon'] !== 'number') return []
    if (!Number.isFinite(item['lat']) || !Number.isFinite(item['lon'])) return []
    const title = item['title'].trim()
    if (!title || title.length > 180) return []
    return [{ pageid: item['pageid'], title, lat: item['lat'], lon: item['lon'] }]
  })
}

export function viewsFromPayload(payload: unknown): number {
  if (!isRecord(payload) || !Array.isArray(payload['items'])) return 0
  return payload['items'].reduce((sum: number, item: unknown) => {
    if (!isRecord(item) || typeof item['views'] !== 'number' || !Number.isFinite(item['views'])) return sum
    return sum + Math.max(0, item['views'])
  }, 0)
}

export function weightFromViews(views: number): number {
  if (!Number.isFinite(views) || views <= 0) return 0.2
  return Math.min(5, Math.max(0.2, Math.log10(views + 1)))
}

export function wikipediaTitlePath(title: string): string {
  return encodeURIComponent(title.trim().replace(/ /g, '_'))
}

export function recordsFromHits(
  hits: WikipediaHit[],
  topic: string,
  viewsByTitle: ReadonlyMap<string, number>,
  retrievedAt: string,
): SourceRecord[] {
  return hits.map((hit) => ({
    id: `wiki-${hit.pageid}`,
    kind: 'public-record' as const,
    title: hit.title,
    url: `https://en.wikipedia.org/wiki/${wikipediaTitlePath(hit.title)}`,
    licence: 'cc-by-sa' as const,
    attribution: wikipediaAttribution,
    retrievedAt,
    lat: hit.lat,
    lon: hit.lon,
    radiusKm: 10,
    topics: [topic],
    weight: weightFromViews(viewsByTitle.get(hit.title) ?? 0),
    publishedAt: retrievedAt,
  }))
}

export function coverageForRecords(records: SourceRecord[], usgsChecked = false): string {
  const wiki = records.some((record) => record.id.startsWith('wiki-'))
  const usgs = records.some((record) => record.id.startsWith('usgs-'))
  const parts: string[] = []
  if (wiki) {
    parts.push(
      'English Wikipedia articles near four public anchors, weighted by recent public pageviews',
    )
  }
  if (usgs) {
    parts.push(
      'USGS earthquakes of magnitude 4.5 or greater in the last week, weighted as a physical measurement',
    )
  } else if (usgsChecked) {
    parts.push('USGS reported no magnitude 4.5 or greater earthquakes in the last week')
  }
  if (parts.length === 0) return wikipediaCoverage
  return `${parts.join('; ')}. Not the whole web, and not a measure of importance.`
}

export function publicFieldSnapshot(
  records: SourceRecord[],
  now = Date.now(),
  usgsChecked = false,
): FieldSnapshot {
  const snapshot = aggregateSnapshot(records, now)
  return {
    ...snapshot,
    id: `public-${new Date(now).toISOString().slice(0, 13)}`,
    coverageNote: coverageForRecords(records, usgsChecked),
  }
}

export function snapshotLabel(snapshot: FieldSnapshot, now = Date.now()): string {
  const age = now - Date.parse(snapshot.createdAt)
  if (!Number.isFinite(age) || age > staleAfterMs) {
    return `${snapshot.coverageNote} Snapshot is stale.`
  }
  return snapshot.coverageNote
}

export function parseFieldSnapshot(raw: string): FieldSnapshot | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value) || value['schema'] !== fieldSnapshotSchema) return null
    if (!Array.isArray(value['sources'])) return null
    const sources = value['sources'].flatMap((item): SourceRecord[] => {
      if (!isRecord(item)) return []
      if (item['kind'] !== 'public-record' && item['kind'] !== 'synthetic-fixture') return []
      if (typeof item['id'] !== 'string' || typeof item['title'] !== 'string') return []
      if (typeof item['url'] !== 'string' || typeof item['attribution'] !== 'string') return []
      if (typeof item['lat'] !== 'number' || typeof item['lon'] !== 'number') return []
      if (typeof item['weight'] !== 'number' || !Array.isArray(item['topics'])) return []
      const topics = item['topics'].filter((topic): topic is string => typeof topic === 'string')
      if (topics.length === 0) return []
      const licence = item['licence']
      if (
        licence !== 'public-domain' &&
        licence !== 'cc0' &&
        licence !== 'cc-by' &&
        licence !== 'cc-by-sa' &&
        licence !== 'open-data' &&
        licence !== 'link-only'
      ) {
        return []
      }
      return [
        {
          id: item['id'],
          kind: item['kind'],
          title: item['title'],
          url: item['url'],
          licence,
          attribution: item['attribution'],
          retrievedAt: typeof item['retrievedAt'] === 'string' ? item['retrievedAt'] : '',
          lat: item['lat'],
          lon: item['lon'],
          radiusKm: typeof item['radiusKm'] === 'number' ? item['radiusKm'] : 10,
          topics,
          weight: item['weight'],
          publishedAt: typeof item['publishedAt'] === 'string' ? item['publishedAt'] : '',
        },
      ]
    })
    if (sources.length === 0) return null
    const createdAt = typeof value['createdAt'] === 'string' ? value['createdAt'] : ''
    const snapshot = aggregateSnapshot(sources, Date.parse(createdAt) || Date.now())
    const note = typeof value['coverageNote'] === 'string' ? value['coverageNote'] : snapshot.coverageNote
    const honest =
      note.includes('Not the whole web') || note.includes('Not public activity') || note.includes('Synthetic')
    return {
      ...snapshot,
      id: typeof value['id'] === 'string' ? value['id'] : snapshot.id,
      createdAt: createdAt || snapshot.createdAt,
      coverageNote: honest ? note : snapshot.coverageNote,
    }
  } catch {
    return null
  }
}
