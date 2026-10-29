import { createHash, createHmac, createPublicKey, verify } from 'node:crypto'
import { beaconCell, canonicalBeaconUrl, CLOCK_SKEW_MS, prominence, publicCount, signingText, validateBeacon, type SignedRequest } from '@intoponet/beacon-core'

/**
 * The beacon registry (PRD §4.6, BCN-001…006): publish, withdraw, report and
 * contest beacons, and read them back as aggregates. It never returns
 * publisher keys or individual beacons; reads are per resource, with bucketed
 * counts and prominence that has diminishing returns per region.
 *
 * Abuse controls (BCN-006) are interim: signed requests from anonymous device
 * keys, replay protection, per-key and per-network daily limits, one live
 * beacon per key per resource, and automatic hiding for review after three
 * independent reports. Anonymous uniqueness (Sybil resistance) is still open:
 * see docs/architecture/ADR-006-beacon-anti-sybil.md.
 */

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>
/** `ip` only when the host provides a trustworthy client address; without it the per-network limit is off (enforce it at the edge instead). */
export type RegistryRequest = { method: string; path: string; query: URLSearchParams; body: unknown; ip?: string; authorization?: string }
export type RegistryResponse = { status: number; body: unknown; headers?: Record<string, string> }

export const LIMITS = { publishPerKeyPerDay: 10, publishPerNetworkPerDay: 30, reportsPerKeyPerDay: 20, hideAfterReports: 3, readLimit: 100, reportText: 500 } as const
const REPORT_KINDS = new Set(['spam', 'harmful', 'misleading', 'broken', 'contest'])

