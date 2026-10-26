import type { SourceRecord } from './types'

/**
 * NASA EONET open natural events (wildfires, storms, volcanoes, sea and lake
 * ice, floods…). These are curated physical events, not a measure of human
 * interest; each keeps its own measurement group.
 */
export const eonetAttribution = 'NASA EONET (event metadata from linked sources)'
export const eonetSourceId = 'nasa-eonet-v3-open'
export const eonetFeed = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=200'
export const NATURAL_TOPIC_PREFIX = 'natural-'
/** Display footprint only; it is not the event's measured extent. */
export const eonetRadiusKm = 150
export const EONET_LIMITS = { events: 120 } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Presence weight 1.0; 1.25 when the source reports a magnitude. Range (0, 5]. */
export function weightFromEonet(magnitudeValue: number | null): number {
  return magnitudeValue === null ? 1 : 1.25
}

function point(geometry: Record<string, unknown>): [number, number] | null {
  const coords = geometry['coordinates']
  if (geometry['type'] === 'Point' && Array.isArray(coords)) {
    const [lon, lat] = coords
    return typeof lat === 'number' && typeof lon === 'number' ? [lat, lon] : null
  }
  if (geometry['type'] === 'Polygon' && Array.isArray(coords) && Array.isArray(coords[0])) {
    const ring = (coords[0] as unknown[]).filter(
      (pair): pair is [number, number] => Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number',
    )
    // Drop the closing vertex so it is not counted twice.
    const open = ring.length > 1 && ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
    if (!open.length) return null
    const lon = open.reduce((sum, pair) => sum + pair[0], 0) / open.length
    const lat = open.reduce((sum, pair) => sum + pair[1], 0) / open.length
    return [lat, lon]
  }
  return null
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

export function recordsFromEonet(payload: unknown, retrievedAt: string, limit: number = EONET_LIMITS.events): SourceRecord[] {
  if (!isRecord(payload) || !Array.isArray(payload['events'])) return []
  // Several events can cite one shared bulletin; give repeats their own EONET
  // page so URL deduplication does not merge distinct events.
  const usedUrls = new Set<string>()
  const records = payload['events'].flatMap((event): SourceRecord[] => {
    if (!isRecord(event) || typeof event['id'] !== 'string' || typeof event['title'] !== 'string') return []
    const title = event['title'].trim()
    if (!title || title.length > 180) return []
    const category = Array.isArray(event['categories']) ? event['categories'].find(isRecord) : undefined
    if (!category || typeof category['id'] !== 'string' || !/^[A-Za-z]{2,40}$/.test(category['id'])) return []
    const geometries = Array.isArray(event['geometry']) ? event['geometry'].filter(isRecord) : []
    const dated = geometries
      .map((geometry) => ({ geometry, time: typeof geometry['date'] === 'string' ? Date.parse(geometry['date']) : Number.NaN }))
      .filter((entry) => Number.isFinite(entry.time))
      .sort((a, b) => b.time - a.time)
    const latest = dated[0]
    if (!latest) return []
    const located = point(latest.geometry)
    if (!located) return []
    const [lat, lon] = located
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return []
    const sources = Array.isArray(event['sources']) ? event['sources'].filter(isRecord) : []
    const cited = sources.map((source) => httpsUrl(source['url'])).find((value): value is string => value !== null)
    const url = cited && !usedUrls.has(cited.replace(/\/$/, '').toLowerCase()) ? cited : httpsUrl(event['link'])
    if (!url) return []
    usedUrls.add(url.replace(/\/$/, '').toLowerCase())
    const rawMagnitude = latest.geometry['magnitudeValue']
    const magnitude = typeof rawMagnitude === 'number' && Number.isFinite(rawMagnitude) ? rawMagnitude : null
    const unit = typeof latest.geometry['magnitudeUnit'] === 'string' && magnitude !== null ? latest.geometry['magnitudeUnit'].slice(0, 24) : 'event'
    const categoryTitle = typeof category['title'] === 'string' ? category['title'].trim() : category['id']
    const reporters = sources.map((source) => source['id']).filter((id): id is string => typeof id === 'string').slice(0, 4)
    const closed = typeof event['closed'] === 'string' && Number.isFinite(Date.parse(event['closed'])) ? event['closed'] : null
    return [{
      id: `eonet-${event['id']}`,
      kind: 'public-record',
      title,
      url,
      licence: 'public-domain',
      attribution: eonetAttribution,
      retrievedAt,
      lat,
      lon,
      radiusKm: eonetRadiusKm,
      topics: [`${NATURAL_TOPIC_PREFIX}${category['id']}`],
      weight: weightFromEonet(magnitude),
      publishedAt: new Date(latest.time).toISOString(),
      measurement: {
        kind: 'nasa-eonet-event',
        value: magnitude,
        unit,
        sourceId: eonetSourceId,
        sourceUrl: eonetFeed,
        transformation: 'presence-v1 (1.0 per open event; 1.25 when a magnitude is reported); magnitudes are not compared across units',
        scale: category['id'],
      },
      summary: `${categoryTitle}${reporters.length ? ` · reported by ${reporters.join(', ')}` : ''}`.slice(0, 280),
      ...(closed ? { endedAt: closed } : {}),
    }]
  })
  return records
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, limit)
}
