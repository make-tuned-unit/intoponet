import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aggregateSnapshot, type SourceRecord } from '@intoponet/field-snapshot'
import {
  createPublicSnapshotHandler,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_FUTURE_SKEW_MS,
  publishSnapshot,
} from './store.ts'

const stamp = '2026-10-23T00:00:00.000Z'
const publicSource: SourceRecord = {
  id: 'public-record-1',
  kind: 'public-record',
  title: 'Public record',
  url: 'https://example.org/records/1',
  licence: 'cc-by',
  attribution: 'Example Archive',
  retrievedAt: stamp,
  lat: 40.7,
  lon: -74,
  radiusKm: 10,
  topics: ['civic-memory'],
  weight: 1,
  publishedAt: stamp,
  measurement: {
    kind: 'declared-index',
    value: 1,
    unit: 'index',
    sourceId: 'example-index',
    sourceUrl: 'https://example.org/metrics',
    transformation: 'published test fixture',
  },
}

function snapshot(title: string, at = Date.parse(stamp)) {
  return aggregateSnapshot([{ ...publicSource, title }], at)
}

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'intoponet-public-snapshots-'))
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server did not bind to TCP.')
  return `http://127.0.0.1:${address.port}`
}

function runPublisherCli(inputPath: string, storePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cliPath = fileURLToPath(new URL('../dist/publish.mjs', import.meta.url))
    const child = spawn(process.execPath, [cliPath, inputPath, storePath], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`publisher exited ${code}: ${stderr}`)))
  })
}

