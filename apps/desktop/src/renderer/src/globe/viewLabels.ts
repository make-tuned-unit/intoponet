import type { GlobeSignal } from './globeSignals'

export type LabelView = {
  centerLat: number
  centerLon: number
  /** Camera distance from Earth's centre (Earth radius 1). */
  distance: number
  /** Degrees of Earth's surface per screen pixel near the centre of the view. */
  degPerPx: number
  width: number
  height: number
}

/** Beyond this the whole planet is in view, and the world's biggest stories get the labels. */
export const WHOLE_EARTH_DISTANCE = 3.05
const EARTH_KM = 6371

const isPlace = (signal: GlobeSignal): boolean => /^news:(city|region):/.test(signal.id)

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** How far from the centre of the view the visible ground reaches, in km. */
export function visibleRadiusKm(view: LabelView): number {
  const horizon = Math.acos(Math.min(1, 1 / Math.max(1.0001, view.distance))) * EARTH_KM
  const screen = (Math.hypot(view.width, view.height) / 2) * view.degPerPx * (Math.PI / 180) * EARTH_KM
  return Math.min(horizon, screen > 0 ? screen : horizon)
}

/**
 * Which signals get a name on the globe, in priority order. From far away, the world's top
 * stories. Zoomed in, the places in view: cities with local news come first, so zooming in on
 * a region shows its towns by name instead of labels for stories on the other side of the planet.
 */
export function viewLabelSignals(signals: GlobeSignal[], view: LabelView | null, selectedId: string | null): GlobeSignal[] {
  const selected = selectedId ? signals.find((signal) => signal.id === selectedId) ?? null : null
  const rest = selected ? signals.filter((signal) => signal !== selected) : signals
  if (!view || view.distance >= WHOLE_EARTH_DISTANCE) return [...(selected ? [selected] : []), ...rest.slice(0, selected ? 15 : 16)]
  const reach = visibleRadiusKm(view)
  // 0 at the whole-earth distance, 1 at the closest zoom: how strongly to favour named places.
  const closeness = Math.min(1, Math.max(0, (WHOLE_EARTH_DISTANCE - view.distance) / (WHOLE_EARTH_DISTANCE - 1.3)))
  const limit = Math.round(24 + closeness * 36)
  const inView = rest
    .map((signal) => ({ signal, km: distanceKm(view.centerLat, view.centerLon, signal.lat, signal.lon) }))
    .filter((item) => item.km <= reach)
    // Places outrank stories as you zoom in; nearer the middle of the view breaks ties.
    .map((item) => ({ ...item, score: item.signal.intensity + (isPlace(item.signal) ? closeness * 0.6 : 0) - (item.km / Math.max(1, reach)) * 0.15 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.signal)
  return [...(selected ? [selected] : []), ...inView]
}

/** True when the view has moved enough that the labels should be chosen again. */
export function labelViewChanged(previous: LabelView | null, next: LabelView): boolean {
  if (!previous) return true
  if ((previous.distance >= WHOLE_EARTH_DISTANCE) !== (next.distance >= WHOLE_EARTH_DISTANCE)) return true
  if (next.distance >= WHOLE_EARTH_DISTANCE) return false
  if (Math.abs(previous.distance - next.distance) / previous.distance > 0.03) return true
  if (previous.width !== next.width || previous.height !== next.height) return true
  return distanceKm(previous.centerLat, previous.centerLon, next.centerLat, next.centerLon) > visibleRadiusKm(next) * 0.08
}
