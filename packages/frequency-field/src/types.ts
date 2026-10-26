export type GeoPoint = {
  lat: number
  lon: number
}

export type Vec3 = {
  x: number
  y: number
  z: number
}

export type FrequencyBand = {
  id: string
  centerline: GeoPoint[]
  widthKm: number
  wavelengthKm: number
  amplitude: number
  phase: number
  phaseVelocity: number
  /** Restrained phase-only modulation depth; clamped to the spec range [0.08, 0.20]. */
  phaseModulation?: number
  /** Optional observed temporal-change channel, kept independent from amplitude. */
  momentum?: number
  /** Evidence-quality channels are not folded into intensity. */
  geographicConfidence?: number
  coverageConfidence?: number
  observationStart?: string
  observationEnd?: string
  sourceIds?: string[]
  sourceSnapshotId?: string
  provenanceManifestId?: string
  provisional?: boolean
  confidence: number
  topicIds: string[]
  category?: string
  updatedAt: string
  sourceType: 'synthetic' | 'public-aggregate'
}

export type GpuBandSegment = {
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  sigma: number
  lambda: number
  amplitude: number
  phase: number
  omega: number
  beta: number
  colorMix: number
}

export const EARTH_RADIUS_KM = 6371
export const MAX_BAND_SEGMENTS = 20
export const MEMBRANE_HEIGHT = 0.018
export const DISPLACEMENT_GAIN = 1.35
export const MIN_PHASE_MODULATION = 0.08
export const MAX_PHASE_MODULATION = 0.2
export const DEFAULT_PHASE_MODULATION = 0.14
export const MAX_FIELD_TEXTURE_BANDS = 20
export const FIELD_TEXTURE_NORMALIZATION = 'saturating-envelope-v1'
