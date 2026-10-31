import { describe, expect, it } from 'vitest'
import { createAnalytics, drainParams, parseEvent } from './analytics.ts'
import { fromEdge } from './edge.ts'

describe('analytics events', () => {
  it('keeps only flat scalar properties and known kinds', () => {
    const event = parseEvent({ kind: 'event', path: '/x', name: 'download', properties: { os: 'mac', n: 2, ok: true, nested: { a: 1 }, list: [1] }, isBot: true, country: 'CA' })
    expect(event?.properties).toEqual({ os: 'mac', n: 2, ok: true })
    expect(event?.isBot).toBe(true)
    expect(event?.country).toBe('CA')
    expect(parseEvent({ kind: 'click', path: '/x' })).toBeNull()
    expect(parseEvent({ kind: 'pageview' })).toBeNull()
    expect(parseEvent({ kind: 'pageview', path: '/x', country: 'Canada' })?.country).toBeNull()
  })

  it('reads the drain cursor strictly and caps the limit', () => {
    expect(drainParams(new URLSearchParams(''))).toEqual({ since: 0, limit: 500 })
    expect(drainParams(new URLSearchParams('since=41&limit=5000'))).toEqual({ since: 41, limit: 1000 })
    expect(drainParams(new URLSearchParams('since=-1'))).toBeNull()
    expect(drainParams(new URLSearchParams('since=abc'))).toBeNull()
  })

  it('drains rows after the cursor, oldest first, with the event time', async () => {
    const calls: unknown[][] = []
    const analytics = createAnalytics(async (sql, params) => {
      calls.push([sql, params])
      return [{ id: '42', kind: 'pageview', path: '/', referrer: null, name: null, visitor_hash: 'ab', created_at: new Date('2026-10-30T15:04:05Z'), properties: null, is_bot: false, session_id: 's1', utm_source: 'x', utm_medium: null, utm_campaign: null, country: 'US' }]
    })
    const rows = await analytics.drain(41, 5)
    expect(String(calls[0]![0])).toMatch(/where id > \$1 order by id asc limit \$2/)
    expect(calls[0]![1]).toEqual([41, 5])
    expect(rows[0]).toMatchObject({ id: 42, at: '2026-10-30T15:04:05.000Z', visitorHash: 'ab', sessionId: 's1', utmSource: 'x', country: 'US', isBot: false })
  })

  it('accepts only the exact edge secret', () => {
    const secret = 's'.repeat(32)
    expect(fromEdge(new Headers({ 'x-intoponet-edge': secret }), secret)).toBe(true)
    expect(fromEdge(new Headers({ 'x-intoponet-edge': 'x'.repeat(32) }), secret)).toBe(false)
    expect(fromEdge(new Headers({}), secret)).toBe(false)
    expect(fromEdge(new Headers({ 'x-intoponet-edge': secret }), '')).toBe(false)
  })
})
