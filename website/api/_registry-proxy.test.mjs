import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proxyRegistry, MAX_BODY_BYTES } from './_registry-proxy.js'

const env = { BEACON_REGISTRY_ORIGIN: 'https://registry.example', BEACON_EDGE_SECRET: 's'.repeat(32) }
const recorder = () => {
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return new Response('{"ok":true}', { status: 201, headers: { 'retry-after': '5', 'set-cookie': 'x=1' } }) }
  return { calls, fetchImpl }
}
const req = (path, init = {}) => new Request(`https://site.example/api/registry?__path=${encodeURIComponent(path)}`, init)

test('forwards allowed writes with the edge secret and the platform client address', async () => {
  const { calls, fetchImpl } = recorder()
  const response = await proxyRegistry(req('v1/beacons', { method: 'POST', body: '{"a":1}', headers: { 'x-real-ip': '203.0.113.9', 'x-intoponet-client-ip': '1.1.1.1', 'x-intoponet-edge': 'forged' } }), env, fetchImpl)
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('retry-after'), '5')
  assert.equal(response.headers.get('set-cookie'), null)
  assert.equal(calls[0].url, 'https://registry.example/v1/beacons')
  assert.equal(calls[0].init.headers.get('x-intoponet-edge'), env.BEACON_EDGE_SECRET)
  assert.equal(calls[0].init.headers.get('x-intoponet-client-ip'), '203.0.113.9')
})

test('keeps read query strings and drops the rewrite parameter', async () => {
  const { calls, fetchImpl } = recorder()
  await proxyRegistry(new Request('https://site.example/api/registry?__path=v1%2Fbeacons&topic=floods&limit=5'), env, fetchImpl)
  assert.equal(calls[0].url, 'https://registry.example/v1/beacons?topic=floods&limit=5')
})

test('refuses admin, unknown and traversal paths without calling the registry', async () => {
  const { calls, fetchImpl } = recorder()
  for (const path of ['v1/admin/queue', 'v1/admin/review', 'internal/purge', 'v1/../v1/admin/queue', 'v2/beacons']) {
    assert.equal((await proxyRegistry(req(path, { method: path.endsWith('review') ? 'POST' : 'GET', ...(path.endsWith('review') ? { body: '{}' } : {}), headers: { 'x-real-ip': '203.0.113.9' } }), env, fetchImpl)).status, 404, path)
  }
  assert.equal(calls.length, 0)
})

test('rejects oversized bodies and refuses to run unconfigured', async () => {
  const { calls, fetchImpl } = recorder()
  const big = 'x'.repeat(MAX_BODY_BYTES + 1)
  assert.equal((await proxyRegistry(req('v1/reports', { method: 'POST', body: big, headers: { 'x-real-ip': '203.0.113.9' } }), env, fetchImpl)).status, 413)
  assert.equal((await proxyRegistry(req('v1/beacons'), { BEACON_REGISTRY_ORIGIN: 'http://insecure.example', BEACON_EDGE_SECRET: env.BEACON_EDGE_SECRET }, fetchImpl)).status, 503)
  assert.equal(calls.length, 0)
})

test('reports an unreachable registry as 502', async () => {
  const response = await proxyRegistry(req('v1/health'), env, async () => { throw new Error('down') })
  assert.equal(response.status, 502)
})
