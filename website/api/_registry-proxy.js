// Edge proxy for the Beacon registry. Vercel sets x-real-ip from the TCP
// connection and overwrites any client-supplied value, so it is a trustworthy
// client address here. The registry trusts that address only alongside the
// shared edge secret, which never leaves server environments.

export const MAX_BODY_BYTES = 16_384

const ROUTES = [
  { method: 'GET', pattern: /^\/v1\/(health|beacons|export|transparency)$/ },
  { method: 'POST', pattern: /^\/v1\/beacons$/ },
  { method: 'POST', pattern: /^\/v1\/beacons\/[0-9a-f-]{36}\/withdraw$/ },
  { method: 'POST', pattern: /^\/v1\/reports$/ },
]

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })

/** Maps /registry/<path> (rewritten to ?__path=<path>) onto an allowed registry path. */
export function registryPath(requestUrl) {
  const url = new URL(requestUrl)
  const raw = url.searchParams.get('__path') ?? ''
  url.searchParams.delete('__path')
  const path = `/${raw.replace(/^\/+|\/+$/g, '')}`
  if (path.includes('..') || path.includes('//')) return null
  return { path, search: url.searchParams.toString() }
}

export async function proxyRegistry(request, env = process.env, fetchImpl = fetch) {
  const origin = env.BEACON_REGISTRY_ORIGIN ?? ''
  const secret = env.BEACON_EDGE_SECRET ?? ''
  if (!/^https:\/\/[^/?#]+$/.test(origin) || secret.length < 32) return json(503, { error: 'The registry is not configured.' })

  const target = registryPath(request.url)
  if (!target || !ROUTES.some((route) => route.method === request.method && route.pattern.test(target.path))) {
    return json(404, { error: 'Not found.' })
  }

  const clientIp = request.headers.get('x-real-ip')?.trim()
  if (request.method === 'POST' && !clientIp) return json(400, { error: 'Unable to identify the network for rate limits.' })

  let body
  if (request.method === 'POST') {
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > MAX_BODY_BYTES) return json(413, { error: `Request body exceeds ${MAX_BODY_BYTES} bytes.` })
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.byteLength > MAX_BODY_BYTES) return json(413, { error: `Request body exceeds ${MAX_BODY_BYTES} bytes.` })
    body = bytes
  }

  const upstream = new URL(origin)
  upstream.pathname = target.path
  upstream.search = target.search
  const headers = new Headers({ 'x-intoponet-edge': secret })
  if (clientIp) headers.set('x-intoponet-client-ip', clientIp)
  if (body) headers.set('content-type', 'application/json')

  let response
  try {
    response = await fetchImpl(upstream, { method: request.method, headers, body, redirect: 'manual' })
  } catch {
    return json(502, { error: 'The registry could not be reached.' })
  }
  const passthrough = {}
  for (const name of ['cache-control', 'retry-after']) {
    const value = response.headers.get(name)
    if (value) passthrough[name] = value
  }
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...passthrough },
  })
}
