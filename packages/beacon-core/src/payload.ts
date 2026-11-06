/** The only fields a beacon carries. Nothing about the person, their history, their knowledge or Laya. */
export type BeaconPayload = {
  /** Canonical http(s) address: no tracking parameters, no fragment, no credentials. */
  url: string
  title: string
  topic: string
  /** Optional public note, written by the publisher for others. */
  note?: string
  /** Optional place the resource is about (not where you are), rounded to 0.1° (about 11 km). */
  place?: { label: string; lat: number; lon: number }
}

export const BEACON_LIMITS = { title: 180, topic: 80, note: 280, placeLabel: 160, url: 2_048 } as const

/** Query parameters that only track people; they are removed before anything is published. */
export const TRACKING_PARAMETER = /^(utm_\w+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|ref_src|ref_url|s_cid|cmpid|ocid|smid|sr_share|share|at_medium|at_campaign|ncid|ito|spm)$/i

/** Hosts that should never be pointed at publicly (personal accounts, banking, health, local network). */
const PRIVATE_HOST = /(^|\.)(localhost|local|internal|lan|home\.arpa)$|^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i
const SENSITIVE_PATH = /(^|\/)(log-?in|sign-?in|account|accounts|checkout|cart|payment|billing|banking|inbox|messages|mail|patient)(\/|$)/i

export function canonicalBeaconUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (PRIVATE_HOST.test(url.hostname)) return null
  if (SENSITIVE_PATH.test(url.pathname)) return null
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key)
  url.hostname = url.hostname.toLowerCase()
  const text = url.toString()
  return text.length <= BEACON_LIMITS.url ? text : null
}

const round1 = (value: number): number => Math.round(value * 10) / 10
const clean = (value: string, max: number): string => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export type BeaconValidation = { ok: true; payload: BeaconPayload } | { ok: false; reason: string }

/** Validate and normalise a beacon. The result is exactly what may leave the device. */
export function validateBeacon(input: unknown): BeaconValidation {
  if (typeof input !== 'object' || input === null) return { ok: false, reason: 'Not a beacon.' }
  const raw = input as Record<string, unknown>
  const allowed = new Set(['url', 'title', 'topic', 'note', 'place'])
  const extra = Object.keys(raw).filter((key) => !allowed.has(key))
  if (extra.length) return { ok: false, reason: `Unexpected fields: ${extra.join(', ')}.` }
  const url = typeof raw['url'] === 'string' ? canonicalBeaconUrl(raw['url']) : null
  if (!url) return { ok: false, reason: 'The address must be a public http(s) page (not a sign-in, account, payment or local address).' }
  const title = typeof raw['title'] === 'string' ? clean(raw['title'], BEACON_LIMITS.title) : ''
  if (!title) return { ok: false, reason: 'A beacon needs a title.' }
  const topic = typeof raw['topic'] === 'string' ? clean(raw['topic'], BEACON_LIMITS.topic) : ''
  if (!topic) return { ok: false, reason: 'A beacon needs a topic.' }
  const payload: BeaconPayload = { url, title, topic }
  if (raw['note'] !== undefined) {
    if (typeof raw['note'] !== 'string') return { ok: false, reason: 'The note must be text.' }
    const note = clean(raw['note'], BEACON_LIMITS.note)
    if (note) payload.note = note
  }
  if (raw['place'] !== undefined) {
    const place = raw['place'] as Record<string, unknown> | null
    const lat = place?.['lat']
    const lon = place?.['lon']
    const label = typeof place?.['label'] === 'string' ? clean(place['label'], BEACON_LIMITS.placeLabel) : ''
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !label) {
      return { ok: false, reason: 'The place needs a name and valid coordinates.' }
    }
    payload.place = { label, lat: round1(lat), lon: round1(lon) }
  }
  return { ok: true, payload }
}

/**
 * Geographic context for prominence: a 2° × 2° cell (about 220 km). Beacons
 * without a place fall in the "global" cell.
 */
export function beaconCell(place: BeaconPayload['place']): string {
  if (!place) return 'global'
  const row = Math.floor((place.lat + 90) / 2)
  const col = Math.floor((((place.lon + 180) % 360) + 360) % 360 / 2)
  return `c${row}-${col}`
}
