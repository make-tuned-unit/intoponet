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
  colorMix: number
}

export const EARTH_RADIUS_KM = 6371
export const MAX_BAND_SEGMENTS = 20
export const MEMBRANE_HEIGHT = 0.018
export const DISPLACEMENT_GAIN = 1.35
