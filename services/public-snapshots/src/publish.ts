import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import path from 'node:path'
import { MAX_SNAPSHOT_BYTES, publishSnapshot } from './store.ts'

const [inputPath, storagePath] = process.argv.slice(2)
if (!inputPath || !storagePath || process.argv.length !== 4) {
  console.error('usage: npm run publish -- <snapshot.json> <storage-directory>')
  process.exit(2)
}

try {
  const resolvedInput = path.resolve(inputPath)
  const fd = openSync(resolvedInput, 'r')
  let input: Buffer
  try {
    const stats = fstatSync(fd)
    if (!stats.isFile()) throw new Error('Snapshot input must be a regular file.')
    if (stats.size > MAX_SNAPSHOT_BYTES) throw new Error(`Snapshot exceeds ${MAX_SNAPSHOT_BYTES} byte limit.`)
    const chunks: Buffer[] = []
    let totalBytes = 0
    while (totalBytes <= MAX_SNAPSHOT_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_SNAPSHOT_BYTES + 1 - totalBytes))
      const bytesRead = readSync(fd, chunk, 0, chunk.byteLength, null)
      if (bytesRead === 0) break
      totalBytes += bytesRead
      if (totalBytes > MAX_SNAPSHOT_BYTES) throw new Error(`Snapshot exceeds ${MAX_SNAPSHOT_BYTES} byte limit.`)
      chunks.push(chunk.subarray(0, bytesRead))
    }
    input = Buffer.concat(chunks, totalBytes)
  } finally {
    closeSync(fd)
  }
  const manifest = publishSnapshot(input.toString('utf8'), path.resolve(storagePath))
  console.log(`Published immutable snapshot ${manifest.snapshotId}`)
  console.log(`Latest evaluation time: ${manifest.evaluationTime}`)
} catch (error) {
  console.error(`Snapshot publication rejected: ${(error as Error).message}`)
  process.exit(1)
}
