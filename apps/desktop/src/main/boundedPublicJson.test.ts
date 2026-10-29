import { describe, expect, it, vi } from 'vitest'
import { readBoundedPublicJson } from './boundedPublicJson'

describe('bounded public JSON responses', () => {
  it('preserves UTF-8 split across network chunks at the exact byte limit', async () => {
    const bytes = new TextEncoder().encode('{"place":"Montréal"}')
    const split = bytes.indexOf(0xc3) + 1
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, split))
      controller.enqueue(bytes.slice(split))
      controller.close()
    } }))
    await expect(readBoundedPublicJson(response, bytes.length)).resolves.toEqual({ place: 'Montréal' })
  })

  it.each([null, '1'])('rejects streamed overflow with length %s and cancels the body', async (length) => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(33)) }, cancel,
    }), { headers: length === null ? {} : { 'content-length': length } })
    await expect(readBoundedPublicJson(response, 32)).rejects.toThrow('byte limit')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels an oversized declared body without consuming it', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '33' } })
    await expect(readBoundedPublicJson(response, 32)).rejects.toThrow('byte limit')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects invalid UTF-8 rather than silently replacing source text', async () => {
    await expect(readBoundedPublicJson(new Response(new Uint8Array([34, 0xff, 34])))).rejects.toThrow()
  })

  it('propagates a body abort without parsing partial JSON', async () => {
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'))
      controller.error(new Error('request aborted'))
    } }))
    await expect(readBoundedPublicJson(response)).rejects.toThrow('request aborted')
  })
})
