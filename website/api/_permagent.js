// First-party analytics for intoponet.com (Permagent). The collector cleans each
// beacon here, at the edge, and forwards only the cleaned event to the registry's
// Postgres (Neon) through the shared edge secret. No IP address or user agent is
// ever stored: the visitor hash is salted and rotates daily. The Permagent daemon
// drains events by id through the authenticated drain route.
import { createHash, timingSafeEqual } from 'node:crypto'

const LIMITS = { path: 512, referrer: 512, name: 128, session: 64, propertyKeys: 32, propertyValue: 256, propertiesBytes: 4096 }
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|curl|wget|python-requests|python-urllib|httpx|aiohttp|go-http-client|okhttp|java\/|libwww|axios|node-fetch|undici|facebookexternalhit|embedly|preview|phantomjs|puppeteer|playwright|selenium|scrapy|monitor|uptime|pingdom/i
const ATTRIBUTION = /^(utm_[a-z0-9_]*|ref|gclid|fbclid)$/i

const text = (value, max) => (typeof value === 'string' && value.length ? value.slice(0, max) : null)

/** A missing user agent counts as a bot; the agent string itself is never stored. */
export function isBotAgent(userAgent) {
  return !userAgent || BOT.test(userAgent)
}

/** Flat string/number/boolean properties only, truncated (never rejected) to 32 keys, 256 chars each, 4 KB total. */
export function cleanProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const kept = {}
  let bytes = 2
  for (const [rawKey, item] of Object.entries(value)) {
    if (Object.keys(kept).length >= LIMITS.propertyKeys) break
    const key = rawKey.slice(0, 64)
    let stored
    if (typeof item === 'string') stored = item.slice(0, LIMITS.propertyValue)
    else if ((typeof item === 'number' && Number.isFinite(item)) || typeof item === 'boolean') stored = item
    else continue
    const size = JSON.stringify(key).length + JSON.stringify(stored).length + 2
    if (bytes + size > LIMITS.propertiesBytes) {
      // Truncate the last string to fit rather than dropping the whole event.
      if (typeof stored !== 'string') break
      const room = LIMITS.propertiesBytes - bytes - JSON.stringify(key).length - 4
      if (room <= 0) break
      stored = stored.slice(0, room)
    }
    kept[key] = stored
    bytes += JSON.stringify(key).length + JSON.stringify(stored).length + 2
  }
  return Object.keys(kept).length ? kept : null
}

/** The path without its query, and the allowlisted UTM fields from it (never the whole query string). */
export function splitPath(raw) {
  const value = typeof raw === 'string' && raw.startsWith('/') ? raw : '/'
  const [pathPart, query = ''] = value.split('?', 2)
  const utm = { utmSource: null, utmMedium: null, utmCampaign: null }
  for (const pair of query.split('&')) {
    if (!pair) continue
    const [rawKey, rawValue = ''] = pair.split('=', 2)
    let key = rawKey
    let item = rawValue
    try { key = decodeURIComponent(rawKey.replace(/\+/g, ' ')) } catch { /* keep raw */ }
    try { item = decodeURIComponent(rawValue.replace(/\+/g, ' ')) } catch { /* keep raw */ }
    if (!ATTRIBUTION.test(key)) continue
    const lower = key.toLowerCase()
    if (lower === 'utm_source') utm.utmSource = item.slice(0, 256) || null
    else if (lower === 'utm_medium') utm.utmMedium = item.slice(0, 256) || null
    else if (lower === 'utm_campaign') utm.utmCampaign = item.slice(0, 256) || null
  }
  return { path: (pathPart || '/').slice(0, LIMITS.path), ...utm }
}

/** sha256(salt + user agent + accept-language + UTC date), first 32 hex: rotates daily, irreversible without the salt. */
export function visitorHash(salt, userAgent, acceptLanguage, now = new Date()) {
  if (!salt) return null
  const day = now.toISOString().slice(0, 10)
  return createHash('sha256').update(`${salt}${userAgent ?? ''}${acceptLanguage ?? ''}${day}`).digest('hex').slice(0, 32)
}

/** A beacon body (text/plain from sendBeacon, or anything else) into a clean event, or null if it is not one. */
export function eventFromBeacon(bodyText, headers, env = process.env, now = new Date()) {
  let body
  try { body = JSON.parse(bodyText) } catch { return null }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const kind = body.k === 'pv' ? 'pageview' : body.k === 'ev' ? 'event' : null
  if (!kind) return null
  const userAgent = headers.get('user-agent')
  const country = headers.get('x-vercel-ip-country')?.trim().toUpperCase() ?? ''
  return {
    kind,
    ...splitPath(text(body.p, 2048) ?? '/'),
    referrer: text(body.r, LIMITS.referrer),
    name: text(body.n, LIMITS.name),
    properties: cleanProperties(body.d),
    sessionId: text(body.s, LIMITS.session),
    visitorHash: visitorHash(env.PERMAGENT_ANALYTICS_SALT, userAgent, headers.get('accept-language'), now),
    // b: 1 comes from navigator.webdriver: automation reports it even with a normal user agent.
    isBot: body.b === 1 || isBotAgent(userAgent),
    country: /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null,
  }
}

const upstreamConfig = (env) => {
  const origin = env.BEACON_REGISTRY_ORIGIN ?? ''
  const secret = env.BEACON_EDGE_SECRET ?? ''
  return /^https:\/\/[^/?#]+$/.test(origin) && secret.length >= 32 ? { origin, secret } : null
}

/** POST /api/permagent-analytics/collect: always 202 with an empty body; a pageview never errors for a visitor. */
export async function collect(request, env = process.env, fetchImpl = fetch) {
  const accepted = () => new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } })
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  try {
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > 16_384) return accepted()
    const bodyText = (await request.text()).slice(0, 16_384)
    const event = eventFromBeacon(bodyText, request.headers, env)
    const upstream = upstreamConfig(env)
    if (!event || !upstream) return accepted()
    await fetchImpl(`${upstream.origin}/v1/analytics/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intoponet-edge': upstream.secret },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(4_000),
    }).then((response) => response.body?.cancel(), () => undefined)
  } catch {
    // Malformed or unreachable: the visitor still gets a quiet 202.
  }
  return accepted()
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

function keyMatches(provided, expected) {
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

/** GET /api/permagent-analytics/drain?since=<id>&limit=<n>: x-permagent-key only, fails closed. */
export async function drain(request, env = process.env, fetchImpl = fetch) {
  if (!keyMatches(request.headers.get('x-permagent-key'), env.PERMAGENT_ANALYTICS_KEY)) return json(401, { error: 'Unauthorized.' })
  const url = new URL(request.url)
  const since = url.searchParams.get('since') ?? '0'
  const limit = url.searchParams.get('limit') ?? '500'
  if (!/^\d{1,15}$/.test(since) || !/^\d{1,6}$/.test(limit)) return json(400, { error: 'since and limit must be non-negative integers.' })
  const upstream = upstreamConfig(env)
  if (!upstream) return json(503, { error: 'Analytics storage is not configured.' })
  try {
    const response = await fetchImpl(`${upstream.origin}/v1/analytics/events?since=${since}&limit=${Math.min(1000, Math.max(1, Number(limit)))}`, {
      headers: { 'x-intoponet-edge': upstream.secret },
      signal: AbortSignal.timeout(20_000),
    })
    return new Response(await response.arrayBuffer(), { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  } catch {
    return json(502, { error: 'Analytics storage could not be reached.' })
  }
}
