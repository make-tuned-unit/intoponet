import type { FrequencyBand, GeoPoint } from '@intoponet/frequency-field'
import type { FieldSnapshot, SourceRecord } from './types'

export type FieldScale = 'earth' | 'region' | 'city' | 'topic'

const referenceScale = 8
const earthRadiusKm = 6371

const topicAnchors: Record<string, GeoPoint> = {
  'open-knowledge': { lat: 40.7, lon: -74 },
  'civic-memory': { lat: 35.7, lon: 139.8 },
  'local-archives': { lat: 4.7, lon: -74.1 },
  'open-research': { lat: -33.9, lon: 18.4 },
}

const relatedTopics: Record<string, string[]> = {
  'open-knowledge': ['civic-memory', 'local-archives'],
  'civic-memory': ['open-knowledge', 'open-research'],
  'local-archives': ['open-knowledge', 'open-research'],
  'open-research': ['civic-memory', 'local-archives'],
}

const clusterKm: Record<FieldScale, number> = {
  earth: 4200,
  region: 900,
  city: 160,
  topic: 55,
}

const widthLimits: Record<FieldScale, [number, number]> = {
  earth: [480, 1300],
  region: [220, 760],
  city: [70, 240],
  topic: [28, 90],
}

export type ScoredSource = SourceRecord & { raw: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrapLongitude(lon: number): number {
  let next = lon
  while (next > 180) next -= 360
  while (next < -180) next += 360
  return next
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const chord =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(chord)))
}

function recency(publishedAt: string, now: number): number {
  const published = Date.parse(publishedAt)
  if (!Number.isFinite(published)) return 0.05
  const days = Math.max(0, now - published) / 86_400_000
  return Math.min(1, Math.max(0.05, 1 - days / 3650))
}

export function geographicRelevance(source: SourceRecord): number {
  const anchor = topicAnchors[source.topics[0] ?? '']
  if (!anchor) return 1
  const sigma = 5000
  return Math.max(0.15, Math.exp(-0.5 * (haversineKm(source, anchor) / sigma) ** 2))
}

export function dedupFactor(indexOnHost: number): number {
  return 1 / (1 + Math.max(0, indexOnHost))
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function measurementKey(source: SourceRecord): string {
  const { kind, unit, scale } = source.measurement
  const legacyIdentity = kind === 'legacy-untyped' ? source.id : ''
  return [kind, unit, scale ?? '', legacyIdentity].join('|')
}

export function scoreSources(sources: SourceRecord[], now: number): ScoredSource[] {
  const seen = new Map<string, number>()
  return [...sources]
    .sort((a, b) => b.weight - a.weight)
    .map((source) => {
      const host = `${measurementKey(source)}:${hostOf(source.url)}`
      const index = seen.get(host) ?? 0
      seen.set(host, index + 1)
      const raw =
        source.weight * recency(source.publishedAt, now) * geographicRelevance(source) * dedupFactor(index)
      return { ...source, raw }
    })
}

export function rawTotal(sources: SourceRecord[], now: number): number {
  if (new Set(sources.map(measurementKey)).size > 1) {
    throw new Error('Cannot total raw values across different measurement groups.')
  }
  return scoreSources(sources, now).reduce((sum, source) => sum + source.raw, 0)
}

function intensity(raw: number): number {
  return Math.min(1, Math.log1p(Math.max(0, raw)) / Math.log1p(referenceScale))
}

function clusterSources(sources: ScoredSource[], radiusKm: number): ScoredSource[][] {
  const remaining = [...sources].sort((a, b) => b.raw - a.raw)
  const groups: ScoredSource[][] = []
  while (remaining.length > 0) {
    const seed = remaining.shift()
    if (!seed) break
    const group = [seed]
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index]
      if (
        !candidate || candidate.topics[0] !== seed.topics[0] ||
        measurementKey(candidate) !== measurementKey(seed)
      ) continue
      if (haversineKm(seed, candidate) <= radiusKm) {
        group.push(candidate)
        remaining.splice(index, 1)
      }
    }
    groups.push(group)
  }
  return groups
}

function spreadKm(group: ScoredSource[]): number {
  let spread = 0
  for (const a of group) {
    for (const b of group) spread = Math.max(spread, haversineKm(a, b))
  }
  return spread
}

