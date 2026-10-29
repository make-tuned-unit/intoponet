import { createServer } from 'node:http'
import { createPublicSnapshotHandler } from './store.ts'

const storagePath = process.env['SNAPSHOT_STORE_PATH']
if (!storagePath) {
  console.error('Set SNAPSHOT_STORE_PATH to a dedicated public-snapshot storage directory.')
  process.exit(1)
}
const port = Number(process.env['PORT'] ?? 8788)
const host = process.env['HOST'] ?? '127.0.0.1'
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error('PORT must be an integer from 0 through 65535.')
  process.exit(1)
}

createServer({ maxHeaderSize: 8_192, headersTimeout: 10_000, requestTimeout: 15_000 },
  createPublicSnapshotHandler(storagePath))
  .listen(port, host, () => console.log(`Public snapshot read service on ${host}:${port}`))
