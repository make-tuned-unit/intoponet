import { distToArc, latLonToUnit } from './geo'
import {
  DISPLACEMENT_GAIN,
  DEFAULT_PHASE_MODULATION,
  EARTH_RADIUS_KM,
  MAX_PHASE_MODULATION,
  MAX_BAND_SEGMENTS,
  MEMBRANE_HEIGHT,
  MIN_PHASE_MODULATION,
  type FrequencyBand,
  type GpuBandSegment,
  type Vec3,
} from './types'

type ProjectFn = (lat: number, lon: number) => Vec3

export function bandSigma(widthKm: number): number {
  return Math.max(0.01, widthKm / EARTH_RADIUS_KM / 2)
}

export function bandLambda(wavelengthKm: number): number {
  return Math.max(0.02, wavelengthKm / EARTH_RADIUS_KM)
}

export function phaseModulationDepth(depth = DEFAULT_PHASE_MODULATION): number {
  return Math.min(MAX_PHASE_MODULATION, Math.max(MIN_PHASE_MODULATION, depth))
}

export function segmentsFromBands(
  bands: FrequencyBand[],
  project: ProjectFn = latLonToUnit,
): GpuBandSegment[] {
  const segments: GpuBandSegment[] = []
  for (const band of bands) {
    if (segments.length >= MAX_BAND_SEGMENTS) break
    const points = band.centerline
    for (let index = 1; index < points.length; index += 1) {
      if (segments.length >= MAX_BAND_SEGMENTS) break
      const start = points[index - 1]
      const end = points[index]
      if (!start || !end) continue
      const a = project(start.lat, start.lon)
      const b = project(end.lat, end.lon)
      segments.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        sigma: bandSigma(band.widthKm),
        lambda: bandLambda(band.wavelengthKm),
        amplitude: Math.min(1, Math.max(0, band.amplitude)),
        phase: band.phase,
        omega: band.phaseVelocity,
        beta: phaseModulationDepth(band.phaseModulation),
        colorMix: band.category === 'overlap' ? 1 : 0.15,
      })
    }
  }
  return segments
}

export function fieldAt(point: Vec3, segments: GpuBandSegment[], time: number): number {
  let sum = 0
  for (const segment of segments) {
    const nearest = distToArc(
      point,
      { x: segment.ax, y: segment.ay, z: segment.az },
      { x: segment.bx, y: segment.by, z: segment.bz },
    )
    const envelope = Math.exp(-0.5 * (nearest.distance / segment.sigma) ** 2)
    const angle = (2 * Math.PI * nearest.along) / segment.lambda + segment.phase + segment.omega * time
    const modulation = 1 + segment.beta * Math.cos(angle)
    const contribution = segment.amplitude * envelope * modulation
    sum += contribution
  }
  return sum
}

export function displacementAt(
  point: Vec3,
  segments: GpuBandSegment[],
  time: number,
  dMax = 0.045,
): number {
  const field = fieldAt(point, segments, time)
  return dMax * (1 - Math.exp(-DISPLACEMENT_GAIN * field))
}

export function membraneRadius(displacement: number, radius = 1, height = MEMBRANE_HEIGHT): number {
  return radius + height + Math.max(0, displacement)
}