function corridorLine(group: ScoredSource[]): GeoPoint[] {
  const distinct = group.filter(
    (source, index) =>
      group.findIndex((other) => haversineKm(other, source) < 1) === index,
  )
  const points = distinct.length > 0 ? distinct : group
  const only = points[0]
  if (!only || points.length === 1) {
    return [
      { lat: only?.lat ?? 0, lon: wrapLongitude((only?.lon ?? 0) - 1.1) },
      { lat: only?.lat ?? 0, lon: only?.lon ?? 0 },
      { lat: only?.lat ?? 0, lon: wrapLongitude((only?.lon ?? 0) + 1.1) },
    ]
  }
  let endA = points[0]
  let endB = points[1] ?? points[0]
  let farthest = -1
  for (const a of points) {
    for (const b of points) {
      const distance = haversineKm(a, b)
      if (!endA || !endB || distance > farthest) {
        farthest = distance
        endA = a
        endB = b
      }
    }
  }
  if (!endA || !endB) return []
  const span = {
    lat: endB.lat - endA.lat,
    lon: endB.lon - endA.lon,
  }
  const ordered = [...points].sort((a, b) => {
    const aAlong = (a.lat - endA.lat) * span.lat + (a.lon - endA.lon) * span.lon
    const bAlong = (b.lat - endA.lat) * span.lat + (b.lon - endA.lon) * span.lon
    return aAlong - bAlong
  })
  const step = Math.max(1, Math.ceil(ordered.length / 4))
  const sampled = ordered.filter((_, index) => index % step === 0)
  const last = ordered[ordered.length - 1]
  if (last && sampled[sampled.length - 1] !== last) sampled.push(last)
  return sampled.slice(0, 4).map((source) => ({ lat: source.lat, lon: source.lon }))
}

export function topographyFromSnapshot(
  snapshot: FieldSnapshot,
  scale: FieldScale = 'earth',
): FrequencyBand[] {
  const now = Date.parse(snapshot.createdAt) || Date.now()
  const groups = clusterSources(scoreSources(snapshot.sources, now), clusterKm[scale])
  const [minWidth, maxWidth] = widthLimits[scale]
  const bands: FrequencyBand[] = groups.map((group) => {
    const topic = group[0]?.topics[0] ?? 'open'
    const synthetic = group.every((source) => source.kind === 'synthetic-fixture')
    const raw = group.reduce((sum, source) => sum + source.raw, 0)
    const width = clamp(minWidth * 0.45 + spreadKm(group) * 0.35, minWidth, maxWidth)
    const line = corridorLine(group)
    const place = line[1] ?? line[0] ?? { lat: 0, lon: 0 }
    return {
      id: `corridor-${scale}-${topic}-${place.lat.toFixed(1)}-${place.lon.toFixed(1)}`,
      centerline: line,
      widthKm: width,
      wavelengthKm: scale === 'city' || scale === 'topic' ? width * 0.55 : width * 2.1,
      amplitude: intensity(raw),
      phase: (topic.length * 0.7 + place.lon) * 0.15,
      phaseVelocity: 0.035 + (Math.abs(place.lat) % 5) * 0.004,
      confidence: synthetic ? 0.3 : Math.min(0.9, 0.4 + group.length * 0.1),
      topicIds: [topic],
      category: `measurement:${measurementKey(group[0]!)}`,
      updatedAt: snapshot.createdAt,
      sourceType: synthetic ? 'synthetic' : 'public-aggregate',
    }
  })

  const primary = [...bands]
  if (scale !== 'earth') {
    for (let index = 0; index < primary.length; index += 1) {
      const band = primary[index]
      if (!band) continue
      const topic = band.topicIds[0] ?? ''
      for (const other of primary.slice(index + 1)) {
        const otherTopic = other.topicIds[0] ?? ''
        if (band.category !== other.category) continue
        if (!relatedTopics[topic]?.includes(otherTopic)) continue
        const start = band.centerline[1] ?? band.centerline[0]
        const end = other.centerline[1] ?? other.centerline[0]
        if (!start || !end || haversineKm(start, end) > 2200) continue
        bands.push({
          id: `interference-${topic}-${otherTopic}`,
          centerline: [
            start,
            { lat: (start.lat + end.lat) / 2, lon: (start.lon + end.lon) / 2 },
            end,
          ],
          widthKm: Math.min(band.widthKm, other.widthKm),
          wavelengthKm: Math.max(band.wavelengthKm, other.wavelengthKm),
          amplitude: Math.min(band.amplitude, other.amplitude) * 0.22,
          phase: band.phase + 0.4,
          phaseVelocity: 0.03,
          confidence: Math.min(band.confidence, other.confidence),
          topicIds: [topic, otherTopic],
          category: 'overlap',
          updatedAt: snapshot.createdAt,
          sourceType:
            band.sourceType === 'synthetic' || other.sourceType === 'synthetic'
              ? 'synthetic'
              : 'public-aggregate',
        })
      }
    }
  }

  const ranked = bands.sort((a, b) => b.amplitude - a.amplitude)
  const kept: FrequencyBand[] = []
  let segments = 0
  for (const band of ranked) {
    const next = Math.max(0, band.centerline.length - 1)
    if (segments + next > 18) continue
    kept.push(band)
    segments += next
  }
  return kept
}
