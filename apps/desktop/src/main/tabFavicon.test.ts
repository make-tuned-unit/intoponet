import { describe, expect, it, vi } from 'vitest'
import { fetchTabIcon, inlineTabIcon, TAB_ICON_MAX_DATA_URL, TabIconMemory } from './tabFavicon'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

describe('tab icons', () => {
  it('passes small data: icons through and drops large ones', () => {
    expect(inlineTabIcon('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(inlineTabIcon(`data:image/png;base64,${'A'.repeat(TAB_ICON_MAX_DATA_URL)}`)).toBe('')
    expect(inlineTabIcon('https://example.com/favicon.ico')).toBeNull()
  })

  it('converts a public icon to a data: URL through the given fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response(PNG, { headers: { 'content-type': 'image/png' } }))
    const data = await fetchTabIcon('https://example.com/favicon.png', fetchImpl)
    expect(data).toMatch(/^data:image\/png;base64,/)
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/favicon.png', expect.objectContaining({ credentials: 'omit' }))
  })

  it('never fetches local, private or non-http addresses', async () => {
    const fetchImpl = vi.fn(async () => new Response(PNG))
    for (const url of ['http://127.0.0.1/x.png', 'http://192.168.1.1/x.png', 'http://localhost/x.png', 'http://router.local/x.png', 'file:///etc/hosts', 'chrome://favicon/x']) {
      expect(await fetchTabIcon(url, fetchImpl)).toBe('')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a redirect to a private address, a non-image and an oversized body', async () => {
    const redirected = Object.assign(new Response(PNG, { headers: { 'content-type': 'image/png' } }), {})
    Object.defineProperty(redirected, 'url', { value: 'http://10.0.0.1/x.png' })
    expect(await fetchTabIcon('https://example.com/x.png', async () => redirected)).toBe('')
    expect(await fetchTabIcon('https://example.com/x', async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }))).toBe('')
    expect(await fetchTabIcon('https://example.com/x.png', async () => new Response(new Uint8Array(70 * 1024), { headers: { 'content-type': 'image/png' } }))).toBe('')
  })

  it('remembers a few icons per tab', () => {
    const memory = new TabIconMemory(2)
    memory.set('a', '1')
    memory.set('b', '2')
    memory.set('c', '3')
    expect(memory.get('a')).toBeUndefined()
    expect(memory.get('c')).toBe('3')
  })
})