export function createRegistry(options: { query: Query; secret: string; adminToken?: string; now?: () => number }) {
  const { query } = options
  const now = options.now ?? Date.now
  const day = (): string => new Date(now()).toISOString().slice(0, 10)
  /** A network address becomes a hash with a salt that changes daily; the address itself is never stored. */
  const networkId = (ip: string): string => createHash('sha256').update(createHmac('sha256', options.secret).update(day()).digest()).update(ip).digest('base64url')

  const bump = async (subject: string, action: string, limit: number): Promise<boolean> => {
    const rows = await query<{ count: number }>(
      `insert into beacon_usage (subject, day, action, count) values ($1, $2, $3, 1)
       on conflict (subject, day, action) do update set count = beacon_usage.count + 1
       returning count`,
      [subject, day(), action],
    )
    return (rows[0]?.count ?? 0) <= limit
  }

  /** Verify a signed request: fresh, never seen before, signed by the key it names. */
  const verifySigned = async (value: unknown, kind: SignedRequest<unknown>['kind']): Promise<{ ok: true; request: SignedRequest<unknown> } | { ok: false; status: number; error: string }> => {
    const request = value as SignedRequest<unknown> | null
    if (!request || typeof request !== 'object' || request.kind !== kind) return { ok: false, status: 400, error: 'Not a signed request.' }
    const { publisherKey, at, nonce, signature } = request
    if (typeof publisherKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(publisherKey)) return { ok: false, status: 400, error: 'Bad publisher key.' }
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return { ok: false, status: 400, error: 'Bad nonce.' }
    if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || Math.abs(Date.parse(at) - now()) > CLOCK_SKEW_MS) return { ok: false, status: 400, error: 'Request time is too far from now. Check this computer’s clock.' }
    if (typeof signature !== 'string') return { ok: false, status: 400, error: 'Missing signature.' }
    let valid = false
    try {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publisherKey }, format: 'jwk' })
      valid = verify(null, Buffer.from(signingText(kind, request.body, publisherKey, at, nonce)), key, Buffer.from(signature, 'base64url'))
    } catch {
      valid = false
    }
    if (!valid) return { ok: false, status: 401, error: 'Signature does not match.' }
    await query(`delete from beacon_nonces where at < now() - interval '10 minutes'`)
    const fresh = await query(`insert into beacon_nonces (nonce) values ($1) on conflict do nothing returning nonce`, [nonce])
    if (!fresh.length) return { ok: false, status: 409, error: 'This request was already used.' }
    return { ok: true, request }
  }

  const publish = async (req: RegistryRequest): Promise<RegistryResponse> => {
    const signed = await verifySigned(req.body, 'publish')
    if (!signed.ok) return { status: signed.status, body: { error: signed.error } }
    const checked = validateBeacon(signed.request.body)
    if (!checked.ok) return { status: 422, body: { error: checked.reason } }
    const key = signed.request.publisherKey
    if (!(await bump(`key:${key}`, 'publish', LIMITS.publishPerKeyPerDay))) return { status: 429, body: { error: `You can publish up to ${LIMITS.publishPerKeyPerDay} beacons a day.` } }
    if (req.ip && !(await bump(`net:${networkId(req.ip)}`, 'publish', LIMITS.publishPerNetworkPerDay))) return { status: 429, body: { error: 'Too many beacons from this network today.' } }
    const beacon = checked.payload
    const rows = await query<{ id: string }>(
      `insert into beacons (url, title, topic, note, place_label, lat, lon, cell, publisher_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (publisher_key, url) where withdrawn_at is null do nothing
       returning id`,
      [beacon.url, beacon.title, beacon.topic, beacon.note ?? null, beacon.place?.label ?? null, beacon.place?.lat ?? null, beacon.place?.lon ?? null, beaconCell(beacon.place), key],
    )
    if (!rows[0]) return { status: 409, body: { error: 'You already have a beacon for this page.' } }
    return { status: 201, body: { id: rows[0].id, beacon } }
  }

  const withdraw = async (req: RegistryRequest, id: string): Promise<RegistryResponse> => {
    const signed = await verifySigned(req.body, 'withdraw')
    if (!signed.ok) return { status: signed.status, body: { error: signed.error } }
    if ((signed.request.body as { id?: unknown } | null)?.id !== id) return { status: 400, body: { error: 'The signed beacon id does not match.' } }
    const rows = await query(`update beacons set withdrawn_at = now() where id = $1 and publisher_key = $2 and withdrawn_at is null returning id`, [id, signed.request.publisherKey])
    return rows.length ? { status: 200, body: { withdrawn: id } } : { status: 404, body: { error: 'No live beacon of yours with that id.' } }
  }

  const report = async (req: RegistryRequest, url: string): Promise<RegistryResponse> => {
    const signed = await verifySigned(req.body, 'report')
    if (!signed.ok) return { status: signed.status, body: { error: signed.error } }
    const body = signed.request.body as { url?: unknown; kind?: unknown; text?: unknown } | null
    const canonical = typeof body?.url === 'string' ? canonicalBeaconUrl(body.url) : null
    if (!canonical || canonical !== url) return { status: 400, body: { error: 'The signed address does not match.' } }
    if (typeof body?.kind !== 'string' || !REPORT_KINDS.has(body.kind)) return { status: 422, body: { error: 'Unknown report kind.' } }
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, LIMITS.reportText) : ''
    if (body.kind === 'contest' && text.length < 10) return { status: 422, body: { error: 'Say briefly what you dispute and why (at least 10 characters).' } }
    const key = signed.request.publisherKey
    if (!(await bump(`key:${key}`, 'report', LIMITS.reportsPerKeyPerDay))) return { status: 429, body: { error: 'Too many reports today.' } }
    const targets = await query<{ id: string }>(`select id from beacons where url = $1 and withdrawn_at is null`, [url])
    if (!targets.length) return { status: 404, body: { error: 'No live beacons point at that address.' } }
    for (const target of targets) {
      await query(`insert into beacon_reports (beacon_id, reporter_key, kind, text) values ($1, $2, $3, $4) on conflict (beacon_id, reporter_key) do nothing`, [target.id, key, body.kind, text || null])
    }
    // Three independent reports (not counting contests) hide a resource until a moderator reviews it.
    if (body.kind !== 'contest') {
      await query(
        `update beacons b set hidden = true, review_state = 'pending'
         where b.url = $1 and b.withdrawn_at is null and b.review_state <> 'cleared'
           and (select count(distinct r.reporter_key) from beacon_reports r join beacons x on x.id = r.beacon_id where x.url = $1 and r.kind <> 'contest') >= $2`,
        [url, LIMITS.hideAfterReports],
      )
    }
    return { status: 202, body: { received: true } }
  }

  type Row = { url: string; title: string; topic: string; note: string | null; place_label: string | null; lat: number | null; lon: number | null; cell: string; publishers: string; first_at: Date; last_at: Date }
  /** Aggregates per resource: never individual beacons or keys. */
  const read = async (req: RegistryRequest): Promise<RegistryResponse> => {
    const limit = Math.min(LIMITS.readLimit, Math.max(1, Number(req.query.get('limit') ?? 50) || 50))
    const filters: string[] = ['withdrawn_at is null', 'not hidden']
    const params: unknown[] = []
    const cell = req.query.get('cell')
    if (cell) {
      if (!/^(global|c\d{1,2}-\d{1,3})$/.test(cell)) return { status: 400, body: { error: 'Bad cell.' } }
      params.push(cell)
      filters.push(`cell = $${params.length}`)
    }
    const bbox = req.query.get('bbox')?.split(',').map(Number)
    if (bbox) {
      if (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) return { status: 400, body: { error: 'bbox is minLat,minLon,maxLat,maxLon.' } }
      params.push(...bbox)
      filters.push(`lat between $${params.length - 3} and $${params.length - 1} and lon between $${params.length - 2} and $${params.length}`)
    }
    const topic = req.query.get('topic')
    if (topic) {
      params.push(topic.slice(0, 80).toLowerCase())
      filters.push(`lower(topic) = $${params.length}`)
    }
    const rows = await query<Row>(
      `select url, cell,
              (array_agg(title order by created_at desc))[1] as title,
              (array_agg(topic order by created_at desc))[1] as topic,
              (array_agg(note order by created_at desc) filter (where note is not null))[1] as note,
              (array_agg(place_label order by created_at desc))[1] as place_label,
              avg(lat) as lat, avg(lon) as lon,
              count(distinct publisher_key) as publishers,
              min(created_at) as first_at, max(created_at) as last_at
       from beacons where ${filters.join(' and ')}
       group by url, cell`,
      params,
    )
    const byUrl = new Map<string, Row[]>()
    for (const row of rows) byUrl.set(row.url, [...(byUrl.get(row.url) ?? []), row])
    const contests = byUrl.size
      ? await query<{ url: string; text: string; created_at: Date }>(
          `select b.url, r.text, r.created_at from beacon_reports r join beacons b on b.id = r.beacon_id
           where r.kind = 'contest' and b.url = any($1) order by r.created_at desc`,
          [[...byUrl.keys()]],
        )
      : []
    const resources = [...byUrl.entries()].map(([url, cells]) => {
      const latest = [...cells].sort((a, b) => +b.last_at - +a.last_at)[0]!
      const publishers = cells.reduce((sum, item) => sum + Number(item.publishers), 0)
      const disputes = [...new Set(contests.filter((item) => item.url === url).map((item) => item.text))]
      return {
        url,
        title: latest.title,
        topic: latest.topic,
        ...(latest.note ? { note: latest.note } : {}),
        places: cells.filter((item) => item.place_label).map((item) => ({ label: item.place_label!, lat: Math.round(Number(item.lat) * 10) / 10, lon: Math.round(Number(item.lon) * 10) / 10 })),
        publishers: publicCount(publishers),
        prominence: Math.round(prominence(Object.fromEntries(cells.map((item) => [item.cell, Number(item.publishers)]))) * 100) / 100,
        firstAt: new Date(cells.reduce((min, item) => Math.min(min, +item.first_at), Infinity)).toISOString(),
        lastAt: latest.last_at.toISOString(),
        contested: disputes.length > 0 ? { count: disputes.length, notes: disputes.slice(0, 3) } : null,
      }
    }).sort((a, b) => b.prominence - a.prominence || b.lastAt.localeCompare(a.lastAt)).slice(0, limit)
    return { status: 200, body: { resources, method: 'Prominence = sum over 2° regions of min(4, log2(1 + independent publishers)). Counts are bucketed; publisher keys are never published.' }, headers: { 'cache-control': 'public, max-age=60' } }
  }

  const admin = async (req: RegistryRequest, rest: string[]): Promise<RegistryResponse> => {
    if (!options.adminToken || req.authorization !== `Bearer ${options.adminToken}`) return { status: 401, body: { error: 'Moderator token required.' } }
    if (req.method === 'GET' && rest[0] === 'queue') {
      const rows = await query(
        `select b.url, max(b.title) as title, array_agg(distinct r.kind) as kinds, count(distinct r.reporter_key) as reporters,
                array_remove(array_agg(distinct r.text), null) as notes
         from beacons b join beacon_reports r on r.beacon_id = b.id
         where b.review_state = 'pending' and b.withdrawn_at is null group by b.url`,
      )
      return { status: 200, body: { queue: rows } }
    }
    if (req.method === 'POST' && rest[0] === 'review') {
      const body = req.body as { url?: unknown; action?: unknown } | null
      if (typeof body?.url !== 'string' || (body.action !== 'restore' && body.action !== 'remove')) return { status: 400, body: { error: 'Send { url, action: "restore" | "remove" }.' } }
      await query(
        body.action === 'restore'
          ? `update beacons set hidden = false, review_state = 'cleared' where url = $1 and withdrawn_at is null`
          : `update beacons set hidden = true, review_state = 'removed' where url = $1 and withdrawn_at is null`,
        [body.url],
      )
      return { status: 200, body: { reviewed: body.url, action: body.action } }
    }
    return { status: 404, body: { error: 'Not found.' } }
  }

  return {
    async handle(req: RegistryRequest): Promise<RegistryResponse> {
      const parts = req.path.replace(/^\/+|\/+$/g, '').split('/')
      if (parts[0] !== 'v1') return { status: 404, body: { error: 'Not found.' } }
      const [, resource, ...rest] = parts
      try {
        if (resource === 'health' && req.method === 'GET') {
          await query('select 1')
          return { status: 200, body: { ok: true } }
        }
        if (resource === 'beacons') {
          if (req.method === 'GET' && rest.length === 0) return await read(req)
          if (req.method === 'POST' && rest.length === 0) return await publish(req)
          if (req.method === 'POST' && rest.length === 2 && rest[1] === 'withdraw') return await withdraw(req, rest[0]!)
        }
        if (resource === 'reports' && req.method === 'POST') {
          const url = canonicalBeaconUrl(String((req.body as { body?: { url?: unknown } } | null)?.body?.url ?? ''))
          if (!url) return { status: 400, body: { error: 'Bad address.' } }
          return await report(req, url)
        }
        // Federation: anyone may mirror the public aggregates (PRD §14: no permanent central gatekeeper).
        if (resource === 'export' && req.method === 'GET') return await read({ ...req, query: new URLSearchParams({ limit: String(LIMITS.readLimit) }) })
        if (resource === 'admin') return await admin(req, rest)
        return { status: 404, body: { error: 'Not found.' } }
      } catch (error) {
        if (/invalid input syntax for type uuid/i.test(String(error))) return { status: 404, body: { error: 'Not found.' } }
        return { status: 500, body: { error: 'The registry hit an error.' } }
      }
    },
  }
}
