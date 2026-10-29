import { aggregateSnapshot } from './aggregate'
import {
  fieldSnapshotSchema,
  legacyFieldSnapshotSchema,
  type FieldSnapshot,
  type MeasurementKind,
  type SourceMeasurement,
  type SourceRecord,
} from './types'
import { snapshotIdentity } from './identity'

export const wikipediaAttribution = 'Wikipedia contributors, CC BY-SA 4.0'
export const wikipediaCoverage =
  'English Wikipedia articles near four public anchors, weighted by global pageview counts. Pageviews are not local participation. Not the whole web and not a measure of importance.'

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

export type PageviewWindow = { start: Date; end: Date }

const staleAfterMs = 24 * 60 * 60 * 1000
const pageviewsSourceId = 'wikimedia-pageviews-en'
const pageviewsEndpoint = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article'

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

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

export function wikipediaPageviewsUrl(title: string, window: PageviewWindow): string {
  const path = wikipediaTitlePath(title)
  return `${pageviewsEndpoint}/en.wikipedia.org/all-access/user/${path}/daily/${dayStamp(window.start)}/${dayStamp(window.end)}`
}

export function recordsFromHits(
  hits: WikipediaHit[],
  topic: string,
  viewsByTitle: ReadonlyMap<string, number>,
  retrievedAt: string,
  requestedWindow?: PageviewWindow,
): SourceRecord[] {
  const end = requestedWindow?.end ?? new Date(retrievedAt)
  const start = requestedWindow?.start ?? new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
  const windowStart = dayStamp(start)
  const windowEnd = dayStamp(end)
  return hits.map((hit) => {
    const views = viewsByTitle.get(hit.title) ?? 0
    const articlePath = wikipediaTitlePath(hit.title)
    return {
      id: `wiki-${hit.pageid}`,
      kind: 'public-record' as const,
      title: hit.title,
      url: `https://en.wikipedia.org/wiki/${articlePath}`,
      licence: 'cc-by-sa' as const,
      attribution: wikipediaAttribution,
      retrievedAt,
      lat: hit.lat,
      lon: hit.lon,
      radiusKm: 10,
      topics: [topic],
      weight: weightFromViews(views),
      publishedAt: retrievedAt,
      measurement: {
        kind: 'wikimedia-pageviews',
        value: views,
        unit: 'pageviews',
        sourceId: pageviewsSourceId,
        sourceUrl: wikipediaPageviewsUrl(hit.title, { start, end }),
        transformation: 'bounded-log10-pageviews-v1 (log10(value + 1), clamped to 0.2..5)',
        windowStart,
        windowEnd,
      },
    }
  })
}

export function coverageForRecords(records: SourceRecord[], usgsChecked = false): string {
  const wiki = records.some((record) => record.id.startsWith('wiki-'))
  const reading = records.some((record) => record.id.startsWith('wikitop-'))
  const usgs = records.some((record) => record.id.startsWith('usgs-'))
  const eonet = records.some((record) => record.id.startsWith('eonet-'))
  const parts: string[] = []
  if (reading) {
    parts.push(
      'English Wikipedia\'s most-read articles for one day, mapped only where the article has its own coordinates (pageviews, not local participation)',
    )
  }
  if (wiki) {
    parts.push(
      'English Wikipedia articles near four public anchors, weighted by global pageview counts',
    )
  }
  if (usgs) {
    parts.push(
      'USGS earthquakes of magnitude 4.5 or greater in the last week, weighted by physical magnitude',
    )
  } else if (usgsChecked) {
    parts.push('USGS reported no magnitude 4.5 or greater earthquakes in the last week')
  }
  if (eonet) {
    parts.push('NASA EONET open natural events from the last 30 days (presence, not human interest)')
  }
  if (parts.length === 0) return wikipediaCoverage
  return `${parts.join('; ')}. Measurement categories remain separate. Not the whole web and not a measure of importance.`
}

export function publicFieldSnapshot(
  records: SourceRecord[],
  now = Date.now(),
  usgsChecked = false,
): FieldSnapshot {
  const snapshot = aggregateSnapshot(records, now)
  const coverageNote = coverageForRecords(snapshot.sources, usgsChecked)
  const { id: _oldId, ...content } = snapshot
  const identified = { ...content, coverageNote }
  return {
    ...identified,
    id: snapshotIdentity(identified),
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
    if (
      !isRecord(value) ||
      (value['schema'] !== fieldSnapshotSchema && value['schema'] !== legacyFieldSnapshotSchema)
    ) return null
    const legacy = value['schema'] === legacyFieldSnapshotSchema
    if (
      !legacy &&
      value['algorithm'] !== 'log1p-separated-v2' &&
      value['algorithm'] !== 'log1p-separated-v3'
    ) return null
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
      const id = item['id']
      const title = item['title']
      const url = item['url']
      const kind = item['kind']
      const weight = item['weight']
      const measurement = legacy
        ? legacyMeasurement(id, kind, url, weight)
        : parseMeasurement(item['measurement'])
      if (!measurement) return []
      return [
        {
          id,
          kind,
          title,
          url,
          licence,
          attribution: item['attribution'],
          retrievedAt: typeof item['retrievedAt'] === 'string' ? item['retrievedAt'] : '',
          lat: item['lat'],
          lon: item['lon'],
          radiusKm: typeof item['radiusKm'] === 'number' ? item['radiusKm'] : 10,
          topics,
          weight,
          publishedAt: typeof item['publishedAt'] === 'string' ? item['publishedAt'] : '',
          measurement,
          ...optionalDetails(item),
        },
      ]
    })
    if (sources.length === 0) return null
    const rawCreatedAt = typeof value['createdAt'] === 'string' ? value['createdAt'] : ''
    const evaluatedAt = Date.parse(rawCreatedAt)
    if (!rawCreatedAt || !Number.isFinite(evaluatedAt)) return null
    const createdAt = new Date(evaluatedAt).toISOString()
    if (!legacy && createdAt !== rawCreatedAt) return null
    const snapshot = aggregateSnapshot(sources, evaluatedAt)
    const note = typeof value['coverageNote'] === 'string' ? value['coverageNote'] : snapshot.coverageNote
    const honest =
      note.includes('Not the whole web') || note.includes('Not public activity') || note.includes('Synthetic')
    const content = {
      ...snapshot,
      createdAt: createdAt || snapshot.createdAt,
      coverageNote: honest ? note : snapshot.coverageNote,
    }
    const { id: _aggregateId, ...withoutId } = content
    return { ...withoutId, id: snapshotIdentity(withoutId) }
  } catch {
    return null
  }
}

