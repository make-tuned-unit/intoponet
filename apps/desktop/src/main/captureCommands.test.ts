import { describe, expect, it } from 'vitest'
import { parseCaptureCommand, parseCaptureCrop, parseCaptureRecord } from '@intoponet/browser-api'
import { cropToPixels } from './captureService'

const id = '0b6e1a2c-4d5f-4a7b-8c9d-0e1f2a3b4c5d'

describe('capture command validation', () => {
  it('accepts well-formed commands', () => {
    expect(parseCaptureCommand({ type: 'begin' })).toEqual({ type: 'begin' })
    expect(parseCaptureCommand({ type: 'save-image', pendingId: id, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, groupId: null }))
      .toMatchObject({ type: 'save-image', groupId: null })
    expect(parseCaptureCommand({ type: 'update', id, groupId: 'banking', title: '  Statement  ' })).toEqual({ type: 'update', id, groupId: 'banking', title: 'Statement' })
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
    expect(parseCaptureCommand({ type: 'save-video', pendingId: id, bytes, mimeType: 'video/webm;codecs=vp9', durationMs: 3000, groupId: null }))
      .toMatchObject({ type: 'save-video', mimeType: 'video/webm;codecs=vp9' })
  })

  it('rejects path tricks, bad crops, oversize and wrong types', () => {
    expect(() => parseCaptureCommand({ type: 'delete', id: '../index.bin' })).toThrow()
    expect(() => parseCaptureCrop({ x: 0.8, y: 0, width: 0.5, height: 0.5 })).toThrow()
    expect(() => parseCaptureCrop({ x: Number.NaN, y: 0, width: 1, height: 1 })).toThrow()
    expect(() => parseCaptureCommand({ type: 'save-video', pendingId: id, bytes: new Uint8Array(), mimeType: 'video/webm', durationMs: 1, groupId: null })).toThrow()
    expect(() => parseCaptureCommand({ type: 'save-video', pendingId: id, bytes: new Uint8Array([1]), mimeType: 'text/html', durationMs: 1, groupId: null })).toThrow()
    expect(() => parseCaptureCommand({ type: 'save-video', pendingId: id, bytes: 'AAAA', mimeType: 'video/webm', durationMs: 1, groupId: null })).toThrow()
    expect(() => parseCaptureCommand({ type: 'update', id, title: '' })).toThrow()
    expect(() => parseCaptureCommand({ type: 'shell', command: 'rm -rf' })).toThrow()
    expect(() => parseCaptureCommand({ type: 'export', id })).toThrow()
    expect(parseCaptureCommand({ type: 'sync-groups', groups: [{ id: 'a', label: 'A' }] })).toEqual({ type: 'sync-groups', groups: [{ id: 'a', label: 'A' }] })
    expect(() => parseCaptureCommand({ type: 'sync-groups', groups: [{ id: '', label: 'blank' }] })).toThrow()
  })

  it('drops malformed stored records', () => {
    const good = { id, kind: 'image', title: 'A', sourceUrl: 'https://a.example/', createdAt: '2026-10-26T12:00:00.000Z', width: 10, height: 10, byteLength: 5, groupId: null }
    expect(parseCaptureRecord(good)).toEqual(good)
    expect(parseCaptureRecord({ ...good, kind: 'exe' })).toBeNull()
    expect(parseCaptureRecord({ ...good, width: -1 })).toBeNull()
  })
})

describe('capture geometry', () => {
  it('maps normalized crops to clamped device pixels', () => {
    expect(cropToPixels({ x: 0, y: 0, width: 1, height: 1 }, { width: 2672, height: 1262 })).toEqual({ x: 0, y: 0, width: 2672, height: 1262 })
    expect(cropToPixels({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 }, { width: 2000, height: 1000 })).toEqual({ x: 1000, y: 250, width: 1000, height: 500 })
    const edge = cropToPixels({ x: 0.9999, y: 0.9999, width: 0.0001, height: 0.0001 }, { width: 100, height: 100 })
    expect(edge.width).toBeGreaterThanOrEqual(1)
    expect(edge.x + edge.width).toBeLessThanOrEqual(100)
  })

})
