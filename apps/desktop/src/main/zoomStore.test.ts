import { describe, expect, it, vi } from 'vitest'
import { stepZoom, ZoomStore, zoomSite } from './zoomStore'

const memory = (initial: string | null = null) => {
  const io = { data: initial, writes: 0, read: () => io.data, write: async (data: string) => { io.data = data; io.writes += 1 } }
  return io
}

describe('zoom steps', () => {
  it('moves through the usual browser steps and stops at the ends', () => {
    expect(stepZoom(1, 'in')).toBe(1.1)
    expect(stepZoom(1.1, 'in')).toBe(1.25)
    expect(stepZoom(1, 'out')).toBe(0.9)
    expect(stepZoom(0.9, 'out')).toBe(0.8)
    expect(stepZoom(3, 'in')).toBe(3)
    expect(stepZoom(0.5, 'out')).toBe(0.5)
    // Between steps: the nearest step that way.
    expect(stepZoom(1.2, 'in')).toBe(1.25)
    expect(stepZoom(1.2, 'out')).toBe(1.1)
    expect(stepZoom(Number.NaN, 'in')).toBe(1.1)
  })

  it('names the site by host, without www', () => {
    expect(zoomSite('https://www.Example.com/path?q=1')).toBe('example.com')
    expect(zoomSite('http://news.example.com/')).toBe('news.example.com')
    expect(zoomSite('file:///tmp/a.html')).toBeNull()
    expect(zoomSite('not a url')).toBeNull()
  })
})

describe('per-site zoom', () => {
  it('remembers a site, forgets it at 100%, and saves once after changes settle', async () => {
    vi.useFakeTimers()
    try {
      const io = memory()
      const store = new ZoomStore(io, 400)
      expect(store.get('https://example.com/')).toBe(1)
      expect(store.set('https://example.com/a', 1.25)).toBe(true)
      expect(store.set('https://www.example.com/b', 1.5)).toBe(true)
      expect(store.get('https://example.com/other')).toBe(1.5)
      expect(io.writes).toBe(0)
      await vi.advanceTimersByTimeAsync(450)
      expect(io.writes).toBe(1)
      expect(JSON.parse(io.data!)).toEqual({ version: 1, sites: { 'example.com': 1.5 } })
      expect(store.set('https://example.com/', 1)).toBe(true)
      expect(store.set('https://example.com/', 1)).toBe(false)
      await vi.advanceTimersByTimeAsync(450)
      expect(JSON.parse(io.data!)).toEqual({ version: 1, sites: {} })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads what it saved, and survives a damaged or hostile file', () => {
    expect(new ZoomStore(memory(JSON.stringify({ version: 1, sites: { 'example.com': 2 } }))).get('https://example.com/')).toBe(2)
    expect(new ZoomStore(memory('{not json')).get('https://example.com/')).toBe(1)
    const hostile = new ZoomStore(memory(JSON.stringify({ version: 1, sites: { 'a.com': 99, 'b.com': 'big', 'c.com': 0.75, 'd.com': 1 } })))
    expect(hostile.get('https://a.com/')).toBe(1)
    expect(hostile.get('https://b.com/')).toBe(1)
    expect(hostile.get('https://c.com/')).toBe(0.75)
    expect(hostile.size).toBe(1)
    expect(new ZoomStore({ read: () => { throw new Error('unreadable') }, write: async () => undefined }).size).toBe(0)
  })

  it('refuses factors outside the zoom range and non-web pages', () => {
    const store = new ZoomStore(memory())
    expect(store.set('https://example.com/', 7)).toBe(false)
    expect(store.set('file:///x.html', 1.5)).toBe(false)
    expect(store.size).toBe(0)
  })

  it('writes a waiting save at once when flushed (quitting)', async () => {
    const io = memory()
    const store = new ZoomStore(io, 60_000)
    store.set('https://example.com/', 1.1)
    await store.flush()
    expect(io.writes).toBe(1)
    await store.flush()
    expect(io.writes).toBe(1)
  })
})
