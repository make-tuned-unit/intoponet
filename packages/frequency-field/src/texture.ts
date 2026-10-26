import { angleBetween, distToArc, latLonToUnit } from './geo'
import type { GeoPoint, FrequencyBand, Vec3 } from './types'
import {
  DEFAULT_PHASE_MODULATION,
  EARTH_RADIUS_KM,
  FIELD_TEXTURE_NORMALIZATION,
  MAX_FIELD_TEXTURE_BANDS,
  MAX_PHASE_MODULATION,
  MIN_PHASE_MODULATION,
} from './types'

export type FrequencyScale = 'earth' | 'region' | 'city' | 'topic'
export type TextureGeographyState = 'observed' | 'low_observed' | 'insufficient' | 'stale'

export type FieldTextureManifest = {
  schemaVersion: 'intoponet.frequency-field-texture.v1'
  dataVersion: string
  scale: FrequencyScale
  width: number
  height: number
  normalizationVersion: typeof FIELD_TEXTURE_NORMALIZATION
  bandIds: string[]
  sourceIds: string[]
  observationStart: string | null
  observationEnd: string | null
  tilePublishedAt: string | null
  historicalTime: string | null
  provenanceManifestId: string | null
  provenanceManifestIds: string[]
  sourceSnapshotId: string | null
  sourceSnapshotIds: string[]
  provenanceStatus: 'complete' | 'provisional' | 'synthetic' | 'none'
  minimumResolvedWidthKm: number
  sourceType: 'synthetic' | 'public-aggregate' | 'none'
  projection: 'equirectangular' | 'local-azimuthal-equidistant'
  detailCenter: GeoPoint | null
  detailHalfExtentKm: number | null
  pixelWidthKm: number | null
  snapshotTransition: { fromVersion: string; toVersion: string; progress: number } | null
}

export type FieldTextureBundle = {
  width: number
  height: number
  /** RGBA8 = intensity, signed momentum encoded to [0,1], geographic confidence, coverage. */
  field: Uint8Array
  /** RGBA8 = spatial phase cosine/sine encoded to [0,1], phase velocity, effective beta. */
  wave: Uint8Array
  manifest: FieldTextureManifest
}

export type FieldTextureOptions = {
  observationStart?: string
  observationEnd?: string
  tilePublishedAt?: string
  historicalTime?: string
  provenanceManifestId?: string
  sourceSnapshotId?: string
  detail?: { center: GeoPoint; halfExtentKm: number }
}

export type FieldTextureLods = Record<FrequencyScale, FieldTextureBundle>
export type FieldSnapshotTransitionOptions = { startedAtMs: number; durationMs?: number }

export const FIELD_TEXTURE_SIZE: Record<FrequencyScale, { width: number; height: number }> = {
  earth: { width: 512, height: 256 },
  region: { width: 384, height: 192 },
  city: { width: 512, height: 256 },
  topic: { width: 512, height: 256 },
}

export const MAX_FIELD_TEXTURE_SEGMENTS = 128
/** Hard cap on pixel/segment evaluations; bounds CPU work for detail tiles. */
export const MAX_FIELD_TEXTURE_WORK = 32_000_000
const MAX_POINTS_PER_BAND = 256
const MAX_PHASE_VELOCITY = 0.25
const DISPLACEMENT_GAIN = 1.35
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))
const toByte = (n: number): number => Math.round(clamp(n, 0, 1) * 255)
const encodeSignedByte = (n: number): number => {
  const value = clamp(n, -1, 1)
  return Math.round(value <= 0 ? (value + 1) * 128 : 128 + value * 127)
}
const decodeSignedByte = (byte: number): number => byte <= 128 ? byte / 128 - 1 : (byte - 128) / 127
const finiteOr = (n: unknown, fallback: number): number => typeof n === 'number' && Number.isFinite(n) ? n : fallback

export const FIELD_DETAIL_TEXTURE_SIZE: Record<FrequencyScale, number> = {
  earth: 256,
  region: 256,
  city: 512,
  topic: 1024,
}
const DETAIL_HALF_EXTENT_KM: Record<FrequencyScale, number> = { earth: 8000, region: 1800, city: 360, topic: 40 }

function localPoint(center: GeoPoint, eastKm: number, northKm: number): GeoPoint {
  const lat = center.lat * Math.PI / 180
  const lon = center.lon * Math.PI / 180
  const c = latLonToUnit(center.lat, center.lon)
  const east = { x: -Math.sin(lon), y: 0, z: Math.cos(lon) }
  const north = { x: -Math.sin(lat) * Math.cos(lon), y: Math.cos(lat), z: -Math.sin(lat) * Math.sin(lon) }
  const distance = Math.hypot(eastKm, northKm) / EARTH_RADIUS_KM
  if (distance < 1e-12) return center
  const inverse = 1 / Math.hypot(eastKm, northKm)
  const dx = east.x * eastKm * inverse + north.x * northKm * inverse
  const dy = east.y * eastKm * inverse + north.y * northKm * inverse
  const dz = east.z * eastKm * inverse + north.z * northKm * inverse
  const x = c.x * Math.cos(distance) + dx * Math.sin(distance)
  const y = c.y * Math.cos(distance) + dy * Math.sin(distance)
  const z = c.z * Math.cos(distance) + dz * Math.sin(distance)
  return { lat: Math.asin(clamp(y, -1, 1)) * 180 / Math.PI, lon: Math.atan2(z, x) * 180 / Math.PI }
}

