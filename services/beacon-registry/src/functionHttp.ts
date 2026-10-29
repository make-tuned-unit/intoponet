export const MAX_REGISTRY_BODY_BYTES = 16_384

export type LimitedJsonBody =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: string }

/** Reads a Web Request body incrementally and stops retaining bytes at the cap. */
export async function readLimitedJsonBody(request: Request): Promise<LimitedJsonBody> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_REGISTRY_BODY_BYTES) {
    void request.body?.cancel().catch(() => undefined)
    return { ok: false, status: 413, error: `Request body exceeds ${MAX_REGISTRY_BODY_BYTES} bytes.` }
  }
  if (!request.body) return { ok: true, body: null }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_REGISTRY_BODY_BYTES) {
        void reader.cancel().catch(() => undefined)
        return { ok: false, status: 413, error: `Request body exceeds ${MAX_REGISTRY_BODY_BYTES} bytes.` }
      }
      chunks.push(next.value)
    }
  } catch {
    return { ok: false, status: 400, error: 'Unable to read request body.' }
  } finally {
    try { reader.releaseLock() } catch { /* cancelled or errored stream */ }
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { ok: true, body: text ? JSON.parse(text) as unknown : null }
  } catch (error) {
    const invalidUtf8 = error instanceof TypeError && /encoded data/i.test(error.message)
    return { ok: false, status: 400, error: invalidUtf8 ? 'Body must be UTF-8 JSON.' : 'Body must be JSON.' }
  }
}
