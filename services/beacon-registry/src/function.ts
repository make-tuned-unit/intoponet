import { attachDatabasePool } from '@neon/functions'
import pg from 'pg'
import { createRegistry } from './registry.ts'
import { readLimitedJsonBody } from './functionHttp.ts'
import { edgeClientAddress } from './edge.ts'

/**
 * The beacon registry as a Neon Function (Node 24, next to its Lakebase
 * Postgres). DATABASE_URL is injected by Neon; the rest is Function env from neon.ts:
 *
 * - BEACON_SECRET: salts the daily network hashes (32+ characters).
 * - BEACON_ADMIN_TOKEN: moderator bearer token.
 * - BEACON_EDGE_SECRET: shared with the edge proxy. When set, publishes and
 *   reports must arrive through the edge, which supplies a verified client
 *   address for per-network limits. The native URL then only serves reads.
 * - BEACON_PUBLISH_PAUSED: "1" refuses new publishes.
 * - BEACON_GLOBAL_PUBLISH_PER_DAY: optional override of the daily ceiling.
 */
const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 5 })
attachDatabasePool(pool)

const edgeSecret = process.env['BEACON_EDGE_SECRET'] ?? ''
const globalLimit = Number(process.env['BEACON_GLOBAL_PUBLISH_PER_DAY'])

const registry = createRegistry({
  query: async (sql, params) => (await pool.query(sql, params)).rows,
  secret: process.env['BEACON_SECRET'] ?? '',
  ...(process.env['BEACON_ADMIN_TOKEN'] ? { adminToken: process.env['BEACON_ADMIN_TOKEN'] } : {}),
  publishPaused: process.env['BEACON_PUBLISH_PAUSED'] === '1',
  requireNetwork: edgeSecret.length >= 32,
  ...(Number.isInteger(globalLimit) && globalLimit > 0 ? { globalPublishPerDay: globalLimit } : {}),
})

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export default {
  async fetch(request: Request): Promise<Response> {
    if ((process.env['BEACON_SECRET'] ?? '').length < 32) return json(503, { error: 'The registry is not configured.' })
    const url = new URL(request.url)
    // Daily retention purge from a Neon Function Trigger. Neon strips client-sent
    // x-neon-* headers, so this header's presence shows the request came from Neon.
    if (url.pathname === '/internal/purge') {
      if (request.method !== 'POST' || !request.headers.get('x-neon-trigger-invocation-id')) return json(404, { error: 'Not found.' })
      return json(200, await registry.purge())
    }
    const parsed = request.method === 'GET' || request.method === 'HEAD'
      ? { ok: true as const, body: null }
      : await readLimitedJsonBody(request)
    if (!parsed.ok) return json(parsed.status, { error: parsed.error })
    // X-Forwarded-For is not trustworthy on Neon Functions; only the edge proxy's
    // authenticated header supplies a client address.
    const ip = edgeClientAddress(request.headers, edgeSecret)
    const authorization = request.headers.get('authorization')
    const result = await registry.handle({
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      body: parsed.body,
      ...(ip ? { ip } : {}),
      ...(authorization ? { authorization } : {}),
    })
    return json(result.status, result.body, result.headers)
  },
}
