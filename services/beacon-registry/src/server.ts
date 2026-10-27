import { createServer } from 'node:http'
import pg from 'pg'
import { createRegistry } from './registry.ts'

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

createServer(async (request, response) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > 16_384) {
      response.writeHead(413).end()
      return
    }
    chunks.push(chunk as Buffer)
  }
  let body: unknown = null
  try {
    body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Body must be JSON.' }))
    return
  }
  const address = new URL(request.url ?? '/', 'http://registry')
  const forwarded = String(request.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim()
  const result = await registry.handle({
    method: request.method ?? 'GET',
    path: address.pathname,
    query: address.searchParams,
    body,
    ip: forwarded || request.socket.remoteAddress || 'unknown',
    ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
  })
  response.writeHead(result.status, { 'content-type': 'application/json', ...(result.headers ?? {}) }).end(JSON.stringify(result.body))
}).listen(Number(process.env['PORT'] ?? 8787), () => console.log(`Beacon registry on :${process.env['PORT'] ?? 8787}`))
