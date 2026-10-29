import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RegistryRequest, RegistryResponse } from './registry.ts'

export const MAX_REGISTRY_BODY_BYTES = 16_384

type RegistryHandler = { handle(request: RegistryRequest): Promise<RegistryResponse> }
type BodyRead = { ok: true; value: unknown } | { ok: false; response: RegistryResponse }

function json(response: ServerResponse, result: RegistryResponse): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(result.status, { 'content-type': 'application/json', ...(result.headers ?? {}) })
  response.end(JSON.stringify(result.body))
}

function readJsonBody(request: IncomingMessage, response: ServerResponse): Promise<BodyRead> {
  const declaredLength = request.headers['content-length']
  if (typeof declaredLength === 'string' && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_REGISTRY_BODY_BYTES) {
    request.resume()
    json(response, { status: 413, body: { error: 'Request body exceeds 16384 bytes.' } })
    return Promise.resolve({ ok: false, response: { status: 413, body: null } })
  }

  return new Promise((resolve) => {
    let size = 0
    let finished = false
    const chunks: Buffer[] = []
    const finish = (result: BodyRead): void => {
      if (finished) return
      finished = true
      request.removeAllListeners('data')
      resolve(result)
    }
    const rejectBody = (status: 400 | 413, error: string): void => {
      if (finished) return
      json(response, { status, body: { error } })
      request.resume()
      finish({ ok: false, response: { status, body: null } })
    }

    request.on('data', (chunk: Buffer | string) => {
      if (finished) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      if (size > MAX_REGISTRY_BODY_BYTES) {
        rejectBody(413, 'Request body exceeds 16384 bytes.')
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => {
      if (finished) return
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
        finish({ ok: true, value: text ? JSON.parse(text) as unknown : null })
      } catch (error) {
        const invalidUtf8 = error instanceof TypeError && /encoded data/i.test(error.message)
        rejectBody(400, invalidUtf8 ? 'Body must be UTF-8 JSON.' : 'Body must be JSON.')
      }
    })
    request.on('error', () => rejectBody(400, 'Unable to read request body.'))
  })
}

/** A dependency-free Node HTTP boundary with a byte cap and direct-peer IP handling. */
export function createRegistryHttpHandler(registry: RegistryHandler) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      const body = await readJsonBody(request, response)
      if (!body.ok) return
      let address: URL
      try {
        address = new URL(request.url ?? '/', 'http://registry')
      } catch {
        json(response, { status: 400, body: { error: 'Invalid request URL.' } })
        return
      }
      const ip = request.socket.remoteAddress
      const result = await registry.handle({
        method: request.method ?? 'GET',
        path: address.pathname,
        query: address.searchParams,
        body: body.value,
        ...(ip ? { ip } : {}),
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
      })
      json(response, result)
    })().catch(() => {
      if (!response.destroyed && !response.writableEnded && !response.headersSent) {
        json(response, { status: 500, body: { error: 'The registry hit an error.' } })
      } else if (!response.destroyed && !response.writableEnded) response.destroy()
    })
  }
}
