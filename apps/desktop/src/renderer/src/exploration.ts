export type ExplorationScale = 'earth' | 'region' | 'city' | 'topic'

export type GeoAnchor = {
  lat: number
  lon: number
}

export type OrbitPose = {
  theta: number
  phi: number
  radius: number
}

export type ExplorationState = {
  scale: ExplorationScale
  geographicAnchor: GeoAnchor | null
  selectedTopicId: string | null
  pose: OrbitPose
}

export const scaleKey = 'intoponet.exploration-scale.v1'
export const explorationStateKey = 'intoponet.exploration-state.v1'

const scales: ExplorationScale[] = ['earth', 'region', 'city', 'topic']

export const scaleDistance: Record<ExplorationScale, number> = {
  earth: 3.52,
  region: 2.48,
  city: 1.96,
  topic: 1.62,
}

export const scaleDisplacement: Record<ExplorationScale, number> = {
  earth: 0.042,
  region: 0.032,
  city: 0.018,
  topic: 0.012,
}

export const topicAnchors: Record<string, GeoAnchor> = {
  'Open knowledge': { lat: 40.7, lon: -74 },
  'Civic memory': { lat: 35.7, lon: 139.8 },
  'Local archives': { lat: 4.7, lon: -74.1 },
  'Open research': { lat: -33.9, lon: 18.4 },
}

export function defaultAnchor(topic: string): GeoAnchor {
  return topicAnchors[topic] ?? { lat: 20, lon: -20 }
}

export function scaleFromDistance(radius: number): ExplorationScale {
  if (radius > 3.05) return 'earth'
  if (radius > 2.2) return 'region'
  if (radius > 1.78) return 'city'
  return 'topic'
}

export function isExplorationScale(value: unknown): value is ExplorationScale {
  return value === 'earth' || value === 'region' || value === 'city' || value === 'topic'
}

export function readScale(): ExplorationScale {
  const stored = readExplorationState()
  if (stored) return stored.scale
  const value = localStorage.getItem(scaleKey)
  return isExplorationScale(value) ? value : 'earth'
}

export function writeScale(scale: ExplorationScale): void {
  localStorage.setItem(scaleKey, scale)
  const current = readExplorationState()
  writeExplorationState({
    scale,
    geographicAnchor: current?.geographicAnchor ?? null,
    selectedTopicId: current?.selectedTopicId ?? null,
    pose: current?.pose ?? {
      theta: 0.35,
      phi: 1.28,
      radius: scaleDistance[scale],
    },
  })
}

export function readExplorationState(): ExplorationState | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(explorationStateKey) ?? '') as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const candidate = parsed as Record<string, unknown>
    if (!isExplorationScale(candidate['scale'])) return null
    const pose = candidate['pose']
    if (typeof pose !== 'object' || pose === null || Array.isArray(pose)) return null
    const numbers = pose as Record<string, unknown>
    if (
      typeof numbers['theta'] !== 'number' ||
      typeof numbers['phi'] !== 'number' ||
      typeof numbers['radius'] !== 'number'
    ) {
      return null
    }
    const anchor = candidate['geographicAnchor']
    let geographicAnchor: GeoAnchor | null = null
    if (anchor && typeof anchor === 'object' && !Array.isArray(anchor)) {
      const point = anchor as Record<string, unknown>
      if (typeof point['lat'] === 'number' && typeof point['lon'] === 'number') {
        geographicAnchor = { lat: point['lat'], lon: point['lon'] }
      }
    }
    return {
      scale: candidate['scale'],
      geographicAnchor,
      selectedTopicId:
        typeof candidate['selectedTopicId'] === 'string' ? candidate['selectedTopicId'] : null,
      pose: {
        theta: numbers['theta'],
        phi: numbers['phi'],
        radius: numbers['radius'],
      },
    }
  } catch {
    return null
  }
}

export function writeExplorationState(state: ExplorationState): void {
  localStorage.setItem(explorationStateKey, JSON.stringify(state))
  localStorage.setItem(scaleKey, state.scale)
}

export function zoomTowardTopic(scale: ExplorationScale): ExplorationScale {
  return scales[Math.min(scales.length - 1, scales.indexOf(scale) + 1)] ?? 'topic'
}

export function zoomTowardEarth(scale: ExplorationScale): ExplorationScale {
  return scales[Math.max(0, scales.indexOf(scale) - 1)] ?? 'earth'
}

export function shouldSnapshotBeforeTopic(
  from: ExplorationScale,
  to: ExplorationScale,
): boolean {
  return from !== 'topic' && to === 'topic'
}

export function restoreAfterTopic(
  from: ExplorationScale,
  to: ExplorationScale,
  saved: OrbitPose | null,
): OrbitPose | null {
  if (from === 'topic' && to !== 'topic') return saved
  return null
}

const orbitPhiMin = 0.18
const orbitPhiMax = Math.PI - 0.18

export function nudgeOrbit(
  pose: OrbitPose,
  direction: 'left' | 'right' | 'up' | 'down',
  step = 0.08,
): OrbitPose {
  if (direction === 'left') return { ...pose, theta: pose.theta + step }
  if (direction === 'right') return { ...pose, theta: pose.theta - step }
  if (direction === 'up') {
    return { ...pose, phi: Math.min(orbitPhiMax, pose.phi + step) }
  }
  return { ...pose, phi: Math.max(orbitPhiMin, pose.phi - step) }
}

export function scaleLabel(scale: ExplorationScale): string {
  if (scale === 'earth') return 'planet scale'
  if (scale === 'region') return 'region scale'
  if (scale === 'city') return 'city scale'
  return 'topic scale'
}
