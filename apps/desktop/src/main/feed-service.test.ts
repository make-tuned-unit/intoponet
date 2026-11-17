import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAtomicFeedStorage,
  FEED_FETCH_LIMITS,
  FeedFetchService,
  type FeedRegistry,
  type FeedRegistrySource,
  type FeedStorage,
} from './feed-service'

const FIXED_NOW = Date.parse('2026-10-23T12:00:00.000Z')
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture publisher</title><item><guid isPermaLink="false">fixture:one</guid><title>Fixture public item</title><link>/news/one?source=test</link><category>Unapproved category</category><pubDate>Fri, 23 Oct 2026 11:00:00 GMT</pubDate></item></channel></rss>`

class MemoryStorage implements FeedStorage {
  value: string | null = null
  async read(): Promise<string | null> { return this.value }
  async write(serialized: string): Promise<void> { this.value = serialized }
}

function registry(url: string, sourceId = 'hinckley-bosworth-news'): FeedRegistry {
  const source: FeedRegistrySource = {
    sourceId,
    kind: 'rss',
    url,
    publisherName: 'Hinckley & Bosworth Borough Council',
    languageTags: ['en-GB'],
    candidateState: 'admitted-enabled',
    licenseStatus: 'approved',
    approvedFields: ['title', 'canonicalItemUrl', 'guid', 'publishedAt'],
    proposedPollingMinSeconds: 300,
    retentionDays: 30,
  }
  return { enabledSourceIds: [sourceId], sources: [source] }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a local TCP address.')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('FEED_FETCH service', () => {
  const servers: Server[] = []
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close))
  })

  it('keeps the admitted-disabled registry off unless the source is explicitly approved and enabled', async () => {
    const disabledRegistry: FeedRegistry = {
      enabledSourceIds: [],
      sources: [{
        ...registry('https://www.hinckley-bosworth.gov.uk/rss/news').sources[0]!,
        candidateState: 'admitted-disabled',
      }],
    }
    const storage = new MemoryStorage()
    let requests = 0
    const service = new FeedFetchService({
      registry: disabledRegistry,
      storage,
      fetchImpl: async () => { requests += 1; throw new Error('should stay off') },
    })
    await service.start()
    await tick()
    expect(requests).toBe(0)
    expect((await service.snapshot()).sources).toEqual({})
    service.stop()

    expect(() => new FeedFetchService({
      registry: { ...disabledRegistry, enabledSourceIds: ['hinckley-bosworth-news'] },
      storage,
    })).toThrow('not admitted and approved')
  })

  it('fetches bounded metadata, persists validators/items atomically, and retains items on 304/restart', async () => {
    const server = createServer((request, response) => {
      if (request.headers['if-none-match'] === '"feed-v1"' &&
          request.headers['if-modified-since'] === 'Fri, 23 Oct 2026 11:30:00 GMT') {
        response.writeHead(304, { etag: '"feed-v1"', 'cache-control': 'max-age=600', age: '120' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'application/rss+xml',
        etag: '"feed-v1"',
        'last-modified': 'Fri, 23 Oct 2026 11:30:00 GMT',
        'cache-control': 'max-age=0',
      })
      response.end(rss)
    })
    servers.push(server)
    const origin = await listen(server)
    const storage = new MemoryStorage()
    let now = FIXED_NOW
    const service = new FeedFetchService({
      registry: registry(`${origin}/rss/news`),
      storage,
      mode: 'fixture',
      now: () => now,
    })

    const first = await service.refreshSource('hinckley-bosworth-news')
    expect(first.status).toBe('updated')
    expect(first.itemCount).toBe(1)
    let snapshot = await service.snapshot()
    const cached = snapshot.sources['hinckley-bosworth-news']
    expect(cached?.health).toBe('healthy')
    expect(cached?.etag).toBe('"feed-v1"')
    expect(cached?.lastModified).toBe('Fri, 23 Oct 2026 11:30:00 GMT')
    expect(cached?.items[0]).toMatchObject({
      sourceId: 'hinckley-bosworth-news',
      canonicalUrl: `${origin}/news/one?source=test`,
      title: 'Fixture public item',
      publishedAt: '2026-10-23T11:00:00.000Z',
      discoveredAt: '2026-10-23T12:00:00.000Z',
      aboutLocations: [],
      topicIds: [],
    })
    expect(JSON.stringify(snapshot)).not.toContain('Unapproved category')
    expect(storage.value).not.toContain('<rss')

    const earlyManual = await service.refreshSource('hinckley-bosworth-news')
    expect(earlyManual.status).toBe('deferred')

    // Restart before the 300 second polling floor: start schedules a replay at
    // the persisted cursor instead of fetching early or discarding cached rows.
    now += 1_000
    const scheduled: Array<{ callback: () => void; delay: number }> = []
    let nextHandle = 0
    const restart = new FeedFetchService({
      registry: registry(`${origin}/rss/news`),
      storage,
      mode: 'fixture',
      now: () => now,
      setTimer: (callback, delay) => {
        scheduled.push({ callback, delay })
        nextHandle += 1
        return nextHandle as unknown as NodeJS.Timeout
      },
      clearTimer: () => undefined,
    })
    await restart.start()
    snapshot = await restart.snapshot()
    expect(snapshot.sources['hinckley-bosworth-news']?.items).toHaveLength(1)
    expect(scheduled[0]?.delay).toBe(299_000)

    // Manual revalidation proves cursor replay includes both conditional headers.
    now += 480_000
    const second = await restart.refreshSource('hinckley-bosworth-news')
    expect(second.status).toBe('not-modified')
    expect(second.itemCount).toBe(1)
    expect((await restart.snapshot()).sources['hinckley-bosworth-news']?.etag).toBe('"feed-v1"')
    restart.stop()
  })

  it('blocks cross-origin redirects and rejects production localhost/IP destinations', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(302, { location: 'https://example.com/redirected.xml' })
      response.end()
    })
    servers.push(server)
    const origin = await listen(server)
    const fixture = new FeedFetchService({ registry: registry(`${origin}/rss`), storage: new MemoryStorage(), mode: 'fixture' })
    const redirect = await fixture.refreshSource('hinckley-bosworth-news')
    expect(redirect.status).toBe('error')
    expect((await fixture.snapshot()).sources['hinckley-bosworth-news']?.deadLetters[0]?.code).toBe('redirect')

    let requests = 0
    const production = new FeedFetchService({
      registry: registry('https://127.0.0.1/private'),
      storage: new MemoryStorage(),
      fetchImpl: async () => { requests += 1; throw new Error('must not fetch IP hosts') },
    })
    const unsafe = await production.refreshSource('hinckley-bosworth-news')
    expect(unsafe.status).toBe('error')
    expect((await production.snapshot()).sources['hinckley-bosworth-news']?.deadLetters[0]?.code).toBe('unsafe-url')
    expect(requests).toBe(0)
  })

  it('rejects DNS answers containing IPv4-mapped private IPv6 addresses', async () => {
    let requests = 0
    const service = new FeedFetchService({
      registry: registry('https://public-looking.gov/rss'),
      storage: new MemoryStorage(),
      resolveHost: async () => ['2606:4700:4700::1111', '::ffff:7f00:1'],
      fetchImpl: async () => { requests += 1; throw new Error('must not fetch private DNS results') },
    })
    const result = await service.refreshSource('hinckley-bosworth-news')
    expect(result.status).toBe('error')
    expect((await service.snapshot()).sources['hinckley-bosworth-news']?.deadLetters[0]?.code).toBe('unsafe-url')
    expect(requests).toBe(0)
  })

  it('applies the timeout while a DNS lookup is pending', async () => {
    let requests = 0
    const service = new FeedFetchService({
      registry: registry('https://public-looking.gov/rss'),
      storage: new MemoryStorage(),
      resolveHost: () => new Promise<string[]>(() => undefined),
      setTimer: (callback) => {
        queueMicrotask(callback)
        return 1 as unknown as NodeJS.Timeout
      },
      clearTimer: () => undefined,
      fetchImpl: async () => { requests += 1; throw new Error('DNS timeout should prevent fetch') },
    })
    const result = await service.refreshSource('hinckley-bosworth-news')
    expect(result.status).toBe('error')
    expect((await service.snapshot()).sources['hinckley-bosworth-news']?.deadLetters[0]?.code).toBe('timeout')
    expect(requests).toBe(0)
  })

  it('bounds streamed response bytes and honors Retry-After with exponential backoff', async () => {
    const large = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/rss+xml' })
      response.write(`<rss><channel>${'x'.repeat(800)}</channel>`)
      response.end(' '.repeat(800))
    })
    servers.push(large)
    const largeOrigin = await listen(large)
    const largeService = new FeedFetchService({
      registry: registry(`${largeOrigin}/large`),
      storage: new MemoryStorage(),
      mode: 'fixture',
      maxResponseBytes: 1_024,
      now: () => FIXED_NOW,
    })
    const tooLarge = await largeService.refreshSource('hinckley-bosworth-news')
    expect(tooLarge.status).toBe('error')
    expect((await largeService.snapshot()).sources['hinckley-bosworth-news']?.deadLetters[0]?.code).toBe('oversized')

    const throttled = createServer((_request, response) => {
      response.writeHead(429, { 'retry-after': '600' })
      response.end()
    })
    servers.push(throttled)
    const throttledOrigin = await listen(throttled)
    const throttledService = new FeedFetchService({
      registry: registry(`${throttledOrigin}/rss`),
      storage: new MemoryStorage(),
      mode: 'fixture',
      now: () => FIXED_NOW,
    })
    const retry = await throttledService.refreshSource('hinckley-bosworth-news')
    expect(retry.status).toBe('error')
    expect(retry.nextAttemptAt).toBe('2026-10-23T12:10:00.000Z')
    expect((await throttledService.snapshot()).sources['hinckley-bosworth-news']?.deadLetters[0]?.status).toBe(429)
  })

  it('tries feeds that failed for want of a network again at once, and leaves other failures backed off', async () => {
    let now = FIXED_NOW
    let online = false
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/rss+xml' })
      response.end(rss)
    })
    servers.push(server)
    const origin = await listen(server)
    const offlineFetch: typeof fetch = async (input, init) => {
      if (!online) throw new TypeError('fetch failed')
      return fetch(input, init)
    }
    const service = new FeedFetchService({ registry: registry(`${origin}/rss`), storage: new MemoryStorage(), mode: 'fixture', fetchImpl: offlineFetch, now: () => now })
    // A night offline: every attempt fails and the backoff grows.
    for (let i = 0; i < 6; i += 1) {
      const failed = await service.refreshSource('hinckley-bosworth-news')
      expect(failed.status).toBe('error')
      now = Date.parse(failed.nextAttemptAt!)
    }
    now += 60_000
    const failed = await service.refreshSource('hinckley-bosworth-news')
    expect(Date.parse(failed.nextAttemptAt!) - now).toBeGreaterThan(2 * 60 * 60_000)
    expect((await service.refreshSource('hinckley-bosworth-news')).status).toBe('deferred')
    // Back online: the feed is due now, not hours from now.
    online = true
    expect(service.retryNetworkFailures()).toBe(1)
    const updated = await service.refreshSource('hinckley-bosworth-news')
    expect(updated.status).toBe('updated')
    expect(service.retryNetworkFailures()).toBe(0)
    service.stop()

    const refused = createServer((_request, response) => { response.writeHead(500); response.end() })
    servers.push(refused)
    const refusedOrigin = await listen(refused)
    const broken = new FeedFetchService({ registry: registry(`${refusedOrigin}/rss`), storage: new MemoryStorage(), mode: 'fixture', now: () => FIXED_NOW })
    expect((await broken.refreshSource('hinckley-bosworth-news')).status).toBe('error')
    expect(broken.retryNetworkFailures()).toBe(0)
    expect((await broken.refreshSource('hinckley-bosworth-news')).status).toBe('deferred')
  })

  it('caps request concurrency and deduplicates in-flight jobs per source', async () => {
    let active = 0
    let maxActive = 0
    const server = createServer(async (_request, response) => {
      active += 1
      maxActive = Math.max(active, maxActive)
      await new Promise((resolve) => setTimeout(resolve, 15))
      response.writeHead(200, { 'content-type': 'application/rss+xml' })
      response.end(rss)
      active -= 1
    })
    servers.push(server)
    const origin = await listen(server)
    const sourceA = registry(`${origin}/a`, 'feed-a').sources[0]!
    const sourceB = registry(`${origin}/b`, 'feed-b').sources[0]!
    const service = new FeedFetchService({
      registry: { enabledSourceIds: ['feed-a', 'feed-b'], sources: [sourceA, sourceB] },
      storage: new MemoryStorage(),
      mode: 'fixture',
      maxConcurrency: 1,
    })
    const a1 = service.refreshSource('feed-a')
    const a2 = service.refreshSource('feed-a')
    const results = await Promise.all([a1, a2, service.refreshSource('feed-b')])
    expect(results.map((result) => result.status)).toEqual(['updated', 'updated', 'updated'])
    expect(maxActive).toBe(1)
    expect((await service.snapshot()).sources['feed-a']?.items).toHaveLength(1)
  })

  it('does not persist items or validators from a no-store response', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { etag: '"no-store-v1"', 'cache-control': 'no-store' })
      response.end(rss)
    })
    servers.push(server)
    const origin = await listen(server)
    const storage = new MemoryStorage()
    const service = new FeedFetchService({
      registry: registry(`${origin}/rss`),
      storage,
      mode: 'fixture',
      now: () => FIXED_NOW,
    })
    const result = await service.refreshSource('hinckley-bosworth-news')
    expect(result.receivedItems).toHaveLength(1)
    expect(result.persistenceAllowed).toBe(false)
    const state = (await service.snapshot()).sources['hinckley-bosworth-news']
    expect(state?.items).toEqual([])
    expect(state).not.toHaveProperty('etag')
    expect(state).not.toHaveProperty('lastObservedItemAt')
    expect(storage.value).not.toContain('Fixture public item')
    expect(storage.value).not.toContain('no-store-v1')
  })

  it('purges expired retained items on a 304 and respects the next-attempt cursor', async () => {
    let now = FIXED_NOW
    const storage = new MemoryStorage()
    const responseCache = JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-10-23T12:00:00.000Z',
      sources: {
        'hinckley-bosworth-news': {
          health: 'healthy', failures: 0, deadLetters: [],
          nextAttemptAt: '2026-10-23T12:00:00.000Z',
          items: [{
            schemaVersion: '1.0', id: 'old', sourceId: 'hinckley-bosworth-news',
            canonicalUrl: 'https://example.gov/old', title: 'Old item', language: 'en-GB',
            discoveredAt: '2026-09-01T12:00:00.000Z', sourceContentHash: 'a'.repeat(64),
            topicIds: [], aboutLocations: [], provenanceId: 'prov-old',
          }],
        },
      },
    })
    storage.value = responseCache
    let requests = 0
    const service = new FeedFetchService({
      registry: registry('https://public-looking.gov/rss'),
      storage,
      now: () => now,
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async () => {
        requests += 1
        return new Response(null, { status: 304 })
      },
    })
    const refreshed = await service.refreshSource('hinckley-bosworth-news')
    expect(refreshed.status).toBe('not-modified')
    expect(refreshed.itemCount).toBe(0)
    expect(requests).toBe(1)
  })

  it('marks a no-store 304 as non-persistent and clears previously cached content', async () => {
    const now = FIXED_NOW
    const storage = new MemoryStorage()
    storage.value = JSON.stringify({
      schemaVersion: 1,
      updatedAt: new Date(now - 60_000).toISOString(),
      sources: {
        'hinckley-bosworth-news': {
          health: 'healthy', failures: 0, deadLetters: [],
          etag: '"previous"', nextAttemptAt: new Date(now - 1).toISOString(),
          items: [{
            schemaVersion: '1.0', id: 'retained', sourceId: 'hinckley-bosworth-news',
            canonicalUrl: 'https://example.org/retained', title: 'Retained public item',
            language: 'en-GB', discoveredAt: new Date(now - 60_000).toISOString(),
            sourceContentHash: 'a'.repeat(64), topicIds: [], aboutLocations: [], provenanceId: 'prov-retained',
          }],
        },
      },
    })
    const service = new FeedFetchService({
      registry: registry('https://public-looking.gov/rss'), storage, now: () => now,
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async () => new Response(null, { status: 304, headers: { 'cache-control': 'no-store' } }),
    })

    const result = await service.refreshSource('hinckley-bosworth-news')

    expect(result.status).toBe('not-modified')
    expect(result.persistenceAllowed).toBe(false)
    expect((await service.snapshot()).sources['hinckley-bosworth-news']?.items).toEqual([])
    expect(storage.value).not.toContain('Retained public item')
    expect(storage.value).not.toContain('"previous"')
  })

  it('does not replay CRLF or oversized validators from a malformed persistent cursor', async () => {
    const sentHeaders: Array<{ etag: string | undefined; lastModified: string | undefined }> = []
    const server = createServer((request, response) => {
      sentHeaders.push({
        etag: request.headers['if-none-match'],
        lastModified: request.headers['if-modified-since'],
      })
      response.writeHead(200, { 'cache-control': 'max-age=0' })
      response.end(rss)
    })
    servers.push(server)
    const origin = await listen(server)
    const storage = new MemoryStorage()
    storage.value = JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-10-23T12:00:00.000Z',
      sources: {
        'hinckley-bosworth-news': {
          health: 'healthy', failures: 0, items: [], deadLetters: [],
          etag: '"safe"\r\nif-modified-since: attacker-value',
          lastModified: 'x'.repeat(200),
          nextAttemptAt: '2026-10-23T12:00:00.000Z',
        },
      },
    })
    const service = new FeedFetchService({ registry: registry(`${origin}/rss`), storage, mode: 'fixture' })
    const result = await service.refreshSource('hinckley-bosworth-news')
    expect(result.status).toBe('updated')
    expect(sentHeaders).toEqual([{ etag: undefined, lastModified: undefined }])
  })

  it('classifies timeout and cancels queued/in-flight jobs when stopped', async () => {
    const timeoutSource = registry('http://127.0.0.1:40123/timeout')
    const reasons: unknown[] = []
    const timeout = new FeedFetchService({
      registry: timeoutSource,
      storage: new MemoryStorage(),
      mode: 'fixture',
      setTimer: (callback) => {
        queueMicrotask(callback)
        return 1 as unknown as NodeJS.Timeout
      },
      clearTimer: () => undefined,
      fetchImpl: async (_url, init) => {
        if (init?.signal?.aborted) {
          reasons.push(init.signal.reason)
          throw new Error('aborted')
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => { reasons.push(init.signal!.reason); reject(new Error('aborted')) }, { once: true })
        })
      },
    })
    const timedOut = await timeout.refreshSource('hinckley-bosworth-news')
    expect(timedOut.status).toBe('error')
    // Hundreds of feeds time out at a start: the reason a request is stopped with carries no stack trace.
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBeInstanceOf(Error)
    expect((reasons[0] as Error).message).toBe('Feed request timed out.')
    expect((reasons[0] as Error).stack ?? '').not.toMatch(/\n\s+at /)
    expect((await timeout.snapshot()).sources['hinckley-bosworth-news']?.deadLetters[0]?.code).toBe('timeout')

    const sourceA = registry('http://127.0.0.1:40123/a', 'feed-a').sources[0]!
    const sourceB = registry('http://127.0.0.1:40123/b', 'feed-b').sources[0]!
    let requests = 0
    const queued = new FeedFetchService({
      registry: { enabledSourceIds: ['feed-a', 'feed-b'], sources: [sourceA, sourceB] },
      storage: new MemoryStorage(),
      mode: 'fixture',
      maxConcurrency: 1,
      fetchImpl: async (_url, init) => {
        requests += 1
        return await new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new Error('aborted'))
          else init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
    })
    const first = queued.refreshSource('feed-a')
    const second = queued.refreshSource('feed-b')
    await tick()
    queued.stop()
    await expect(second).rejects.toThrow('stopped')
    expect((await first).status).toBe('error')
    expect(requests).toBe(1)
  })

  it('keeps the saved feeds when it is stopped and flushed before it has read them', async () => {
    // Quitting moments after launch: the saved cache is still being read when the quit asks for a last save.
    const saved = new MemoryStorage()
    const first = new FeedFetchService({
      registry: registry('http://127.0.0.1:40123/feed'),
      storage: saved,
      mode: 'fixture',
      now: () => FIXED_NOW,
      fetchImpl: async () => new Response(rss, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
    })
    expect((await first.refreshSource('hinckley-bosworth-news')).status).toBe('updated')
    const before = saved.value!
    expect(JSON.parse(before).sources['hinckley-bosworth-news'].items).toHaveLength(1)

    let finishRead!: () => void
    const slow: FeedStorage = {
      read: () => new Promise((resolve) => { finishRead = () => resolve(saved.value) }),
      write: async (serialized) => { saved.value = serialized },
    }
    const second = new FeedFetchService({ registry: registry('http://127.0.0.1:40123/feed'), storage: slow, mode: 'fixture', now: () => FIXED_NOW + 60_000 })
    const starting = second.start()
    await tick()
    second.stop()
    await second.flush()
    expect(saved.value).toBe(before)
    finishRead()
    await starting
    // Once read, a flush saves what it holds (the same feeds, with a newer date).
    await second.flush()
    expect(JSON.parse(saved.value!).sources['hinckley-bosworth-news'].items).toHaveLength(1)
    expect(JSON.parse(saved.value!).updatedAt).not.toBe(JSON.parse(before).updatedAt)
  })

  it('rejects non-finite numeric limits instead of silently disabling guards', () => {
    expect(() => new FeedFetchService({
      registry: { enabledSourceIds: [], sources: [] },
      storage: new MemoryStorage(),
      timeoutMs: Number.NaN,
    })).toThrow('timeoutMs must be a finite integer')
  })

  it('writes a bounded cache via atomic replace with owner-only permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intoponet-feed-cache-'))
    try {
      const path = join(directory, 'public-feed-cache.v1.json')
      const storage = createAtomicFeedStorage(path)
      await storage.write(JSON.stringify({ publicOnly: true }))
      expect(await storage.read()).toBe('{"publicOnly":true}')
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      await expect(storage.write('x'.repeat(FEED_FETCH_LIMITS.cacheBytes + 1))).rejects.toThrow('size limit')
      expect(await readFile(path, 'utf8')).toBe('{"publicOnly":true}')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('public address check', () => {
  it('blocks reserved ranges but not public 192.0.x.x hosting', async () => {
    const { privateIpv4 } = await import('./feed-service')
    for (const address of ['10.1.2.3', '127.0.0.1', '192.168.1.1', '192.0.0.8', '192.0.2.10', '198.18.0.1', '198.51.100.7', '203.0.113.9', '100.64.0.1', '169.254.1.1']) {
      expect(privateIpv4(address), address).toBe(true)
    }
    for (const address of ['192.0.66.98', '192.0.78.195', '8.8.8.8', '151.101.1.140']) {
      expect(privateIpv4(address), address).toBe(false)
    }
  })
})
