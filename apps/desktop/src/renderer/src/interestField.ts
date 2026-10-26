import type { FieldSnapshot, SnapshotBand, SourceRecord } from '@intoponet/field-snapshot'

/** A renderer-safe, single-anchor observation. Presentation noise is not part of this data contract. */
export type InterestSignal = {
  id: string
  lat: number
  lon: number
  intensity: number
  /** Geodesic support radius in km; this is the zero-valued edge, not a line width. */
  radiusKm: number
  momentum: number | null
  confidence: number
  timestamp: string
  topicId: string
  sourceType: 'synthetic' | 'public-aggregate' | 'private-local'
}

export type InterestTextureData = {
  /** RGBA Float32: bounded intensity [0,1], signed momentum [-1,1], confidence [0,1], support [0,1]. */
  data: Float32Array
  width: number
  height: number
  /** Approximate equatorial texel spacing; narrower anchors are recorded, never widened. */
  pixelWidthKm: number
  undersampledSignalIds: string[]
}

export const INTEREST_FIELD_LIMITS = {
  signals: 2_048,
  texturePixels: 1_048_576,
  rasterWork: 64_000_000,
  maxDimension: 1_024,
  maxRadiusKm: 20_100,
} as const

const EARTH_RADIUS_KM = 6_371.0088
const DEG = Math.PI / 180
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

function validTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value))
}

