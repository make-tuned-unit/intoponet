import { attachDatabasePool } from '@neon/functions'
import pg from 'pg'
import { createRegistry } from './registry.ts'

/**
 * The beacon registry as a Neon Function (Node 24, next to its Lakebase
 * Postgres). DATABASE_URL is injected by Neon; BEACON_SECRET and
 * BEACON_ADMIN_TOKEN are Function env from neon.ts.
 */
const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 5 })
attachDatabasePool(pool)

const registry = createRegistry({
  query: async (sql, params) => (await pool.query(sql, params)).rows,
  secret: process.env['BEACON_SECRET'] ?? '',
  ...(process.env['BEACON_ADMIN_TOKEN'] ? { adminToken: process.env['BEACON_ADMIN_TOKEN'] } : {}),
})

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export default {
  async fetch(request: Request): Promise<Response> {
    if ((process.env['BEACON_SECRET'] ?? '').length < 32) return json(503, { error: 'The registry is not configured.' })
    const text = request.method === 'GET' ? '' : await request.text()
    if (text.length > 16_384) return json(413, { error: 'Request too large.' })
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      return json(400, { error: 'Body must be JSON.' })
    }
    const url = new URL(request.url)
    // No client IP: X-Forwarded-For is not a trustworthy address on Neon Functions, so per-network limits belong at an edge proxy.
    const authorization = request.headers.get('authorization')
    const result = await registry.handle({
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      body,
      ...(authorization ? { authorization } : {}),
    })
    return json(result.status, result.body, result.headers)
  },
}
