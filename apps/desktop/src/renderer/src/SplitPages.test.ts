import { describe, expect, it } from 'vitest'
import { fixedOrigin, sideSecurity } from './SplitPages'

describe('sideSecurity', () => {
  it('calls https secure and plain http not secure', () => {
    expect(sideSecurity({ url: 'https://example.org/a', secure: true })).toBe('secure')
    expect(sideSecurity({ url: 'http://example.org/a', secure: false })).toBe('not-secure')
    expect(sideSecurity({ url: 'HTTP://example.org/a', secure: false })).toBe('not-secure')
  })

  it('says nothing about a new tab or a page that is not on the web', () => {
    expect(sideSecurity({ url: '', secure: false })).toBe('none')
    expect(sideSecurity({ url: 'about:blank', secure: false })).toBe('none')
    expect(sideSecurity({ url: 'file:///Users/me/report.pdf', secure: false })).toBe('none')
  })
})

describe('fixedOrigin', () => {
  it('is the window corner when the frame lands where it was placed', () => {
    expect(fixedOrigin({ x: 757, y: 161 }, { x: 757, y: 161 })).toEqual({ x: 0, y: 0 })
  })

  it('is the transformed panel corner when the frame lands offset by it', () => {
    // Placed at the side's window rect, it lands that far from the panel's corner instead.
    expect(fixedOrigin({ x: 852, y: 244 }, { x: 757, y: 161 })).toEqual({ x: 95, y: 83 })
    // Placed again from that corner, it lands on the rect: the origin it measures is the same.
    expect(fixedOrigin({ x: 757, y: 161 }, { x: 757 - 95, y: 161 - 83 })).toEqual({ x: 95, y: 83 })
  })

  it('rounds sub-pixel boxes', () => {
    expect(fixedOrigin({ x: 95.4, y: 82.6 }, { x: 0, y: 0 })).toEqual({ x: 95, y: 83 })
  })
})
