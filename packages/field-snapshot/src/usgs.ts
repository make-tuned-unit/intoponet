import type { SourceRecord } from './types'

export const usgsAttribution = 'U.S. Geological Survey, public domain'
export const usgsFeed =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson'

const maxEvents = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function weightFromMagnitude(magnitude: number): number {
  if (!Number.isFinite(magnitude)) return 0.3
  return Math.min(2.2, Math.max(0.3, 0.4 + (magnitude - 4.5) * 0.35))
}

export function recordsFromQuakes(payload: unknown, retrievedAt: string): SourceRecord[] {
  if (!isRecord(payload) || !Array.isArray(payload['features'])) return []
  const quakes = payload['features'].flatMap((feature): SourceRecord[] => {
    if (!isRecord(feature) || typeof feature['id'] !== 'string') return []
    if (!isRecord(feature['geometry']) || !Array.isArray(feature['geometry']['coordinates'])) return []
    const [lon, lat] = feature['geometry']['coordinates']
    if (typeof lat !== 'number' || typeof lon !== 'number') return []
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []
    if (!isRecord(feature['properties'])) return []
    const props = feature['properties']
    if (props['type'] !== 'earthquake') return []
    if (typeof props['mag'] !== 'number' || !Number.isFinite(props['mag']) || props['mag'] < 4.5) return []
    if (typeof props['place'] !== 'string' || typeof props['url'] !== 'string') return []
    const place = props['place'].trim()
    if (!place || place.length > 180 || !props['url'].startsWith('https://')) return []
    const time = typeof props['time'] === 'number' ? new Date(props['time']).toISOString() : retrievedAt
    return [
      {
        id: `usgs-${feature['id']}`,
        kind: 'public-record',
        title: place,
        url: props['url'],
        licence: 'public-domain',
        attribution: usgsAttribution,
        retrievedAt,
        lat,
        lon,
        radiusKm: 50,
        topics: ['seismic-record'],
        weight: weightFromMagnitude(props['mag']),
        publishedAt: time,
        measurement: {
          kind: 'usgs-earthquake-magnitude',
          value: props['mag'],
          unit: 'magnitude',
          sourceId: 'usgs-comcat-m45-week',
          sourceUrl: usgsFeed,
          transformation: 'bounded-linear-magnitude-v1 (0.4 + (magnitude - 4.5) * 0.35, clamped to 0.3..2.2)',
          scale: typeof props['magType'] === 'string' ? props['magType'] : 'unspecified',
        },
      },
    ]
  })
  return quakes
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxEvents)
}
