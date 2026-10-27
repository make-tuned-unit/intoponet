/**
 * Where the sun is overhead right now (the subsolar point), from the standard
 * low-precision solar ephemeris (about 0.01° in declination, well under a
 * minute in time for this century). Used to light the globe's day side and
 * show night where it really is.
 */
export type SubsolarPoint = { lat: number; lon: number }

const RAD = Math.PI / 180

export function subsolarPoint(date: Date): SubsolarPoint {
  const d = date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0 // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD // mean anomaly
  const q = 280.459 + 0.98564736 * d // mean longitude, degrees
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD // right ascension, degrees
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15 // Greenwich sidereal time, degrees
  return { lat: dec, lon: wrap(ra - gmst) }
}

function wrap(lon: number): number {
  const x = ((lon + 180) % 360 + 360) % 360 - 180
  return x === -180 ? 180 : x
}

/** Unit vector toward the sun in globe coordinates (same convention as markers). */
export function sunDirection(date: Date): [number, number, number] {
  const { lat, lon } = subsolarPoint(date)
  const la = lat * RAD
  const lo = lon * RAD
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)]
}

/** True when the sun is above the horizon at a place (ignoring refraction). */
export function isDaylight(lat: number, lon: number, date: Date): boolean {
  const [sx, sy, sz] = sunDirection(date)
  const la = lat * RAD
  const lo = lon * RAD
  return Math.cos(la) * Math.cos(lo) * sx + Math.sin(la) * sy + -Math.cos(la) * Math.sin(lo) * sz > 0
}

/** The sun's height above the horizon at a place, in degrees (ignores refraction). */
export function sunElevation(lat: number, lon: number, date: Date): number {
  const [sx, sy, sz] = sunDirection(date)
  const la = lat * RAD
  const lo = lon * RAD
  const dot = Math.cos(la) * Math.cos(lo) * sx + Math.sin(la) * sy - Math.cos(la) * Math.sin(lo) * sz
  return Math.asin(Math.max(-1, Math.min(1, dot))) / RAD
}

export type DayPhase = 'day' | 'dawn' | 'dusk' | 'night'

/** Day, night, or civil twilight (sun up to 6° below the horizon), and whether it is rising. */
export function dayPhase(lat: number, lon: number, date: Date): { phase: DayPhase; elevation: number } {
  const elevation = sunElevation(lat, lon, date)
  if (elevation > 0) return { phase: 'day', elevation }
  if (elevation < -6) return { phase: 'night', elevation }
  const rising = sunElevation(lat, lon, new Date(date.getTime() + 10 * 60_000)) > elevation
  return { phase: rising ? 'dawn' : 'dusk', elevation }
}

/** Short words for a place's sun, e.g. 'Daytime · sun 34° up'. */
export function dayPhaseText(lat: number, lon: number, date: Date): string {
  const { phase, elevation } = dayPhase(lat, lon, date)
  if (phase === 'day') return elevation < 8 ? `Daytime · sun low (${Math.round(elevation)}°)` : `Daytime · sun ${Math.round(elevation)}° up`
  if (phase === 'dawn') return 'Dawn · sun rising'
  if (phase === 'dusk') return 'Dusk · sun just set'
  return 'Night'
}
