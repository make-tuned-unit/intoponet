/** Cap decoded response bytes even when Content-Length is absent or inaccurate. */
export const MAX_PUBLIC_JSON_BYTES = 5 * 1024 * 1024

export async function readBoundedPublicJson(response: Response, maxBytes = MAX_PUBLIC_JSON_BYTES): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid public JSON byte limit.')
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Public JSON response exceeds the byte limit.')
  }
  if (!response.body) throw new Error('Public JSON response has no body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('Public JSON response exceeds the byte limit.')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
}
