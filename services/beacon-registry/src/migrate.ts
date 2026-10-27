import { readFileSync } from 'node:fs'
import pg from 'pg'

/** Apply schema.sql to DATABASE_URL (a Neon connection string works as-is). */
const url = process.env['DATABASE_URL']
if (!url) {
  console.error('Set DATABASE_URL to your Neon (or other Postgres) connection string.')
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
await client.end()
console.log('Beacon registry schema is up to date.')