function validateSignal(signal: InterestSignal): void {
  if (!signal || typeof signal !== 'object' || typeof signal.id !== 'string' || !signal.id || signal.id.length > 256 ||
      !Number.isFinite(signal.lat) || signal.lat < -90 || signal.lat > 90 ||
      !Number.isFinite(signal.lon) || signal.lon < -180 || signal.lon > 180 ||
      !Number.isFinite(signal.intensity) || signal.intensity < 0 || signal.intensity > 1 ||
      !Number.isFinite(signal.radiusKm) || signal.radiusKm <= 0 || signal.radiusKm > INTEREST_FIELD_LIMITS.maxRadiusKm ||
      (signal.momentum !== null && (!Number.isFinite(signal.momentum) || signal.momentum < -1 || signal.momentum > 1)) ||
      !Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1 ||
      !validTimestamp(signal.timestamp) || typeof signal.topicId !== 'string' || !signal.topicId || signal.topicId.length > 160 ||
      (signal.sourceType !== 'synthetic' && signal.sourceType !== 'public-aggregate' && signal.sourceType !== 'private-local')) {
    throw new TypeError('Interest signal is malformed or out of bounds.')
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Rasterize centered, geodesic influence fields. `radiusKm` is the exact support
 * edge: the compact Gaussian smoothly tapers to zero from 75% to 100% of that
 * radius. Pixels outside it receive no influence. Intensity and support are
 * independent channels, so a known quiet signal may have zero intensity while
 * retaining spatial support.
 */
export function buildInterestTextureData(
  inputSignals: InterestSignal[],
  width = 256,
  height = 128,
): InterestTextureData {
  if (!Array.isArray(inputSignals) || inputSignals.length > INTEREST_FIELD_LIMITS.signals) throw new RangeError(`Interest texture accepts at most ${INTEREST_FIELD_LIMITS.signals} signals.`)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2 ||
      width > INTEREST_FIELD_LIMITS.maxDimension || height > INTEREST_FIELD_LIMITS.maxDimension ||
      width * height > INTEREST_FIELD_LIMITS.texturePixels) throw new RangeError('Interest texture dimensions exceed bounds.')
  for (const signal of inputSignals) validateSignal(signal)
  const signals = [...inputSignals].sort((a, b) => a.id.localeCompare(b.id))
  if (new Set(signals.map((signal) => signal.id)).size !== signals.length) throw new TypeError('Interest signal IDs must be unique.')
  if (width * height * signals.length > INTEREST_FIELD_LIMITS.rasterWork) throw new RangeError('Interest texture exceeds its pixel/signal work budget.')

  const pixelWidthKm = Math.min(2 * Math.PI * EARTH_RADIUS_KM / width, Math.PI * EARTH_RADIUS_KM / height)
  const undersampledSignalIds = signals.filter((signal) => signal.radiusKm < pixelWidthKm).map((signal) => signal.id)
  const data = new Float32Array(width * height * 4)
  const confidenceWeight = new Float32Array(width * height)
  const confidenceSum = new Float32Array(width * height)
  const momentumWeight = new Float32Array(width * height)
  const momentumSum = new Float32Array(width * height)
  if (signals.length === 0) return { data, width, height, pixelWidthKm, undersampledSignalIds }

  const rowLatitudes = new Float64Array(height)
  const rowSin = new Float64Array(height)
  const rowCos = new Float64Array(height)
  for (let y = 0; y < height; y += 1) {
    const lat = ((y + 0.5) / height) * 180 - 90
    rowLatitudes[y] = lat
    rowSin[y] = Math.sin(lat * DEG)
    rowCos[y] = Math.cos(lat * DEG)
  }
  const columnSinLon = new Float64Array(width)
  const columnCosLon = new Float64Array(width)
  for (let x = 0; x < width; x += 1) {
    // This is the renderer's atan(-z, x) equirectangular convention.
    const lon = ((x + 0.5) / width) * 360 - 180
    columnSinLon[x] = Math.sin(lon * DEG)
    columnCosLon[x] = Math.cos(lon * DEG)
  }

  for (const signal of signals) {
    const anchorLat = signal.lat * DEG
    const anchorLon = signal.lon * DEG
    const anchorSinLat = Math.sin(anchorLat)
    const anchorCosLat = Math.cos(anchorLat)
    const anchorSinLon = Math.sin(anchorLon)
    const anchorCosLon = Math.cos(anchorLon)
    const angularRadius = Math.min(Math.PI, signal.radiusKm / EARTH_RADIUS_KM)
    const cosCutoff = Math.cos(angularRadius)
    const latitudeReach = angularRadius / DEG
    const firstY = Math.max(0, Math.ceil(((signal.lat - latitudeReach + 90) / 180) * height - 0.5))
    const lastY = Math.min(height - 1, Math.floor(((signal.lat + latitudeReach + 90) / 180) * height - 0.5))
    const sigmaRatio = 0.5

    for (let y = firstY; y <= lastY; y += 1) {
      const sinLat = rowSin[y]!
      const cosLat = rowCos[y]!
      const baseDot = sinLat * anchorSinLat
      const lonDotScale = cosLat * anchorCosLat
      for (let x = 0; x < width; x += 1) {
        const cosDeltaLon = columnCosLon[x]! * anchorCosLon + columnSinLon[x]! * anchorSinLon
        const cosDistance = baseDot + lonDotScale * cosDeltaLon
        // The dot test is an exact angular cap cull but avoids acos for misses.
        if (cosDistance < cosCutoff) continue
        const angle = Math.acos(clamp(cosDistance, -1, 1))
        const distanceRatio = angle / angularRadius
        const gaussian = Math.exp(-0.5 * (distanceRatio / sigmaRatio) ** 2)
        const envelope = gaussian * (1 - smoothstep(0.75, 1, distanceRatio))
        if (envelope <= 0) continue
        const offset = (y * width + x) * 4
        const intensity = envelope * signal.intensity
        const support = envelope
        // Bounded probabilistic union is order-independent in real arithmetic;
        // stable ID ordering keeps float accumulation deterministic in practice.
        data[offset] = 1 - (1 - data[offset]!) * (1 - intensity)
        data[offset + 3] = 1 - (1 - data[offset + 3]!) * (1 - support)
        const pixel = y * width + x
        confidenceWeight[pixel] = confidenceWeight[pixel]! + support
        confidenceSum[pixel] = confidenceSum[pixel]! + support * signal.confidence
        if (signal.momentum !== null && intensity > 0) {
          momentumWeight[pixel] = momentumWeight[pixel]! + intensity
          momentumSum[pixel] = momentumSum[pixel]! + intensity * signal.momentum
        }
      }
    }
  }
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4
    if (confidenceWeight[pixel]! > 0) data[offset + 2] = confidenceSum[pixel]! / confidenceWeight[pixel]!
    if (momentumWeight[pixel]! > 0) data[offset + 1] = momentumSum[pixel]! / momentumWeight[pixel]!
  }
  return { data, width, height, pixelWidthKm, undersampledSignalIds }
}

function sameMeasurement(a: SourceRecord['measurement'], b: SnapshotBand['measurement']): boolean {
  return a.kind === b.kind && a.unit === b.unit && (a.scale ?? '') === (b.scale ?? '')
}

/**
 * Adapt a legacy snapshot without rebuilding corridors or substituting the
 * aggregate band's quantized 10-degree anchor for original source coordinates.
 */
