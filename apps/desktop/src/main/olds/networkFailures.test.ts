import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OLDS_UNAVAILABLE, OldsService } from './oldsService'

const dirs: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const claim = (value: unknown) => [{ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } }]
const entities = {
  Q4628: { id: 'Q4628', labels: { en: { value: 'Faroe Islands' } }, descriptions: { en: { value: 'autonomous territory of Denmark' } }, sitelinks: { enwiki: { title: 'Faroe Islands' } }, claims: { P31: claim({ id: 'Q6256' }) } },
}
/** Answers like Wikipedia and Wikidata for one country; `broken` decides which requests go wrong, and how. */
function wiki(broken: (url: URL) => Response | null, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url.toString())
    const bad = broken(url)
    if (bad) return bad
    const params = url.searchParams
    let payload: unknown = {}
    if (params.get('action') === 'wbgetentities') payload = { entities }
    else if (params.get('list') === 'search') payload = { query: { search: [{ title: 'Q4628' }] } }
    else if (url.hostname === 'query.wikidata.org') payload = { results: { bindings: [] } }
    else if (params.get('action') === 'parse') payload = { parse: { title: 'History of the Faroe Islands', wikitext: '' } }
    return new Response(JSON.stringify(payload))
  }) as typeof fetch
}
async function service(fetchImpl: typeof fetch): Promise<{ olds: OldsService; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'olds-failures-'))
  dirs.push(dir)
  return { olds: new OldsService({ cacheDir: dir, fetchImpl, now: () => Date.parse('2026-11-16T12:00:00Z') }), dir }
}
const threadFiles = async (dir: string): Promise<string[]> => (await readdir(dir).catch(() => [] as string[])).filter((name) => /^[0-9a-f]{32}\.json$/.test(name))
const headline = { kind: 'headline' as const, text: 'Paraguay president impeached over banking crisis', countryCode: 'PY' }
const country = { kind: 'country' as const, countryCode: 'FO' }

describe('Wikipedia and Wikidata answering badly', () => {
  it('says so for a server error, never that there is no history', async () => {
    const { olds } = await service(wiki(() => new Response('upstream connect error', { status: 500 })))
    await expect(olds.thread(headline)).rejects.toThrow(OLDS_UNAVAILABLE)
    await expect(olds.thread(country)).rejects.toThrow(OLDS_UNAVAILABLE)
    await expect(olds.thread({ kind: 'wikipedia', title: 'Industrial Revolution' })).rejects.toThrow(OLDS_UNAVAILABLE)
    await expect(olds.thread({ kind: 'chapter', article: 'History of the Faroe Islands', section: 'Early history' })).rejects.toThrow(OLDS_UNAVAILABLE)
  }, 30_000)

  it('says so for an answer that is not JSON (an error page, a cut-off body)', async () => {
    const { olds } = await service(wiki(() => new Response('<html><body>Wikimedia Error</body></html>')))
    await expect(olds.thread(headline)).rejects.toThrow(OLDS_UNAVAILABLE)
    await expect(olds.thread(country)).rejects.toThrow(OLDS_UNAVAILABLE)
  }, 30_000)

  it('gives up on a host that keeps rate limiting after one round of retries, not one round per request', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const { olds } = await service(wiki(() => new Response('', { status: 429 }), calls))
    const outcome = olds.thread(headline).then(() => 'answered', (error: Error) => error.message)
    for (let i = 0; i < 2000 && (await Promise.race([outcome, Promise.resolve('waiting')])) === 'waiting'; i += 1) await vi.advanceTimersByTimeAsync(500)
    expect(await outcome).toBe(OLDS_UNAVAILABLE)
    // One round of backing off for each host (four tries at most), then every later request fails at once: a round
    // per request would be several times as many calls. The clock is not asserted: it is advanced here while the
    // service also waits on the disk, so on a busy Mac it runs ahead of the retries by any amount.
    expect(calls.length).toBeLessThan(40)
    const perHost = new Map<string, number>()
    for (const call of calls) { const host = new URL(call).hostname; perHost.set(host, (perHost.get(host) ?? 0) + 1) }
    expect(Math.max(...perHost.values())).toBeLessThan(40)
  }, 30_000)

  it('shows a thread built while some lookups failed as incomplete, and does not keep it', async () => {
    let failing = true
    const calls: string[] = []
    // The country's facts and history article cannot be read; its Wikidata item can.
    const { olds, dir } = await service(wiki((url) => (failing && url.hostname === 'en.wikipedia.org' ? new Response('', { status: 500 }) : null), calls))
    const first = await olds.thread(country)
    expect(first.partial).toBe(true)
    expect(await threadFiles(dir)).toEqual([])
    failing = false
    const before = calls.length
    const second = await olds.thread(country)
    // Trying again really asks again, and a complete answer is kept.
    expect(calls.length).toBeGreaterThan(before)
    expect(second.partial).toBeUndefined()
    expect(await threadFiles(dir)).toHaveLength(1)
  }, 30_000)

  it('does not count the optional slow events query timing out as a failure', async () => {
    const timeout = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })
    const fetchImpl = wiki(() => null)
    const { olds, dir } = await service((async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).hostname === 'query.wikidata.org') throw timeout
      return fetchImpl(input, init)
    }) as typeof fetch)
    const thread = await olds.thread(country)
    expect(thread.partial).toBeUndefined()
    expect(await threadFiles(dir)).toHaveLength(1)
  }, 30_000)
})
