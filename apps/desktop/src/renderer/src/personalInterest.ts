import type { InterestSignal } from './interestField'
import type { TopicVisit } from './topicTraffic'

export type PersonalTopicLocation = {
  id: string
  label: string
  lat: number
  lon: number
  /** Visual footprint only; it is not the source record's geographic uncertainty. */
  radiusKm: number
}

export type PersonalVisit = {
  topicId: string
  timestamp: string
  topicLocation: PersonalTopicLocation | null
}

export type PersonalActivityState = {
  visits: PersonalVisit[]
  /** URL fingerprints exist in memory only and are never stored with activity. */
  recentPageFingerprints: Record<string, number>
}

export type RecordVisitInput = {
  url: string
  title: string
  topicId: string
  timestamp: string
  eligible: boolean
  topicLocation: PersonalTopicLocation | null
}

export const PERSONAL_ACTIVITY_LIMITS = {
  visits: 2_048,
  fingerprintLength: 128,
  dedupeWindowMs: 30 * 60 * 1_000,
  halfLifeMs: 7 * 24 * 60 * 60 * 1_000,
  retentionMs: 30 * 24 * 60 * 60 * 1_000,
} as const

export const PERSONAL_DISPLAY_RADIUS_KM = 1_200

export const emptyPersonalActivity: PersonalActivityState = {
  visits: [],
  recentPageFingerprints: {},
}

function canonicalPageKey(rawUrl: string): string | null {
  if (rawUrl.length > 8_192) return null
  try {
    const url = new URL(rawUrl)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_[a-z0-9_]+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i.test(key)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase()
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = ''
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    url.searchParams.sort()
    return url.toString()
  } catch {
    return null
  }
}

/** Fingerprint a canonical URL without retaining the URL or page title in activity records. */
function fingerprint(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function validTopicLocation(topicLocation: PersonalTopicLocation | null): boolean {
  return topicLocation === null || (
    typeof topicLocation.id === 'string' && topicLocation.id.length > 0 && topicLocation.id.length <= 160 &&
    typeof topicLocation.label === 'string' && topicLocation.label.trim().length > 0 && topicLocation.label.length <= 160 &&
    Number.isFinite(topicLocation.lat) && topicLocation.lat >= -90 && topicLocation.lat <= 90 &&
    Number.isFinite(topicLocation.lon) && topicLocation.lon >= -180 && topicLocation.lon <= 180 &&
    Number.isFinite(topicLocation.radiusKm) && topicLocation.radiusKm > 0 && topicLocation.radiusKm <= 20_100
  )
}

/** Record only a completed, eligible visit. URL/title are used for checks and dedupe but not retained. */
export function recordPersonalVisit(
  state: PersonalActivityState,
  input: RecordVisitInput,
): { state: PersonalActivityState; result: 'recorded' | 'duplicate' | 'ineligible' | 'invalid' } {
  if (!input.eligible) return { state, result: 'ineligible' }
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 1_000 ||
      typeof input.topicId !== 'string' || !input.topicId.trim() || input.topicId.length > 160 ||
      !Number.isFinite(Date.parse(input.timestamp)) || !input.timestamp.endsWith('Z') || !validTopicLocation(input.topicLocation)) {
    return { state, result: 'invalid' }
  }
  const canonical = canonicalPageKey(input.url)
  if (!canonical) return { state, result: 'invalid' }
  const now = Date.parse(input.timestamp)
  const pageKey = fingerprint(`${canonical}\u0000${input.topicId.trim()}\u0000${input.topicLocation?.id ?? ''}`)
  const previous = state.recentPageFingerprints[pageKey]
  if (previous !== undefined && now >= previous && now - previous < PERSONAL_ACTIVITY_LIMITS.dedupeWindowMs) {
    return { state, result: 'duplicate' }
  }

  const recentPageFingerprints = Object.fromEntries(
    Object.entries(state.recentPageFingerprints)
      .filter(([, seenAt]) => now - seenAt < PERSONAL_ACTIVITY_LIMITS.dedupeWindowMs)
      .slice(-PERSONAL_ACTIVITY_LIMITS.fingerprintLength + 1),
  )
  recentPageFingerprints[pageKey] = now
  const oldestAllowed = now - PERSONAL_ACTIVITY_LIMITS.retentionMs
  const visits = [...state.visits.filter((visit) => Date.parse(visit.timestamp) >= oldestAllowed), {
    topicId: input.topicId.trim(),
    timestamp: new Date(now).toISOString(),
    topicLocation: input.topicLocation ? { ...input.topicLocation, label: input.topicLocation.label.trim() } : null,
  }].slice(-PERSONAL_ACTIVITY_LIMITS.visits)
  return { state: { visits, recentPageFingerprints }, result: 'recorded' }
}

/** Aggregate only visits carrying an explicitly selected topic destination. */
export function personalVisitSignals(state: PersonalActivityState, asOf: string): InterestSignal[] {
  const asOfMs = Date.parse(asOf)
  if (!Number.isFinite(asOfMs)) return []
  const groups = new Map<string, { topicLocation: PersonalTopicLocation; topicId: string; weightedCount: number; latest: number }>()
  for (const visit of state.visits) {
    if (!visit.topicLocation) continue
    const timestamp = Date.parse(visit.timestamp)
    const age = asOfMs - timestamp
    if (!Number.isFinite(timestamp) || age < 0 || age > PERSONAL_ACTIVITY_LIMITS.retentionMs) continue
    const key = `${visit.topicLocation.id}\u0000${visit.topicId}`
    const group = groups.get(key) ?? { topicLocation: visit.topicLocation, topicId: visit.topicId, weightedCount: 0, latest: timestamp }
    group.weightedCount += Math.pow(0.5, age / PERSONAL_ACTIVITY_LIMITS.halfLifeMs)
    group.latest = Math.max(group.latest, timestamp)
    groups.set(key, group)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => ({
    id: `private-local:${fingerprint(key)}`,
    lat: group.topicLocation.lat,
    lon: group.topicLocation.lon,
    intensity: Math.min(0.8, 1 - Math.exp(-group.weightedCount / 4)),
    radiusKm: group.topicLocation.radiusKm,
    momentum: null,
    confidence: 0.55,
    timestamp: new Date(group.latest).toISOString(),
    topicId: group.topicId,
    sourceType: 'private-local',
  }))
}

export function unplacedPersonalVisitCount(state: PersonalActivityState): number {
  return state.visits.reduce((count, visit) => count + (visit.topicLocation ? 0 : 1), 0)
}

/** Map locally recorded visits for one explicitly selected topic destination.
 * Origin is intentionally unknown: the app does not collect visitor-country data.
 */
export function personalTrafficVisits(
  state: PersonalActivityState,
  topicId: string,
  location: PersonalTopicLocation | null,
): TopicVisit[] {
  if (!topicId || !location) return []
  return state.visits.flatMap((visit) => {
    const destination = visit.topicLocation
    if (!destination || visit.topicId !== topicId || destination.id !== location.id) return []
    return [{
      destinationId: destination.id,
      topicId: visit.topicId,
      timestamp: visit.timestamp,
      originCountryCode: null,
    }]
  })
}