const optionalLimits = { summary: 280, placeLabel: 120 } as const

function plainText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return text ? text.slice(0, limit) : undefined
}

/** Optional display details; invalid values are dropped, never fatal. */
function optionalDetails(item: Record<string, unknown>): Pick<SourceRecord, 'summary' | 'placeLabel' | 'thumbnail' | 'endedAt' | 'previousValue'> {
  const details: Pick<SourceRecord, 'summary' | 'placeLabel' | 'thumbnail' | 'endedAt' | 'previousValue'> = {}
  const previous = item['previousValue']
  if (previous === null) details.previousValue = null
  else if (typeof previous === 'number' && Number.isFinite(previous) && previous >= 0) details.previousValue = previous
  const summary = plainText(item['summary'], optionalLimits.summary)
  if (summary) details.summary = summary
  const placeLabel = plainText(item['placeLabel'], optionalLimits.placeLabel)
  if (placeLabel) details.placeLabel = placeLabel
  if (typeof item['thumbnail'] === 'string' && item['thumbnail'].length <= 2048) {
    try {
      if (new URL(item['thumbnail']).protocol === 'https:') details.thumbnail = item['thumbnail']
    } catch {
      // Not a URL; drop it.
    }
  }
  if (typeof item['endedAt'] === 'string' && Number.isFinite(Date.parse(item['endedAt']))) details.endedAt = item['endedAt']
  return details
}

const measurementKinds = new Set<MeasurementKind>([
  'wikimedia-pageviews',
  'usgs-earthquake-magnitude',
  'nasa-eonet-event',
  'synthetic-fixture',
  'declared-index',
  'legacy-pageviews-weight',
  'legacy-earthquake-weight',
  'legacy-untyped',
])

function parseMeasurement(value: unknown): SourceMeasurement | null {
  if (!isRecord(value)) return null
  const kind = value['kind']
  const rawValue = value['value']
  const unit = value['unit']
  const sourceId = value['sourceId']
  const sourceUrl = value['sourceUrl']
  const transformation = value['transformation']
  if (
    typeof kind !== 'string' || !measurementKinds.has(kind as MeasurementKind) ||
    (typeof rawValue !== 'number' && rawValue !== null) ||
    (typeof rawValue === 'number' && !Number.isFinite(rawValue)) ||
    typeof unit !== 'string' || typeof sourceId !== 'string' ||
    typeof sourceUrl !== 'string' || typeof transformation !== 'string'
  ) return null
  return {
    kind: kind as MeasurementKind,
    value: rawValue,
    unit,
    sourceId,
    sourceUrl,
    transformation,
    ...(typeof value['windowStart'] === 'string' ? { windowStart: value['windowStart'] } : {}),
    ...(typeof value['windowEnd'] === 'string' ? { windowEnd: value['windowEnd'] } : {}),
    ...(typeof value['scale'] === 'string' ? { scale: value['scale'] } : {}),
  }
}

function legacyMeasurement(
  id: string,
  sourceKind: 'public-record' | 'synthetic-fixture',
  url: string,
  weight: number,
): SourceMeasurement {
  if (sourceKind === 'synthetic-fixture') {
    return {
      kind: 'synthetic-fixture',
      value: weight,
      unit: 'legacy-fixture-weight',
      sourceId: 'intoponet-legacy-fixture',
      sourceUrl: url,
      transformation: 'migrated v1 synthetic fixture weight',
    }
  }
  if (id.startsWith('wiki-')) {
    return {
      kind: 'legacy-pageviews-weight',
      value: null,
      unit: 'unknown',
      sourceId: pageviewsSourceId,
      sourceUrl: pageviewsEndpoint,
      transformation: `migrated v1 derived weight ${weight}; raw pageview count and date window unavailable`,
    }
  }
  if (id.startsWith('usgs-')) {
    return {
      kind: 'legacy-earthquake-weight',
      value: null,
      unit: 'unknown',
      sourceId: 'usgs-comcat-m45-week',
      sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
      transformation: `migrated v1 derived weight ${weight}; raw magnitude and magnitude type unavailable`,
    }
  }
  return {
    kind: 'legacy-untyped',
    value: null,
    unit: 'unknown',
    sourceId: `legacy-v1:${id}`,
    sourceUrl: url,
    transformation: `migrated v1 derived weight ${weight}; original measurement kind unavailable`,
  }
}
