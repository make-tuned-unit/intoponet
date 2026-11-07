import { describe, expect, it } from 'vitest'
import type { PageLoadError, SplitPanelSnapshot, SplitSideSnapshot } from '@intoponet/browser-api'
import { fixedOrigin, shellDrawnSide, sideSecurity } from './SplitPages'

describe('shellDrawnSide', () => {
  const rect = { x: 0, y: 0, width: 400, height: 600 }
  const page = (id: string, extra: Partial<SplitSideSnapshot> = {}): SplitSideSnapshot => ({ id, url: `https://${id}.example/`, title: id, secure: true, ...extra })
  const pair = (left: SplitSideSnapshot, right: SplitSideSnapshot, focused: 'left' | 'right'): SplitPanelSnapshot => ({
    left, right, focused, ratio: 0.5, divider: rect, headers: { left: rect, right: rect }, sides: { left: rect, right: rect },
  })
  const failed: PageLoadError = { kind: 'refused', title: 'This site refused to connect', detail: '', url: 'http://127.0.0.1:9/', host: '127.0.0.1:9', code: -102, codeName: 'ERR_CONNECTION_REFUSED', autoRetry: false }

  it('is the side not in focus when its page failed or it is a start page', () => {
    expect(shellDrawnSide(pair(page('a', { loadError: failed }), page('b'), 'right'))).toEqual({ side: 'left', tab: page('a', { loadError: failed }) })
    expect(shellDrawnSide(pair(page('a'), page('b', { url: '', secure: false, isStartPage: true }), 'left'))?.side).toBe('right')
  })

  it('is nothing when the other side shows its page, or the failing side is the focused one', () => {
    expect(shellDrawnSide(undefined)).toBeNull()
    expect(shellDrawnSide(pair(page('a'), page('b'), 'left'))).toBeNull()
    // The focused side's own error or start page is drawn by the focused-page frame, not this one.
    expect(shellDrawnSide(pair(page('a', { loadError: failed }), page('b'), 'left'))).toBeNull()
    expect(shellDrawnSide(pair(page('a'), page('b', { isStartPage: true }), 'right'))).toBeNull()
  })
})

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
