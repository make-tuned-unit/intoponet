import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { FeedFetchService, type FeedRegistry, type FeedRegistrySource, type FeedStorage } from './feed-service'
import { ingestPublicFeedBatch, type AdmittedIngestionSource, type IngestionStorage } from './public-feed-ingestion'

const INITIAL_NOW = Date.parse('2026-10-23T12:00:00.000Z')
const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture council</title><item><guid isPermaLink="false">feed:item-1</guid><title>Public transit update</title><link>/story/1</link><pubDate>Fri, 23 Oct 2026 11:30:00 GMT</pubDate></item></channel></rss>`

class MemoryStorage implements FeedStorage, IngestionStorage {
  value: string | null = null
  async read(): Promise<string | null> { return this.value }
  async write(value: string): Promise<void> { this.value = value }
}

function runtimeSource(url: string): AdmittedIngestionSource {
  return {
    sourceId: 'fixture-council',
    kind: 'rss',
    url,
    publisherName: 'Fixture Council',
    languageTags: ['en-GB'],
    candidateState: 'admitted-enabled',
    licenseStatus: 'approved',
    approvedFields: ['title', 'canonicalItemUrl', 'guid', 'publishedAt'],
    proposedPollingMinSeconds: 300,
    retentionDays: 30,
    independentPublisherGroupId: 'fixture-council-group',
    declaredCoverage: { countryCodes: ['GB'], regionIds: ['fixture-region'], cityIds: [] },
    geographicScope: 'local',
    termsUrl: 'https://fixture.invalid/terms',
    licenseUrl: 'https://fixture.invalid/license',
    attribution: 'Fixture Council; fixture public feed under fixture terms.',
    rightsEvidence: 'Controlled local fixture used only for deterministic ingestion testing.',
  }
}

function fetchRegistry(source: AdmittedIngestionSource): FeedRegistry {
  const row: FeedRegistrySource = source
  return { enabledSourceIds: [source.sourceId], sources: [row] }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected local TCP listener')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

describe('public feed ingestion coordinator', () => {
  const servers: Server[] = []
  afterEach(async () => Promise.all(servers.splice(0).map(close)))

  it('connects a synthetic RSS fetch to stable public-only history and attributed provenance', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/rss+xml', 'cache-control': 'max-age=0' })
      response.end(xml)
    })
    servers.push(server)
    const source = runtimeSource(`${await listen(server)}/rss`)
    const fetchStorage = new MemoryStorage()
    const historyStorage = new MemoryStorage()
    const service = new FeedFetchService({ registry: fetchRegistry(source), storage: fetchStorage, mode: 'fixture', now: () => INITIAL_NOW })
    const result = await service.refreshSource(source.sourceId)
    const fetchSnapshot = await service.snapshot()
    const first = await ingestPublicFeedBatch({
      sources: [source], results: [result], fetchStates: fetchSnapshot.sources, storage: historyStorage, now: () => INITIAL_NOW,
    })
    expect(first.outcomes[0]).toMatchObject({ outcome: 'updated', receivedItemCount: 1 })
    expect(first.history.items).toHaveLength(1)
    const firstSeenAt = first.history.items[0]?.firstSeenAt
    expect(first.history.items[0]?.item).toMatchObject({
      sourceId: source.sourceId,
      title: 'Public transit update',
      canonicalUrl: `${new URL(source.url).origin}/story/1`,
      aboutLocations: [],
    })
    expect(first.sources[0]).toMatchObject({
      attribution: source.attribution,
      termsUrl: source.termsUrl,
      licenseUrl: source.licenseUrl,
      retentionDays: 30,
    })
    expect(first.provenance.entries).toMatchObject([{
      sourceId: source.sourceId,
      itemIds: [first.history.items[0]?.item.id],
      canonicalUrls: [`${new URL(source.url).origin}/story/1`],
    }])
    expect(JSON.stringify(first)).not.toContain('<rss')
    expect(first.history.items[0]?.item).not.toHaveProperty('description')
    expect(first.history.items[0]?.item).not.toHaveProperty('media')

    const quiet = await ingestPublicFeedBatch({
      sources: [source],
      results: [{ ...result, status: 'not-modified', receivedItems: [] }],
      fetchStates: fetchSnapshot.sources,
      storage: historyStorage,
      now: () => INITIAL_NOW + 301_000,
    })
    expect(quiet.outcomes[0]?.outcome).toBe('unchanged')
    expect(quiet.history.items).toHaveLength(1)

    const repeated = await ingestPublicFeedBatch({
      sources: [source], results: [result], fetchStates: fetchSnapshot.sources, storage: historyStorage, now: () => INITIAL_NOW + 302_000,
    })
    expect(repeated.outcomes[0]).toMatchObject({ outcome: 'updated', receivedItemCount: 1 })
    expect(repeated.history.items[0]?.firstSeenAt).toBe(firstSeenAt)
    const emptySuccessful = await ingestPublicFeedBatch({
      sources: [source],
      results: [{ ...result, receivedItems: [] }],
      fetchStates: fetchSnapshot.sources,
      storage: historyStorage,
      now: () => INITIAL_NOW + 303_000,
    })
    expect(emptySuccessful.outcomes[0]).toMatchObject({ outcome: 'updated', receivedItemCount: 0 })
    expect(emptySuccessful.history.items).toHaveLength(1)

    const shortSource = { ...source, retentionDays: 1 }
    const shortStore = new MemoryStorage()
    await ingestPublicFeedBatch({
      sources: [shortSource], results: [result], fetchStates: fetchSnapshot.sources, storage: shortStore, now: () => INITIAL_NOW,
    })
    const expired = await ingestPublicFeedBatch({
      sources: [shortSource], results: [], fetchStates: fetchSnapshot.sources, storage: shortStore,
      now: () => INITIAL_NOW + 2 * 86_400_000,
    })
    expect(expired.history.items).toEqual([])

    const now = INITIAL_NOW + 301_000
    const second = await ingestPublicFeedBatch({
      sources: [source], results: [result], fetchStates: fetchSnapshot.sources, storage: historyStorage, now: () => now,
    })
    expect(second.history.items[0]?.firstSeenAt).toBe(firstSeenAt)
  })

  it('purges prior source history on no-store and preserves it across an outage', async () => {
    let responseMode: 'normal' | 'no-store' | 'outage' = 'normal'
    const server = createServer((_request, response) => {
      if (responseMode === 'outage') {
        response.writeHead(503, { 'retry-after': '300' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'application/rss+xml',
        'cache-control': responseMode === 'no-store' ? 'no-store' : 'max-age=0',
        etag: '"feed-v1"',
        'last-modified': 'Fri, 23 Oct 2026 11:30:00 GMT',
      })
      response.end(xml)
    })
    servers.push(server)
    const source = runtimeSource(`${await listen(server)}/rss`)
    const fetchStorage = new MemoryStorage()
    const historyStorage = new MemoryStorage()
    let now = INITIAL_NOW
    const service = new FeedFetchService({ registry: fetchRegistry(source), storage: fetchStorage, mode: 'fixture', now: () => now })
    let result = await service.refreshSource(source.sourceId)
    let snapshot = await service.snapshot()
    let artifact = await ingestPublicFeedBatch({ sources: [source], results: [result], fetchStates: snapshot.sources, storage: historyStorage, now: () => now })
    expect(artifact.history.items).toHaveLength(1)

    responseMode = 'outage'
    now += 301_000
    result = await service.refreshSource(source.sourceId)
    snapshot = await service.snapshot()
    artifact = await ingestPublicFeedBatch({ sources: [source], results: [result], fetchStates: snapshot.sources, storage: historyStorage, now: () => now })
    expect(artifact.outcomes[0]?.outcome).toBe('outage')
    expect(artifact.history.items).toHaveLength(1)
    expect(artifact.history.sources[0]?.health).toBe('stale')

    responseMode = 'no-store'
    now += 301_000
    result = await service.refreshSource(source.sourceId)
    snapshot = await service.snapshot()
    artifact = await ingestPublicFeedBatch({ sources: [source], results: [result], fetchStates: snapshot.sources, storage: historyStorage, now: () => now })
    expect(result.persistenceAllowed).toBe(false)
    expect(artifact.outcomes[0]?.outcome).toBe('updated')
    expect(artifact.outcomes[0]?.persistenceAllowed).toBe(false)
    expect(artifact.history.items).toEqual([])
    expect(artifact.provenance.entries).toEqual([])
    expect(artifact.history.sources[0]).not.toHaveProperty('etag')
    expect(artifact.history.sources[0]).not.toHaveProperty('lastModified')
    expect(historyStorage.value).not.toContain('Public transit update')
  })
})
