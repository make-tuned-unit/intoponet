import { describe, expect, it } from 'vitest'
import { beaconCell, canonicalBeaconUrl, canonicalJson, cellScore, prominence, publicCount, validateBeacon } from './index.ts'

describe('beacon payload', () => {
  it('strips tracking, fragments and refuses private or sensitive addresses', () => {
    expect(canonicalBeaconUrl('https://News.example.com/a?id=4&utm_source=x&fbclid=y#top')).toBe('https://news.example.com/a?id=4')
    expect(canonicalBeaconUrl('http://localhost:3000/x')).toBeNull()
    expect(canonicalBeaconUrl('http://192.168.1.4/')).toBeNull()
    expect(canonicalBeaconUrl('https://user:pw@example.com/')).toBeNull()
    expect(canonicalBeaconUrl('https://bank.example.com/account/x')).toBeNull()
    expect(canonicalBeaconUrl('file:///etc/hosts')).toBeNull()
  })
  it('keeps only allowed fields and rounds places', () => {
    const result = validateBeacon({ url: 'https://a.test/x?utm_medium=m', title: '  Title\n', topic: 'Water', note: 'Worth reading', place: { label: 'Suva', lat: -18.1416, lon: 178.4419 } })
    expect(result).toEqual({ ok: true, payload: { url: 'https://a.test/x', title: 'Title', topic: 'Water', note: 'Worth reading', place: { label: 'Suva', lat: -18.1, lon: 178.4 } } })
    expect(validateBeacon({ url: 'https://a.test', title: 'T', topic: 'X', history: [] })).toEqual({ ok: false, reason: 'Unexpected fields: history.' })
    expect(validateBeacon({ url: 'https://a.test', title: '', topic: 'X' }).ok).toBe(false)
  })
  it('places beacons in 2° cells', () => {
    expect(beaconCell(undefined)).toBe('global')
    expect(beaconCell({ label: 'a', lat: -18.1, lon: 178.4 })).toBe(beaconCell({ label: 'b', lat: -18.9, lon: 179.9 }))
    expect(beaconCell({ label: 'a', lat: 0, lon: -180 })).toBe(beaconCell({ label: 'a', lat: 0, lon: 180 }))
  })
})

describe('prominence', () => {
  it('has diminishing returns, a per-cell cap, and rewards breadth over volume', () => {
    expect(cellScore(1)).toBe(1)
    expect(cellScore(3)).toBe(2)
    expect(cellScore(1000)).toBe(4)
    expect(prominence({ a: 100 })).toBe(4)
    expect(prominence({ a: 1, b: 1, c: 1, d: 1, e: 1 })).toBe(5)
    expect(publicCount(2)).toBe('a few')
  })
  it('signs identical bytes regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}')
  })
})
