import { describe, expect, it } from 'vitest'
import { cleanAddress } from './cleanAddress'

describe('cleanAddress', () => {
  it('removes tracking parameters and keeps the rest', () => {
    expect(cleanAddress('https://example.com/a?id=3&utm_source=x&utm_medium=y#part')).toBe('https://example.com/a?id=3#part')
    expect(cleanAddress('https://example.com/a?fbclid=abc')).toBe('https://example.com/a')
    expect(cleanAddress('https://example.com/a?gclid=1&q=two%20words')).toBe('https://example.com/a?q=two+words')
  })

  it('leaves clean and non-web addresses alone', () => {
    expect(cleanAddress('https://example.com/a?id=3&page=2')).toBe('https://example.com/a?id=3&page=2')
    expect(cleanAddress('https://example.com/a?q=%7Bx%7D')).toBe('https://example.com/a?q=%7Bx%7D')
    expect(cleanAddress('file:///Users/me/a.pdf?utm_source=x')).toBe('file:///Users/me/a.pdf?utm_source=x')
    expect(cleanAddress('not a url')).toBe('not a url')
  })
})
