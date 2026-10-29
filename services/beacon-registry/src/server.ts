import { createServer } from 'node:http'
import pg from 'pg'
import { createRegistry } from './registry.ts'
import { createRegistryHttpHandler } from './http.ts'

/**
 * Standalone HTTP server for the registry. Environment:
 * DATABASE_URL (Neon), BEACON_SECRET (salts daily network hashes),
 * BEACON_ADMIN_TOKEN (moderation), PORT (default 8787).
 */
const url = process.env['DATABASE_URL']
const secret = process.env['BEACON_SECRET']
if (!url || !secret || secret.length < 32) {
  console.error('Set DATABASE_URL and BEACON_SECRET (32+ random characters).')
  process.exit(1)
}
const pool = new pg.Pool({ connectionString: url, max: 5 })
const registry = createRegistry({
  query: async (sql, params) => (await pool.query(sql, params)).rows,
  secret,
  ...(process.env['BEACON_ADMIN_TOKEN'] ? { adminToken: process.env['BEACON_ADMIN_TOKEN'] } : {}),
})

const port = Number(process.env['PORT'] ?? 8787)
createServer(
  { maxHeaderSize: 8_192, headersTimeout: 10_000, requestTimeout: 30_000 },
  createRegistryHttpHandler(registry),
).listen(port, () => console.log(`Beacon registry on :${port}`))
