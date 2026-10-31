import { isIP } from 'node:net'
import { timingSafeEqual } from 'node:crypto'

export const EDGE_SECRET_HEADER = 'x-intoponet-edge'
export const EDGE_CLIENT_HEADER = 'x-intoponet-client-ip'

/**
 * Returns the client address supplied by the edge proxy, but only when the
 * request carries the shared edge secret. Anything else returns undefined, so
 * a caller cannot choose the address its rate limits are counted against.
 */
/** Whether a request carries the shared edge secret (constant-time). */
export function fromEdge(headers: Headers, secret: string): boolean {
  if (secret.length < 32) return false
  const provided = headers.get(EDGE_SECRET_HEADER)
  if (provided === null) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

export function edgeClientAddress(headers: Headers, secret: string): string | undefined {
  if (secret.length < 32) return undefined
  const provided = headers.get(EDGE_SECRET_HEADER)
  if (provided === null) return undefined
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) return undefined
  const address = headers.get(EDGE_CLIENT_HEADER)?.trim() ?? ''
  return isIP(address) ? address : undefined
}
