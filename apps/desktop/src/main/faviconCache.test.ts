import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingWrite } from './atomicFile'
import { FaviconCache, MAX_ICON_HOSTS } from './faviconCache'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
let dir = ''
let file = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'favicons-'))
  file = join(dir, 'favicons.json')
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const png = () => new Response(PNG, { headers: { 'content-type': 'image/png' } })

describe('favicon cache', () => {
  it('cuts off an icon body that streams past the size cap without a content-length', async () => {
    let pulled = 0
    const endless = () => new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(64 * 1024))
      },
    })
    const fetchImpl = (async () => new Response(endless(), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch
    const cache = new FaviconCache(file, fetchImpl)
    expect(await cache.get(['big.example.org'])).toEqual({})
    // 100 KB cap: two 64 KB chunks per attempt (the bare host and www.), not the whole stream.
    expect(pulled).toBeLessThan(10)
  })

  it('keeps small icons as data URLs', async () => {
    const cache = new FaviconCache(file, (async () => png()) as unknown as typeof fetch)
    expect(await cache.get(['ok.example.org'])).toEqual({ 'ok.example.org': `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` })
  })

  it('fetches a page-reported icon once per host at a time, then waits before the next', async () => {
    let now = 1_000_000
    const started: string[] = []
    const releases: Array<() => void> = []
    const fetchImpl = ((url: string) => {
      started.push(url)
      return new Promise<Response>((resolve) => releases.push(() => resolve(png())))
    }) as unknown as typeof fetch
    const cache = new FaviconCache(file, fetchImpl, () => now)
    for (let i = 0; i < 50; i += 1) cache.remember('https://spin.example.org/page', `https://spin.example.org/icon-${i}.png`)
    expect(started).toHaveLength(1)
    releases.shift()!()
    await flush()
    await flush()
    cache.remember('https://spin.example.org/page', 'https://spin.example.org/icon-later.png')
    expect(started).toHaveLength(1)
    // Other hosts are not held back.
    cache.remember('https://other.example.org/', 'https://other.example.org/i.png')
    expect(started).toHaveLength(2)
    now += 31_000
    cache.remember('https://spin.example.org/page', 'https://spin.example.org/icon-much-later.png')
    expect(started).toHaveLength(3)
    for (const release of releases) release()
  })

  it('keeps only the most recently used hosts, and saves them atomically', async () => {
    const seeded: Record<string, { data: string | null; at: number }> = {}
    for (let i = 0; i < MAX_ICON_HOSTS + 50; i += 1) seeded[`h${i}.example.org`] = { data: 'data:image/png;base64,AA==', at: 1 }
    writeFileSync(file, JSON.stringify(seeded))
    vi.useFakeTimers()
    const cache = new FaviconCache(file, (async () => png()) as unknown as typeof fetch)
    // The oldest 50 were dropped on load; reading h50 marks it recently used.
    expect(await cache.get(['h50.example.org'])).toEqual({ 'h50.example.org': 'data:image/png;base64,AA==' })
    cache.remember('https://new.example.org/', 'https://new.example.org/i.png')
    await vi.runAllTimersAsync()
    vi.useRealTimers()
    await pendingWrite(file)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(Object.keys(saved)).toHaveLength(MAX_ICON_HOSTS)
    expect(saved['h50.example.org']).toBeDefined()
    expect(saved['new.example.org']).toBeDefined()
    // The least recently used one made room for the new host.
    expect(saved['h51.example.org']).toBeUndefined()
  })

  it('forgets the icons kept since history was deleted, on disk at once, and a fetch already begun does not bring one back', async () => {
    let now = 5_000_000
    const releases: Array<() => void> = []
    let held = false
    const fetchImpl = (() => (held ? new Promise<Response>((resolve) => releases.push(() => resolve(png()))) : Promise.resolve(png()))) as unknown as typeof fetch
    writeFileSync(file, JSON.stringify({ 'old.example.org': { data: 'data:image/png;base64,AA==', at: 1_000 } }))
    const cache = new FaviconCache(file, fetchImpl, () => now)
    cache.remember('https://visited.example.org/a', 'https://visited.example.org/icon.png')
    await flush()
    await flush()
    expect(Object.keys(await cache.get(['visited.example.org', 'old.example.org'])).sort()).toEqual(['old.example.org', 'visited.example.org'])
    // A visit whose icon is still on its way when history is deleted.
    held = true
    now += 60_000
    cache.remember('https://slow.example.org/', 'https://slow.example.org/icon.png')
    // History of the last hour is deleted: the icon kept in that hour goes, the older one stays.
    await cache.forgetSince(now - 3_600_000)
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)).toEqual(['old.example.org'])
    for (const release of releases) release()
    await flush()
    await flush()
    held = false
    expect(Object.keys(await cache.get(['old.example.org']))).toEqual(['old.example.org'])
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(3_000)
    vi.useRealTimers()
    await pendingWrite(file)
    const kept = readFileSync(file, 'utf8')
    expect(kept).not.toContain('visited.example.org')
    expect(kept).not.toContain('slow.example.org')
    // All history deleted: nothing is left.
    await cache.forgetSince(0)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({})
  })

  it('forgets the icons of sites added to the sites to leave out', async () => {
    writeFileSync(file, JSON.stringify({ 'www.bank.com': { data: 'data:image/png;base64,AA==', at: 1 }, 'news.example.org': { data: 'data:image/png;base64,AA==', at: 1 } }))
    const cache = new FaviconCache(file, (async () => png()) as unknown as typeof fetch)
    await cache.forgetHosts((host) => host.replace(/^www\./, '') === 'bank.com')
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)).toEqual(['news.example.org'])
  })
})

describe('icon addresses', () => {
  it('refuses this Mac and local networks, allows public hosts', async () => {
    const { publicIconUrl } = await import('./faviconCache')
    expect(publicIconUrl('https://example.com/favicon.ico')).toBe(true)
    expect(publicIconUrl('http://8.8.8.8/x.png')).toBe(true)
    for (const url of ['http://localhost/x', 'http://127.0.0.1/x', 'http://192.168.1.1/x', 'http://[::1]/x', 'http://router.local/x', 'http://intranet/x', 'file:///etc/x', 'data:image/png;base64,AA']) expect(publicIconUrl(url)).toBe(false)
  })
})