type RasterSegment = {
  start: Vec3
  end: Vec3
  center: Vec3
  minDot: number
  bandIndex: number
  sigma: number
  lambda: number
  alongOffset: number
  phase: number
  omega: number
  beta: number
}

function validBand(band: FrequencyBand): boolean {
  return typeof band.id === 'string' && band.id.length > 0 && band.id.length <= 160 &&
    isUtcTimestamp(band.updatedAt) &&
    Array.isArray(band.centerline) && band.centerline.length >= 2 && band.centerline.length <= MAX_POINTS_PER_BAND &&
    band.centerline.every((point) => Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 && Number.isFinite(point.lon) && point.lon >= -180 && point.lon <= 180) &&
    Number.isFinite(band.widthKm) && band.widthKm > 0 && band.widthKm <= 20_100 &&
    Number.isFinite(band.wavelengthKm) && band.wavelengthKm > 0 && band.wavelengthKm <= 100_000 &&
    Number.isFinite(band.amplitude) && band.amplitude >= 0 && band.amplitude <= 1 &&
    Number.isFinite(band.phase) && Math.abs(band.phase) <= 1_000_000 && Number.isFinite(band.phaseVelocity) &&
    Number.isFinite(band.confidence) && band.confidence >= 0 && band.confidence <= 1 &&
    Array.isArray(band.topicIds) && band.topicIds.length <= 256 && band.topicIds.every((topicId) => typeof topicId === 'string' && topicId.length > 0 && topicId.length <= 160) &&
    (band.category === undefined || (typeof band.category === 'string' && band.category.length <= 160)) &&
    (band.sourceType === 'synthetic' || band.sourceType === 'public-aggregate') &&
    (band.phaseModulation === undefined || (Number.isFinite(band.phaseModulation) && band.phaseModulation >= 0 && band.phaseModulation <= 1)) &&
    (band.momentum === undefined || (Number.isFinite(band.momentum) && band.momentum >= -1 && band.momentum <= 1)) &&
    (band.geographicConfidence === undefined || (Number.isFinite(band.geographicConfidence) && band.geographicConfidence >= 0 && band.geographicConfidence <= 1)) &&
    (band.coverageConfidence === undefined || (Number.isFinite(band.coverageConfidence) && band.coverageConfidence >= 0 && band.coverageConfidence <= 1)) &&
    (band.sourceIds === undefined || (Array.isArray(band.sourceIds) && band.sourceIds.length <= 20_000 && band.sourceIds.every((sourceId) => typeof sourceId === 'string' && sourceId.length > 0 && sourceId.length <= 160))) &&
    (band.sourceSnapshotId === undefined || /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(band.sourceSnapshotId)) &&
    (band.provenanceManifestId === undefined || /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(band.provenanceManifestId)) &&
    (band.provisional === undefined || typeof band.provisional === 'boolean') &&
    (band.observationStart === undefined || isUtcTimestamp(band.observationStart)) &&
    (band.observationEnd === undefined || isUtcTimestamp(band.observationEnd)) &&
    (!(band.observationStart && band.observationEnd) || Date.parse(band.observationStart) <= Date.parse(band.observationEnd))
}

function isUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return false
  const canonical = value.includes('.')
    ? value.replace(/\.(\d{1,3})Z$/, (_match, digits: string) => `.${digits.padEnd(3, '0')}Z`)
    : value.replace(/Z$/, '.000Z')
  return new Date(time).toISOString() === canonical
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  let second = 0x9e3779b9
  for (let index = input.length - 1; index >= 0; index -= 1) {
    second = Math.imul(second ^ input.charCodeAt(index), 0x85ebca6b) >>> 0
  }
  return `${hash.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

function buildSegments(bands: FrequencyBand[]): RasterSegment[] {
  const segments: RasterSegment[] = []
  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
    const band = bands[bandIndex]!
    const beta = clamp(finiteOr(band.phaseModulation, DEFAULT_PHASE_MODULATION), MIN_PHASE_MODULATION, MAX_PHASE_MODULATION)
    let alongOffset = 0
    for (let index = 1; index < band.centerline.length; index += 1) {
      const start = band.centerline[index - 1]!
      const end = band.centerline[index]!
      const startUnit = latLonToUnit(start.lat, start.lon)
      const endUnit = latLonToUnit(end.lat, end.lon)
      const sigma = Math.max(1e-8, band.widthKm / EARTH_RADIUS_KM / 2)
      const arcLength = angleBetween(startUnit, endUnit)
      const centerVector = {
        x: startUnit.x + endUnit.x,
        y: startUnit.y + endUnit.y,
        z: startUnit.z + endUnit.z,
      }
      const centerLength = Math.hypot(centerVector.x, centerVector.y, centerVector.z)
      const center = centerLength > 1e-8
        ? { x: centerVector.x / centerLength, y: centerVector.y / centerLength, z: centerVector.z / centerLength }
        : startUnit
      // Any point farther than 4.3 sigma from this conservative arc cap would
      // be skipped by the envelope cutoff below. Avoid expensive exact arc
      // projection for those pixels; antipodal arcs retain the full sphere.
      const capRadius = arcLength > Math.PI - 1e-5 ? Math.PI : arcLength / 2 + 4.3 * sigma
      segments.push({
        start: startUnit,
        end: endUnit,
        center,
        minDot: capRadius >= Math.PI ? -1 : Math.cos(capRadius),
        bandIndex,
        // Preserve the supplied physical width even when it falls below a
        // texture texel; the manifest reports that resolution limit explicitly.
        sigma,
        lambda: Math.max(0.02, band.wavelengthKm / EARTH_RADIUS_KM),
        alongOffset,
        phase: band.phase,
        omega: clamp(band.phaseVelocity, -MAX_PHASE_VELOCITY, MAX_PHASE_VELOCITY),
        beta,
      })
      // distToArc reports local angular distance from each segment's start.
      // Carry prior geodesic lengths forward so phase does not reset at joints.
      alongOffset += angleBetween(startUnit, endUnit)
    }
  }
  return segments
}

export function phaseModulateBaseline(intensity: number, beta: number, phase: number): number {
  const headroom = Math.min(intensity, 1 - intensity)
  return intensity + headroom * beta * Math.cos(phase)
}

export function fieldChannelsAt(
  bundle: FieldTextureBundle,
  lat: number,
  lon: number,
  timeSeconds = 0,
): { intensity: number; baselineIntensity: number; momentum: number; geographicConfidence: number; coverage: number; phase: number; phaseVelocity: number; phaseModulation: number } {
  const field = sampleRgba(bundle.field, bundle.width, bundle.height, lat, lon, bundle.manifest)
  const wave = sampleRgba(bundle.wave, bundle.width, bundle.height, lat, lon, bundle.manifest)
  const baselineIntensity = field[0]
  const noLocalSample = bundle.manifest.projection === 'local-azimuthal-equidistant' && field.every((channel) => channel === 0)
  const beta = noLocalSample ? 0 : wave[3] * MAX_PHASE_MODULATION
  const phase = noLocalSample ? 0 : Math.atan2(wave[1] * 2 - 1, wave[0] * 2 - 1)
  const omega = noLocalSample ? 0 : decodeSignedByte(wave[2] * 255) * MAX_PHASE_VELOCITY
  return {
    intensity: phaseModulateBaseline(baselineIntensity, beta, phase + omega * timeSeconds),
    baselineIntensity,
    momentum: noLocalSample ? 0 : decodeSignedByte(field[1] * 255),
    geographicConfidence: field[2],
    coverage: field[3],
    phase,
    phaseVelocity: omega,
    phaseModulation: beta,
  }
}

export function textureDisplacementAt(bundle: FieldTextureBundle, lat: number, lon: number, timeSeconds: number, dMax: number): number {
  return dMax * fieldChannelsAt(bundle, lat, lon, timeSeconds).intensity
}

function sampleRgba(data: Uint8Array, width: number, height: number, lat: number, lon: number, manifest?: FieldTextureManifest): [number, number, number, number] {
  let u: number
  let v: number
  const localProjection = manifest?.projection === 'local-azimuthal-equidistant' && manifest.detailCenter && manifest.detailHalfExtentKm
  if (localProjection && manifest?.detailCenter && manifest.detailHalfExtentKm) {
    const p = latLonToUnit(lat, lon)
    const center = latLonToUnit(manifest.detailCenter.lat, manifest.detailCenter.lon)
    const angle = Math.acos(clamp(center.x * p.x + center.y * p.y + center.z * p.z, -1, 1))
    if (angle > 2.3) return [0, 0, 0, 0]
    const scale = angle < 1e-8 ? 0 : angle / Math.sin(angle)
    const tx = (p.x - center.x * Math.cos(angle)) * scale
    const ty = (p.y - center.y * Math.cos(angle)) * scale
    const tz = (p.z - center.z * Math.cos(angle)) * scale
    const lat0 = manifest.detailCenter.lat * Math.PI / 180
    const lon0 = manifest.detailCenter.lon * Math.PI / 180
    const east = { x: -Math.sin(lon0), y: 0, z: Math.cos(lon0) }
    const north = { x: -Math.sin(lat0) * Math.cos(lon0), y: Math.cos(lat0), z: -Math.sin(lat0) * Math.sin(lon0) }
    u = ((tx * east.x + ty * east.y + tz * east.z) * EARTH_RADIUS_KM) / (2 * manifest.detailHalfExtentKm) + 0.5
    v = ((tx * north.x + ty * north.y + tz * north.z) * EARTH_RADIUS_KM) / (2 * manifest.detailHalfExtentKm) + 0.5
    if (u < 0 || u > 1 || v < 0 || v > 1) return [0, 0, 0, 0]
  } else {
    u = ((lon + 180) / 360 + 1) % 1
    v = clamp((lat + 90) / 180, 0, 1)
  }
  const rawX = u * width - 0.5
  const x = localProjection ? clamp(rawX, 0, width - 1) : rawX
  const y = clamp(v * height - 0.5, 0, height - 1)
  const x0Raw = Math.floor(x)
  const x0 = localProjection ? clamp(x0Raw, 0, width - 1) : (x0Raw % width + width) % width
  const x1 = localProjection ? clamp(x0 + 1, 0, width - 1) : (x0 + 1) % width
  const fx = x - x0Raw
  const y0 = Math.floor(y)
  const y1 = clamp(y0 + 1, 0, height - 1)
  const fy = clamp(y - y0, 0, 1)
  const out: number[] = []
  for (let channel = 0; channel < 4; channel += 1) {
    const read = (px: number, py: number) => (data[(py * width + px) * 4 + channel] ?? 0) / 255
    const top = read(x0, y0) * (1 - fx) + read(x1, y0) * fx
    const bottom = read(x0, y1) * (1 - fx) + read(x1, y1) * fx
    out.push(top * (1 - fy) + bottom * fy)
  }
  return out as [number, number, number, number]
}

export function interpolateFieldTextures(from: FieldTextureBundle, to: FieldTextureBundle, amount: number): FieldTextureBundle {
  if (!Number.isFinite(amount)) throw new Error('Texture interpolation amount must be finite.')
  const t = clamp(amount, 0, 1)
  if (t === 0) return from
  if (t === 1) return to
  const contributingTypes = new Set([from.manifest.sourceType, to.manifest.sourceType].filter((type) => type !== 'none'))
  if (contributingTypes.size > 1) throw new Error('Synthetic and public field textures cannot share a snapshot transition.')
  const resample = (data: Uint8Array, width: number, height: number): Uint8Array => {
    const output = new Uint8Array(to.width * to.height * 4)
    for (let y = 0; y < to.height; y += 1) {
      for (let x = 0; x < to.width; x += 1) {
        const geo = to.manifest.projection === 'local-azimuthal-equidistant' && to.manifest.detailCenter && to.manifest.detailHalfExtentKm
          ? localPoint(to.manifest.detailCenter, ((x + 0.5) / to.width - 0.5) * to.manifest.detailHalfExtentKm * 2, ((y + 0.5) / to.height - 0.5) * to.manifest.detailHalfExtentKm * 2)
          : { lat: y === 0 ? -90 : y === to.height - 1 ? 90 : ((y + 0.5) / to.height) * 180 - 90, lon: y === 0 || y === to.height - 1 ? 0 : ((x + 0.5) / to.width) * 360 - 180 }
        const rgba = sampleRgba(data, width, height, geo.lat, geo.lon, from.manifest)
        const index = (y * to.width + x) * 4
        for (let channel = 0; channel < 4; channel += 1) output[index + channel] = toByte(rgba[channel]!)
      }
    }
    return output
  }
  const mixField = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const fromData = resample(a, from.width, from.height)
    const output = new Uint8Array(b.length)
    for (let i = 0; i < output.length; i += 4) {
      if (t === 0) {
        output.set(fromData.subarray(i, i + 4), i)
        continue
      }
      if (t === 1) {
        output.set(b.subarray(i, i + 4), i)
        continue
      }
      output[i] = Math.round((fromData[i] ?? 0) * (1 - t) + (b[i] ?? 0) * t)
      const m0 = decodeSignedByte(fromData[i + 1] ?? 128)
      const m1 = decodeSignedByte(b[i + 1] ?? 128)
      output[i + 1] = encodeSignedByte(m0 * (1 - t) + m1 * t)
      output[i + 2] = Math.round((fromData[i + 2] ?? 0) * (1 - t) + (b[i + 2] ?? 0) * t)
      output[i + 3] = Math.round((fromData[i + 3] ?? 0) * (1 - t) + (b[i + 3] ?? 0) * t)
    }
    return output
  }
  const mixWave = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const fromData = resample(a, from.width, from.height)
    const output = new Uint8Array(b.length)
    for (let i = 0; i < output.length; i += 4) {
      if (t === 0) {
        output.set(fromData.subarray(i, i + 4), i)
        continue
      }
      if (t === 1) {
        output.set(b.subarray(i, i + 4), i)
        continue
      }
      const angle0 = Math.atan2((fromData[i + 1] ?? 128) / 127.5 - 1, (fromData[i] ?? 128) / 127.5 - 1)
      const angle1 = Math.atan2((b[i + 1] ?? 128) / 127.5 - 1, (b[i] ?? 128) / 127.5 - 1)
      const delta = Math.atan2(Math.sin(angle1 - angle0), Math.cos(angle1 - angle0))
      const angle = angle0 + delta * t
      output[i] = toByte((Math.cos(angle) + 1) / 2)
      output[i + 1] = toByte((Math.sin(angle) + 1) / 2)
      const omega = decodeSignedByte(fromData[i + 2] ?? 128) * (1 - t) + decodeSignedByte(b[i + 2] ?? 128) * t
      output[i + 2] = encodeSignedByte(omega)
      output[i + 3] = Math.round((fromData[i + 3] ?? 0) * (1 - t) + (b[i + 3] ?? 0) * t)
    }
    return output
  }
  const sourceType = [...contributingTypes][0] ?? 'none'
  const provenanceManifestIds = [...new Set([...from.manifest.provenanceManifestIds, ...to.manifest.provenanceManifestIds])].sort()
  const sourceSnapshotIds = [...new Set([...from.manifest.sourceSnapshotIds, ...to.manifest.sourceSnapshotIds])].sort()
  const contributingBundles = [from, to].filter((bundle) => bundle.manifest.sourceType !== 'none')
  const provenanceStatus: FieldTextureManifest['provenanceStatus'] = sourceType === 'synthetic'
    ? 'synthetic'
    : sourceType === 'none'
      ? 'none'
      : contributingBundles.every((bundle) => bundle.manifest.provenanceStatus === 'complete') && provenanceManifestIds.length === 1 && sourceSnapshotIds.length === 1
        ? 'complete'
        : 'provisional'
  const observationStarts = [from.manifest.observationStart, to.manifest.observationStart].filter((value): value is string => value !== null).sort()
  const observationEnds = [from.manifest.observationEnd, to.manifest.observationEnd].filter((value): value is string => value !== null).sort()
  const manifest: FieldTextureManifest = {
    ...to.manifest,
    dataVersion: `${from.manifest.dataVersion}->${to.manifest.dataVersion}@${t.toFixed(4)}`,
    bandIds: [...new Set([...from.manifest.bandIds, ...to.manifest.bandIds])].sort(),
    sourceIds: [...new Set([...from.manifest.sourceIds, ...to.manifest.sourceIds])].sort(),
    observationStart: observationStarts[0] ?? null,
    observationEnd: observationEnds[observationEnds.length - 1] ?? null,
    sourceType,
    provenanceManifestId: provenanceManifestIds.length === 1 ? provenanceManifestIds[0]! : null,
    provenanceManifestIds,
    sourceSnapshotId: sourceSnapshotIds.length === 1 ? sourceSnapshotIds[0]! : null,
    sourceSnapshotIds,
    provenanceStatus,
    snapshotTransition: { fromVersion: from.manifest.dataVersion, toVersion: to.manifest.dataVersion, progress: t },
  }
  return { width: to.width, height: to.height, field: mixField(from.field, to.field), wave: mixWave(from.wave, to.wave), manifest }
}

/** Creates a deterministic 10–30 second snapshot transition. Reduced motion is deliberately not part of this clock. */
export function createFieldSnapshotTransition(
  from: FieldTextureBundle,
  to: FieldTextureBundle,
  options: FieldSnapshotTransitionOptions,
): { durationMs: number; sample(nowMs: number): FieldTextureBundle; progress(nowMs: number): number; complete(nowMs: number): boolean } {
  const durationMs = options.durationMs ?? 20_000
  if (!Number.isFinite(options.startedAtMs) || !Number.isFinite(durationMs) || durationMs < 10_000 || durationMs > 30_000) {
    throw new Error('Snapshot transition duration must be between 10 and 30 seconds with a finite start time.')
  }
  const progress = (nowMs: number) => {
    if (!Number.isFinite(nowMs)) throw new Error('Snapshot transition time must be finite.')
    return clamp((nowMs - options.startedAtMs) / durationMs, 0, 1)
  }
  return {
    durationMs,
    progress,
    complete: (nowMs) => progress(nowMs) >= 1,
    sample: (nowMs) => interpolateFieldTextures(from, to, progress(nowMs)),
  }
}

/** Phase is a material clock only; callers should continue snapshot transitions when reduced motion is enabled. */
export function materialPhaseTimeSeconds(elapsedSeconds: number, reducedMotion: boolean): number {
  if (!Number.isFinite(elapsedSeconds)) throw new Error('Material phase time must be finite.')
  return reducedMotion ? 0 : elapsedSeconds
}

export function buildFieldTexture(
  inputBands: FrequencyBand[],
  scale: FrequencyScale = 'earth',
  options: FieldTextureOptions = {},
): FieldTextureBundle {
  if (inputBands.length > MAX_FIELD_TEXTURE_BANDS) throw new Error(`Field texture accepts at most ${MAX_FIELD_TEXTURE_BANDS} bands.`)
  if (inputBands.some((band) => !validBand(band))) throw new Error('Field texture contains a malformed or out-of-range band.')
  const bands = [...inputBands].sort((a, b) => a.id.localeCompare(b.id))
  if (new Set(bands.map((band) => band.id)).size !== bands.length) throw new Error('Field texture band IDs must be unique.')
  const segments = buildSegments(bands)
  if (segments.length > MAX_FIELD_TEXTURE_SEGMENTS) throw new Error(`Field texture accepts at most ${MAX_FIELD_TEXTURE_SEGMENTS} line segments.`)
  if (options.detail && (!Number.isFinite(options.detail.center.lat) || options.detail.center.lat < -90 || options.detail.center.lat > 90 || !Number.isFinite(options.detail.center.lon) || options.detail.center.lon < -180 || options.detail.center.lon > 180 || !Number.isFinite(options.detail.halfExtentKm) || options.detail.halfExtentKm <= 0 || options.detail.halfExtentKm > 10_000)) throw new Error('Invalid local detail bounds.')
  const { width: globalWidth, height: globalHeight } = FIELD_TEXTURE_SIZE[scale]
  const width = options.detail ? FIELD_DETAIL_TEXTURE_SIZE[scale] : globalWidth
  const height = options.detail ? FIELD_DETAIL_TEXTURE_SIZE[scale] : globalHeight
  if (width * height * segments.length > MAX_FIELD_TEXTURE_WORK) throw new Error(`Field texture exceeds the ${MAX_FIELD_TEXTURE_WORK.toLocaleString()} pixel/segment work budget.`)
  const field = new Uint8Array(width * height * 4)
  const wave = new Uint8Array(width * height * 4)
  const bandsByIndex = bands
  const bandEnvelope = new Float32Array(bands.length)
  const bandCoverage = new Float32Array(bands.length)
  const bandPhaseCos = new Float32Array(bands.length)
  const bandPhaseSin = new Float32Array(bands.length)
  const bandOmega = new Float32Array(bands.length)
  const bandBeta = new Float32Array(bands.length)
  const bandPhaseWeight = new Float32Array(bands.length)

  for (let y = 0; y < height; y += 1) {
    const latitude = y === 0 ? -90 : y === height - 1 ? 90 : ((y + 0.5) / height) * 180 - 90
    for (let x = 0; x < width; x += 1) {
      const longitude = y === 0 || y === height - 1 ? 0 : ((x + 0.5) / width) * 360 - 180
      const geo = options.detail
        ? localPoint(options.detail.center, ((x + 0.5) / width - 0.5) * options.detail.halfExtentKm * 2, ((y + 0.5) / height - 0.5) * options.detail.halfExtentKm * 2)
        : { lat: latitude, lon: longitude }
      const point = latLonToUnit(geo.lat, geo.lon)
      bandEnvelope.fill(0)
      bandCoverage.fill(0)
      bandPhaseCos.fill(0)
      bandPhaseSin.fill(0)
      bandOmega.fill(0)
      bandBeta.fill(0)
      bandPhaseWeight.fill(0)
      for (const segment of segments) {
        if (point.x * segment.center.x + point.y * segment.center.y + point.z * segment.center.z < segment.minDot) continue
        const nearest = distToArc(point, segment.start, segment.end)
        const envelope = Math.exp(-0.5 * (nearest.distance / segment.sigma) ** 2)
        if (envelope < 0.0001) continue
        const band = bandsByIndex[segment.bandIndex]!
        const coverage = envelope * clamp(finiteOr(band.coverageConfidence, band.confidence), 0, 1)
        const previous = bandEnvelope[segment.bandIndex] ?? 0
        // Use the nearest/strongest segment per band so joins do not double-count.
        if (envelope <= previous) continue
        bandEnvelope[segment.bandIndex] = envelope
        bandCoverage[segment.bandIndex] = coverage
        const baseWeight = clamp(band.amplitude, 0, 1) * envelope
        const angle = (2 * Math.PI * (segment.alongOffset + nearest.along)) / segment.lambda + segment.phase
        bandPhaseCos[segment.bandIndex] = Math.cos(angle) * baseWeight
        bandPhaseSin[segment.bandIndex] = Math.sin(angle) * baseWeight
        bandOmega[segment.bandIndex] = segment.omega * baseWeight
        bandBeta[segment.bandIndex] = segment.beta * baseWeight
        bandPhaseWeight[segment.bandIndex] = baseWeight
      }
      let activitySum = 0
      let coverageSum = 0
      let confidenceSum = 0
      let confidenceWeight = 0
      let momentumSum = 0
      let momentumWeight = 0
      let phaseCos = 0
      let phaseSin = 0
      let omegaSum = 0
      let betaSum = 0
      let phaseWeight = 0
      for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
        const band = bands[bandIndex]!
        const envelope = bandEnvelope[bandIndex] ?? 0
        const coverage = bandCoverage[bandIndex] ?? 0
        if (envelope <= 0) continue
        const phaseWeightForBand = bandPhaseWeight[bandIndex] ?? 0
        // Activity is not reduced by uncertainty; coverage/confidence stay separate.
        activitySum += clamp(band.amplitude, 0, 1) * envelope
        coverageSum += coverage
        const confidence = clamp(finiteOr(band.geographicConfidence, band.confidence), 0, 1)
        confidenceSum += confidence * envelope
        confidenceWeight += envelope
        if (phaseWeightForBand > 0) {
          phaseCos += bandPhaseCos[bandIndex] ?? 0
          phaseSin += bandPhaseSin[bandIndex] ?? 0
          omegaSum += bandOmega[bandIndex] ?? 0
          betaSum += bandBeta[bandIndex] ?? 0
          phaseWeight += phaseWeightForBand
        }
        const momentumWeightForBand = envelope * Math.max(0.05, clamp(band.amplitude, 0, 1))
        momentumSum += clamp(finiteOr(band.momentum, 0), -1, 1) * momentumWeightForBand
        momentumWeight += momentumWeightForBand
      }
      const index = (y * width + x) * 4
      const intensity = 1 - Math.exp(-DISPLACEMENT_GAIN * activitySum)
      const coverage = 1 - Math.exp(-coverageSum)
      const confidence = confidenceWeight > 0 ? confidenceSum / confidenceWeight : 0
      const momentum = momentumWeight > 0 ? momentumSum / momentumWeight : 0
      field[index] = toByte(intensity)
      field[index + 1] = encodeSignedByte(momentum)
      field[index + 2] = toByte(confidence)
      field[index + 3] = toByte(coverage)
      const vectorLength = Math.hypot(phaseCos, phaseSin)
      const coherence = phaseWeight > 0 ? clamp(vectorLength / phaseWeight, 0, 1) : 0
      const phaseX = vectorLength > 0 ? phaseCos / vectorLength : 0
      const phaseY = vectorLength > 0 ? phaseSin / vectorLength : 0
      const omega = phaseWeight > 0 ? omegaSum / phaseWeight : 0
      wave[index] = toByte((phaseX + 1) / 2)
      wave[index + 1] = toByte((phaseY + 1) / 2)
      wave[index + 2] = encodeSignedByte(omega / MAX_PHASE_VELOCITY)
      const beta = phaseWeight > 0 ? betaSum / phaseWeight : 0
      wave[index + 3] = toByte((beta * coherence) / MAX_PHASE_MODULATION)
    }
  }

  const canonical = bands.map((band) => ({
    id: band.id,
    topicIds: [...band.topicIds].sort(),
    category: band.category ?? null,
    centerline: band.centerline,
    widthKm: band.widthKm,
    wavelengthKm: band.wavelengthKm,
    amplitude: clamp(band.amplitude, 0, 1),
    phase: band.phase,
    phaseVelocity: clamp(band.phaseVelocity, -MAX_PHASE_VELOCITY, MAX_PHASE_VELOCITY),
    phaseModulation: clamp(finiteOr(band.phaseModulation, DEFAULT_PHASE_MODULATION), MIN_PHASE_MODULATION, MAX_PHASE_MODULATION),
    momentum: clamp(finiteOr(band.momentum, 0), -1, 1),
    confidence: band.confidence,
    coverageConfidence: finiteOr(band.coverageConfidence, band.confidence),
    geographicConfidence: finiteOr(band.geographicConfidence, band.confidence),
    sourceType: band.sourceType,
    sourceIds: band.sourceIds ?? [],
    sourceSnapshotId: band.sourceSnapshotId ?? null,
    provenanceManifestId: band.provenanceManifestId ?? null,
    provisional: band.provisional ?? false,
    observationStart: band.observationStart ?? null,
    observationEnd: band.observationEnd ?? null,
    updatedAt: band.updatedAt,
  }))
  const sourceTypes = new Set(bands.map((band) => band.sourceType))
  if (sourceTypes.size > 1) throw new Error('Synthetic and public field bands cannot share a texture bundle.')
  const sourceType = bands[0]?.sourceType ?? 'none'
  const bandProvenanceIds = new Set(bands.map((band) => band.provenanceManifestId).filter((value): value is string => Boolean(value)))
  if (bandProvenanceIds.size > 1) throw new Error('Field bands must refer to one provenance manifest.')
  const provenanceManifestId = options.provenanceManifestId ?? [...bandProvenanceIds][0] ?? null
  if (options.provenanceManifestId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(options.provenanceManifestId)) throw new Error('Invalid provenance manifest ID.')
  if (options.sourceSnapshotId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(options.sourceSnapshotId)) throw new Error('Invalid source snapshot ID.')
  if (bandProvenanceIds.size === 1 && options.provenanceManifestId && options.provenanceManifestId !== [...bandProvenanceIds][0]) throw new Error('Field options conflict with the band provenance manifest.')
  for (const timestamp of [options.observationStart, options.observationEnd, options.tilePublishedAt, options.historicalTime]) {
    if (timestamp !== undefined && !isUtcTimestamp(timestamp)) throw new Error('Field texture clock metadata must use valid UTC timestamps.')
  }
  const observationStarts = bands.map((band) => band.observationStart).filter((value): value is string => Boolean(value)).sort()
  const observationEnds = bands.map((band) => band.observationEnd).filter((value): value is string => Boolean(value)).sort()
  const observationStart = options.observationStart ?? observationStarts[0] ?? null
  const observationEnd = options.observationEnd ?? observationEnds[observationEnds.length - 1] ?? null
  if (observationStart && observationEnd && Date.parse(observationStart) > Date.parse(observationEnd)) throw new Error('Observation window start must be before its end.')
  const sourceSnapshotIds = new Set(bands.map((band) => band.sourceSnapshotId).filter((value): value is string => Boolean(value)))
  if (sourceSnapshotIds.size > 1) throw new Error('Field bands must refer to one source snapshot.')
  if (sourceSnapshotIds.size === 1 && options.sourceSnapshotId && options.sourceSnapshotId !== [...sourceSnapshotIds][0]) throw new Error('Field options conflict with the band source snapshot.')
  const hasCompletePublicProvenance = sourceType === 'public-aggregate' && Boolean(provenanceManifestId) && bands.length > 0 && sourceSnapshotIds.size === 1 &&
    bands.every((band) => band.provenanceManifestId === provenanceManifestId && Boolean(band.sourceSnapshotId) &&
      Boolean(band.sourceIds?.length) && Boolean(band.observationStart) && Boolean(band.observationEnd) && band.provisional !== true)
  const sourceIds = [...new Set(bands.flatMap((band) => band.sourceIds ?? []))].sort()
  const halfExtent = options.detail?.halfExtentKm ?? null
  const minResolution = halfExtent === null
    ? Math.max((Math.PI * EARTH_RADIUS_KM) / height, (2 * Math.PI * EARTH_RADIUS_KM) / width)
    : (2 * halfExtent) / width
  const manifestCore: Omit<FieldTextureManifest, 'dataVersion'> = {
    schemaVersion: 'intoponet.frequency-field-texture.v1' as const,
    scale,
    width,
    height,
    normalizationVersion: FIELD_TEXTURE_NORMALIZATION as typeof FIELD_TEXTURE_NORMALIZATION,
    bandIds: bands.map((band) => band.id),
    sourceIds,
    observationStart,
    observationEnd,
    tilePublishedAt: options.tilePublishedAt ?? null,
    historicalTime: options.historicalTime ?? null,
    provenanceManifestId,
    provenanceManifestIds: provenanceManifestId ? [provenanceManifestId] : [],
    sourceSnapshotId: options.sourceSnapshotId ?? [...sourceSnapshotIds][0] ?? null,
    sourceSnapshotIds: [...new Set([...sourceSnapshotIds, ...(options.sourceSnapshotId ? [options.sourceSnapshotId] : [])])].sort(),
    provenanceStatus: sourceType === 'synthetic' ? 'synthetic' as const : sourceType === 'none' ? 'none' as const : hasCompletePublicProvenance ? 'complete' as const : 'provisional' as const,
    minimumResolvedWidthKm: minResolution,
    sourceType,
    projection: options.detail ? 'local-azimuthal-equidistant' as const : 'equirectangular' as const,
    detailCenter: options.detail?.center ?? null,
    detailHalfExtentKm: halfExtent,
    pixelWidthKm: halfExtent === null ? null : minResolution,
    snapshotTransition: null,
  }
  return {
    width,
    height,
    field,
    wave,
    manifest: { ...manifestCore, dataVersion: fnv1a(JSON.stringify({ manifest: manifestCore, bands: canonical })) },
  }
}

/** Builds every declared LOD from the same qualified bands and normalization contract. */
export function buildFieldTextureLods(inputBands: FrequencyBand[], options: Omit<FieldTextureOptions, 'detail'> = {}): FieldTextureLods {
  return {
    earth: buildFieldTexture(inputBands, 'earth', options),
    region: buildFieldTexture(inputBands, 'region', options),
    city: buildFieldTexture(inputBands, 'city', options),
    topic: buildFieldTexture(inputBands, 'topic', options),
  }
}

/** Bounded high-resolution tile around a selected map anchor; no off-tile feature is invented. */
export function buildFieldDetailTile(bands: FrequencyBand[], center: GeoPoint, scale: FrequencyScale, options: Omit<FieldTextureOptions, 'detail'> & { halfExtentKm?: number } = {}): FieldTextureBundle {
  const halfExtentKm = options.halfExtentKm ?? DETAIL_HALF_EXTENT_KM[scale]
  if (!Number.isFinite(center.lat) || center.lat < -90 || center.lat > 90 || !Number.isFinite(center.lon) || center.lon < -180 || center.lon > 180 || !Number.isFinite(halfExtentKm) || halfExtentKm <= 0 || halfExtentKm > 10_000) throw new Error('Invalid local detail bounds.')
  if (bands.length > MAX_FIELD_TEXTURE_BANDS || bands.some((band) => !validBand(band))) throw new Error('Field texture contains a malformed or over-budget band.')
  const centerUnit = latLonToUnit(center.lat, center.lon)
  const radius = Math.SQRT2 * halfExtentKm + 3 * Math.max(0, ...bands.map((band) => band.widthKm))
  const nearby = bands.filter((band) => band.centerline.slice(1).some((point, index) =>
    distToArc(centerUnit, latLonToUnit(band.centerline[index]!.lat, band.centerline[index]!.lon), latLonToUnit(point.lat, point.lon)).distance * EARTH_RADIUS_KM <= radius))
  return buildFieldTexture(nearby, scale, { ...options, detail: { center, halfExtentKm } })
}

export function emptyFieldTexture(scale: FrequencyScale = 'earth'): FieldTextureBundle {
  return buildFieldTexture([], scale)
}

