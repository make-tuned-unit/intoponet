import { describe, expect, it } from 'vitest'
import { edgeClientAddress } from './edge.ts'

const secret = 'e'.repeat(32)
const headers = (values: Record<string, string>) => new Headers(values)

describe('edge client address', () => {
  it('trusts the address only with the exact edge secret', () => {
    expect(edgeClientAddress(headers({ 'x-intoponet-edge': secret, 'x-intoponet-client-ip': '203.0.113.4' }), secret)).toBe('203.0.113.4')
    expect(edgeClientAddress(headers({ 'x-intoponet-edge': secret, 'x-intoponet-client-ip': '2001:db8::1' }), secret)).toBe('2001:db8::1')
    expect(edgeClientAddress(headers({ 'x-intoponet-edge': 'wrong'.padEnd(32, 'x'), 'x-intoponet-client-ip': '203.0.113.4' }), secret)).toBeUndefined()
    expect(edgeClientAddress(headers({ 'x-intoponet-client-ip': '203.0.113.4', 'x-forwarded-for': '203.0.113.4' }), secret)).toBeUndefined()
  })

  it('ignores malformed addresses and an unset or short secret', () => {
    expect(edgeClientAddress(headers({ 'x-intoponet-edge': secret, 'x-intoponet-client-ip': '203.0.113.4, 10.0.0.1' }), secret)).toBeUndefined()
    expect(edgeClientAddress(headers({ 'x-intoponet-edge': '', 'x-intoponet-client-ip': '203.0.113.4' }), '')).toBeUndefined()
    expect(edgeClientAddress(headers({ 'x-intoponet-edge': 'short', 'x-intoponet-client-ip': '203.0.113.4' }), 'short')).toBeUndefined()
  })
})