describe('public snapshot publisher and read service', () => {
  let directory: string
  let server: Server | undefined
  let baseUrl: string

  beforeEach(async () => {
    directory = tempDir()
    server = createServer(createPublicSnapshotHandler(directory))
    baseUrl = await listen(server)
  })

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
    rmSync(directory, { recursive: true, force: true })
  })

  it('publishes normalized public records, dropping unknown fields and fixing evaluation time', async () => {
    const original = snapshot('Normalized record')
    const withUnknowns = {
      ...original,
      unrecognizedTopLevel: 'discard',
      sources: original.sources.map((source) => ({ ...source, unrecognizedSourceField: 'discard' })),
      bands: original.bands.map((band) => ({ ...band, unrecognizedBandField: 'discard' })),
    }
    const manifest = publishSnapshot(JSON.stringify(withUnknowns), directory)
    expect(manifest.snapshotId).toBe(original.id)
    expect(manifest.evaluationTime).toBe(stamp)

    const latest = await fetch(`${baseUrl}/latest`)
    const latestBody = await latest.json() as typeof manifest
    expect(latest.status).toBe(200)
    expect(latestBody).toEqual(manifest)
    const response = await fetch(`${baseUrl}${manifest.snapshotPath}`, { headers: { 'x-client-clock': '2099-12-31T23:59:59Z' } })
    const servedText = await response.text()
    expect(response.status).toBe(200)
    expect(JSON.parse(servedText)).toEqual(original)
    expect(servedText).not.toContain('unrecognized')
    expect(response.headers.get('etag')).toBe(`"sha256-${manifest.sha256}"`)
    expect(response.headers.get('cache-control')).toContain('immutable')
  })

  it('serves identical immutable bytes and identity to clients with different local clocks', async () => {
    const source = snapshot('Shared clocked artifact', Date.parse('2026-10-23T12:34:56.000Z'))
    const manifest = publishSnapshot(JSON.stringify(source), directory)
    const first = await fetch(`${baseUrl}/latest`, { headers: { date: 'Fri, 23 Oct 2026 12:35:00 GMT' } })
    const second = await fetch(`${baseUrl}/latest`, { headers: { date: 'Wed, 31 Dec 2036 23:59:00 GMT' } })
    const firstManifest = await first.text()
    const secondManifest = await second.text()
    expect(firstManifest).toBe(secondManifest)
    expect(JSON.parse(firstManifest).snapshotId).toBe(manifest.snapshotId)
    expect(JSON.parse(firstManifest).evaluationTime).toBe(source.createdAt)

    const [clientA, clientB] = await Promise.all([
      fetch(`${baseUrl}${manifest.snapshotPath}`).then((response) => response.text()),
      fetch(`${baseUrl}${manifest.snapshotPath}`).then((response) => response.text()),
    ])
    expect(clientA).toBe(clientB)
  })

  it('concurrent publisher processes leave immutable files and a coherent latest pointer', async () => {
    const one = snapshot('Concurrent A')
    const two = snapshot('Concurrent B', Date.parse(stamp) + 1000)
    const oneInput = path.join(directory, 'one.json')
    const twoInput = path.join(directory, 'two.json')
    writeFileSync(oneInput, JSON.stringify(one))
    writeFileSync(twoInput, JSON.stringify(two))
    await Promise.all([runPublisherCli(oneInput, directory), runPublisherCli(oneInput, directory)])
    expect(readFileSync(path.join(directory, `${one.id}.json`), 'utf8')).toContain(one.id)
    await Promise.all([runPublisherCli(oneInput, directory), runPublisherCli(twoInput, directory)])
    const first = { snapshotId: one.id, snapshotPath: `/snapshots/${one.id}` }
    const second = { snapshotId: two.id, snapshotPath: `/snapshots/${two.id}` }
    expect(first.snapshotId).not.toBe(second.snapshotId)
    const latestResponse = await fetch(`${baseUrl}/latest`)
    const latest = await latestResponse.json() as { snapshotId: string; snapshotPath: string; evaluationTime: string }
    expect([first.snapshotId, second.snapshotId]).toContain(latest.snapshotId)
    const artifactResponse = await fetch(`${baseUrl}${latest.snapshotPath}`)
    expect(artifactResponse.status).toBe(200)
    const artifact = await artifactResponse.json() as ReturnType<typeof snapshot>
    expect(artifact.id).toBe(latest.snapshotId)
    expect(artifact.createdAt).toBe(latest.evaluationTime)
  })

  it('supports HEAD and conditional requests with content-addressed ETags', async () => {
    const manifest = publishSnapshot(JSON.stringify(snapshot('HEAD record')), directory)
    const get = await fetch(`${baseUrl}${manifest.snapshotPath}`)
    const etag = get.headers.get('etag')
    const head = await fetch(`${baseUrl}${manifest.snapshotPath}`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'))
    const cached = await fetch(`${baseUrl}${manifest.snapshotPath}`, { headers: { 'if-none-match': etag! } })
    expect(cached.status).toBe(304)
  })

  it('rejects synthetic input, noncanonical advertised IDs, and oversized input', () => {
    const synthetic = aggregateSnapshot([{ ...publicSource, kind: 'synthetic-fixture', id: 'synthetic' }])
    expect(() => publishSnapshot(JSON.stringify(synthetic), directory)).toThrow(/public records only/)
    const changed = snapshot('Different record')
    expect(() => publishSnapshot(JSON.stringify({ ...changed, id: snapshot('Wrong advertised ID').id }), directory))
      .toThrow(/does not match/)
    const valid = snapshot('Band tamper')
    expect(() => publishSnapshot(JSON.stringify({
      ...valid,
      bands: valid.bands.map((band) => ({ ...band, amplitude: band.amplitude / 2 })),
    }), directory)).toThrow(/band values/)
    expect(() => publishSnapshot(' '.repeat(MAX_SNAPSHOT_BYTES + 1), directory)).toThrow(/size limit/)
  })

  it('validates geographic, timestamp, and source-text bounds before publication', () => {
    const valid = snapshot('Bounds check')
    const rejectsSource = (changes: Partial<SourceRecord>, expected: RegExp) => {
      const altered = {
        ...valid,
        sources: [{ ...valid.sources[0]!, ...changes }],
      }
      expect(() => publishSnapshot(JSON.stringify(altered), directory)).toThrow(expected)
    }
    rejectsSource({ lat: 90.1 }, /coordinates/)
    rejectsSource({ lon: -180.1 }, /coordinates/)
    rejectsSource({ radiusKm: 0 }, /radius/)
    rejectsSource({ retrievedAt: 'yesterday' }, /timestamps/)
    rejectsSource({ publishedAt: '2026-02-30T00:00:00Z' }, /timestamps/)
    rejectsSource({ title: 't'.repeat(501) }, /title/)
  })

  it('rejects a snapshot evaluation time beyond the client clock-skew allowance', () => {
    const now = Date.parse('2026-10-29T12:00:00.000Z')
    const withinSkew = snapshot('Within clock skew', now + MAX_SNAPSHOT_FUTURE_SKEW_MS)
    expect(() => publishSnapshot(JSON.stringify(withinSkew), directory, now)).not.toThrow()

    const tooFarAhead = snapshot('Beyond clock skew', now + MAX_SNAPSHOT_FUTURE_SKEW_MS + 1)
    expect(() => publishSnapshot(JSON.stringify(tooFarAhead), directory, now)).toThrow(/evaluation time is unreasonably far in the future/)
    expect(() => publishSnapshot(JSON.stringify(snapshot('Bad publisher clock')), directory, Number.NaN)).toThrow(/Publisher evaluation clock/)

    const scheduledEvent = aggregateSnapshot([{ ...publicSource, endedAt: '2030-01-01T00:00:00.000Z' }], now)
    const scheduledManifest = publishSnapshot(JSON.stringify(scheduledEvent), directory, now)
    expect(scheduledManifest.evaluationTime).toBe(new Date(now).toISOString())
    expect(readFileSync(path.join(directory, `${scheduledManifest.snapshotId}.json`), 'utf8')).toContain('"endedAt":"2030-01-01T00:00:00.000Z"')
  })

  it('fails closed for missing or dangling latest pointers and tampered artifact bytes', async () => {
    expect((await fetch(`${baseUrl}/latest`)).status).toBe(503)
    const source = snapshot('Tamper check')
    const manifest = publishSnapshot(JSON.stringify(source), directory)
    const missingId = `snapshot-v1-${'a'.repeat(64)}`
    writeFileSync(path.join(directory, 'latest.json'), JSON.stringify({
      schema: 'intoponet.shared-public-snapshot-latest.v1',
      snapshotId: missingId,
      sha256: '0'.repeat(64),
      evaluationTime: source.createdAt,
      snapshotPath: `/snapshots/${missingId}`,
    }) + '\n')
    expect((await fetch(`${baseUrl}/latest`)).status).toBe(503)

    writeFileSync(path.join(directory, 'latest.json'), JSON.stringify({
      schema: 'intoponet.shared-public-snapshot-latest.v1',
      snapshotId: source.id,
      sha256: '0'.repeat(64),
      evaluationTime: source.createdAt,
      snapshotPath: `/snapshots/${source.id}`,
    }) + '\n')
    expect((await fetch(`${baseUrl}/latest`)).status).toBe(503)

    writeFileSync(path.join(directory, 'latest.json'), JSON.stringify({
      schema: 'intoponet.shared-public-snapshot-latest.v1',
      snapshotId: manifest.snapshotId,
      sha256: manifest.sha256,
      evaluationTime: manifest.evaluationTime,
      snapshotPath: manifest.snapshotPath,
    }) + '\n')
    const artifact = path.join(directory, `${manifest.snapshotId}.json`)
    writeFileSync(artifact, readFileSync(artifact, 'utf8').replace('Tamper check', 'Altered value'))
    expect((await fetch(`${baseUrl}/latest`)).status).toBe(503)
    expect((await fetch(`${baseUrl}${manifest.snapshotPath}`)).status).toBe(503)
  })

  it('rejects path traversal, unsupported methods, and dangling snapshot IDs', async () => {
    const manifest = publishSnapshot(JSON.stringify(snapshot('Bounded path')), directory)
    expect((await fetch(`${baseUrl}/snapshots/%2e%2e%2flatest`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/snapshots/${manifest.snapshotId}/extra`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/latest`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${baseUrl}/snapshots/${'snapshot-v1-' + 'a'.repeat(64)}`)).status).toBe(404)
  })
})