export function signalsFromSnapshot(snapshot: FieldSnapshot, topicId: string): InterestSignal[] {
  if (!snapshot || typeof topicId !== 'string' || !topicId) return []
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]))
  const result: InterestSignal[] = []
  const seen = new Set<string>()
  for (const band of snapshot.bands) {
    if (!band.topicIds.includes(topicId)) continue
    const sources = band.sourceIds
      .map((id) => sourceById.get(id))
      .filter((source): source is SourceRecord => !!source && source.topics.includes(topicId) && sameMeasurement(source.measurement, band.measurement))
    const uniqueAnchors = new Map<string, SourceRecord>()
    for (const source of sources) {
      const anchorKey = `${source.lat}|${source.lon}|${source.radiusKm}`
      if (!uniqueAnchors.has(anchorKey)) uniqueAnchors.set(anchorKey, source)
    }
    const anchors = [...uniqueAnchors.values()].sort((a, b) => a.id.localeCompare(b.id))
    if (!anchors.length) continue
    // Split a cell aggregate across its distinct source anchors so coincident
    // sources union back to the original band amplitude instead of saturating it.
    const perAnchorIntensity = 1 - Math.pow(1 - clamp(band.amplitude, 0, 1), 1 / anchors.length)
    for (const source of anchors) {
      if (seen.has(source.id) || !Number.isFinite(source.lat) || !Number.isFinite(source.lon) ||
          !Number.isFinite(source.radiusKm) || source.radiusKm <= 0) continue
      seen.add(source.id)
      result.push({
        id: source.id,
        lat: source.lat,
        lon: source.lon,
        intensity: perAnchorIntensity,
        radiusKm: source.radiusKm,
        momentum: null,
        confidence: clamp(band.confidence, 0, 1),
        timestamp: snapshot.createdAt,
        topicId,
        sourceType: band.sourceType,
      })
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

const fixtureTimestamp = '2026-10-24T12:00:00.000Z'
const fixtureRows: Array<[number, number, number, number, number, string]> = [
  [51.5, -0.1, 0.72, 5_200, 0.82, 'world-knowledge'],
  [48.9, 2.4, 0.58, 4_200, 0.76, 'world-knowledge'],
  [40.7, -74, 0.82, 4_700, 0.9, 'civic-memory'],
  [39.95, -75.16, 0.46, 3_100, 0.7, 'civic-memory'],
  [35.7, 139.8, 0.78, 5_000, 0.88, 'public-research'],
  [37.6, 126.98, 0.53, 3_600, 0.74, 'public-research'],
  [-33.9, 18.4, 0.64, 5_300, 0.79, 'local-archives'],
  [-26.2, 28.0, 0.42, 3_300, 0.68, 'local-archives'],
  [19.4, -99.1, 0.56, 4_900, 0.72, 'civic-memory'],
  [4.7, -74.1, 0.61, 3_400, 0.77, 'local-archives'],
  [28.6, 77.2, 0.67, 5_500, 0.75, 'public-research'],
  [31.2, 121.5, 0.71, 4_300, 0.81, 'world-knowledge'],
  [44.65, -63.6, 0.38, 900, 0.64, 'civic-memory'],
  [45.5, -73.6, 0.45, 1_400, 0.69, 'world-knowledge'],
]

/** Deterministic synthetic inputs: broad overlapping continental fields plus two minor regional anchors, not observations. */
export const syntheticInterestSignals: InterestSignal[] = fixtureRows.map(([lat, lon, intensity, radiusKm, confidence, topicId], index) => ({
  id: `synthetic-patch-${String(index + 1).padStart(2, '0')}`,
  lat,
  lon,
  intensity,
  radiusKm,
  momentum: index % 3 === 0 ? 0.22 : index % 3 === 1 ? -0.08 : null,
  confidence,
  timestamp: fixtureTimestamp,
  topicId,
  sourceType: 'synthetic',
}))

const previewWorldKnowledgeRows: Array<[number, number, number, number, number]> = [
  [51.5, -0.1, 0.62, 2_000, 0.8],
  [48.9, 2.4, 0.52, 1_700, 0.76],
  [6.5, 3.4, 0.48, 2_300, 0.72],
  [-1.3, 36.8, 0.54, 2_100, 0.78],
  [-22.9, -43.2, 0.58, 2_800, 0.8],
  [-33.9, 151.2, 0.46, 1_500, 0.7],
]

/** World-distributed synthetic Design-preview data. The reusable FieldLab fixture above remains unchanged. */
export const syntheticPreviewInterestSignals: InterestSignal[] = [
  ...syntheticInterestSignals.filter((signal) => signal.topicId !== 'world-knowledge'),
  ...previewWorldKnowledgeRows.map(([lat, lon, intensity, radiusKm, confidence], index) => ({
    id: `synthetic-preview-world-knowledge-${String(index + 1).padStart(2, '0')}`,
    lat,
    lon,
    intensity,
    radiusKm,
    momentum: index % 2 === 0 ? 0.12 : -0.06,
    confidence,
    timestamp: fixtureTimestamp,
    topicId: 'world-knowledge',
    sourceType: 'synthetic' as const,
  })),
]
