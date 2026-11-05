import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanProperties, collect, drain, eventFromBeacon, isBotAgent, splitPath, visitorHash } from './_permagent.js'

const env = { BEACON_REGISTRY_ORIGIN: 'https://registry.example', BEACON_EDGE_SECRET: 's'.repeat(32), PERMAGENT_ANALYTICS_SALT: 'salt', PERMAGENT_ANALYTICS_KEY: 'k'.repeat(64) }
const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const recorder = (status = 202, body = null) => {
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return new Response(body, { status }) }
  return { calls, fetchImpl }
}
const beacon = (body, headers = {}) => new Request('https://intoponet.com/api/permagent-analytics/collect', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': chrome, 'accept-language': 'en-CA', 'x-vercel-ip-country': 'CA', 'x-real-ip': '203.0.113.4', ...headers },
})

test('a sendBeacon text/plain body becomes one clean event, with no IP or user agent', async () => {
  const { calls, fetchImpl } = recorder()
  const response = await collect(beacon({ k: 'pv', p: '/download?utm_source=news&utm_medium=email&email=a@b.c&gclid=x', r: 'https://news.example/', n: null, d: null, s: 'sess1' }), env, fetchImpl)
  assert.equal(response.status, 202)
  assert.equal(await response.text(), '')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://registry.example/v1/analytics/events')
  assert.equal(calls[0].init.headers['x-intoponet-edge'], env.BEACON_EDGE_SECRET)
  const sent = JSON.parse(calls[0].init.body)
  assert.deepEqual({ kind: sent.kind, path: sent.path, utmSource: sent.utmSource, utmMedium: sent.utmMedium, sessionId: sent.sessionId, country: sent.country, isBot: sent.isBot }, { kind: 'pageview', path: '/download', utmSource: 'news', utmMedium: 'email', sessionId: 'sess1', country: 'CA', isBot: false })
  assert.equal(sent.visitorHash.length, 32)
  assert.ok(!calls[0].init.body.includes('203.0.113.4') && !calls[0].init.body.includes('Chrome') && !calls[0].init.body.includes('a@b.c'))
})

test('malformed bodies and an unconfigured store still answer 202', async () => {
  const { calls, fetchImpl } = recorder()
  assert.equal((await collect(beacon('not json'), env, fetchImpl)).status, 202)
  assert.equal((await collect(beacon({ k: 'zz', p: '/' }), env, fetchImpl)).status, 202)
  assert.equal((await collect(beacon({ k: 'pv', p: '/' }), {}, fetchImpl)).status, 202)
  assert.equal(calls.length, 0)
  const failing = async () => { throw new Error('down') }
  assert.equal((await collect(beacon({ k: 'pv', p: '/' }), env, failing)).status, 202)
})

test('bots: from the user agent, a missing agent, or b: 1 regardless of agent', () => {
  const headers = (ua) => new Headers(ua ? { 'user-agent': ua } : {})
  assert.equal(eventFromBeacon(JSON.stringify({ k: 'pv', p: '/' }), headers(chrome), env).isBot, false)
  assert.equal(eventFromBeacon(JSON.stringify({ k: 'pv', p: '/', b: 1 }), headers(chrome), env).isBot, true)
  assert.equal(eventFromBeacon(JSON.stringify({ k: 'pv', p: '/', b: '1' }), headers(chrome), env).isBot, false)
  assert.equal(eventFromBeacon(JSON.stringify({ k: 'pv', p: '/' }), headers(null), env).isBot, true)
  for (const ua of ['Googlebot/2.1', 'curl/8.4.0', 'python-requests/2.31', 'facebookexternalhit/1.1', 'Mozilla/5.0 HeadlessChrome/120']) assert.equal(isBotAgent(ua), true, ua)
})

test('properties: flat scalars only, truncated rather than rejected', () => {
  assert.deepEqual(cleanProperties({ store: 'sobeys', price: 4.99, ok: true, nested: { a: 1 }, list: [1], nan: NaN }), { store: 'sobeys', price: 4.99, ok: true })
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 'v'.repeat(300)]))
  const cleaned = cleanProperties(many)
  assert.ok(Object.keys(cleaned).length <= 32)
  assert.ok(Object.values(cleaned).every((value) => value.length <= 256))
  assert.ok(JSON.stringify(cleaned).length <= 4096)
  assert.equal(cleanProperties([1, 2]), null)
})

test('path keeps no query; only utm fields are extracted', () => {
  assert.deepEqual(splitPath('/a?token=secret&utm_campaign=launch%20day'), { path: '/a', utmSource: null, utmMedium: null, utmCampaign: 'launch day' })
  assert.equal(splitPath('https://evil.example/x').path, '/')
})

test('the visitor hash is salted and rotates daily', () => {
  const day1 = new Date('2026-10-30T10:00:00Z')
  const day2 = new Date('2026-10-31T10:00:00Z')
  assert.equal(visitorHash('salt', chrome, 'en', day1), visitorHash('salt', chrome, 'en', new Date('2026-10-30T23:59:00Z')))
  assert.notEqual(visitorHash('salt', chrome, 'en', day1), visitorHash('salt', chrome, 'en', day2))
  assert.notEqual(visitorHash('salt', chrome, 'en', day1), visitorHash('other', chrome, 'en', day1))
  assert.equal(visitorHash('', chrome, 'en', day1), null)
})

test('the drain fails closed and forwards the cursor', async () => {
  const request = (key, query = '?since=41&limit=5') => new Request(`https://intoponet.com/api/permagent-analytics/drain${query}`, { headers: key ? { 'x-permagent-key': key } : {} })
  const { calls, fetchImpl } = recorder(200, '{"events":[]}')
  assert.equal((await drain(request(env.PERMAGENT_ANALYTICS_KEY), { ...env, PERMAGENT_ANALYTICS_KEY: '' }, fetchImpl)).status, 401)
  assert.equal((await drain(request('wrong'), env, fetchImpl)).status, 401)
  assert.equal((await drain(request(null), env, fetchImpl)).status, 401)
  assert.equal((await drain(new Request(`https://intoponet.com/api/permagent-analytics/drain?key=${env.PERMAGENT_ANALYTICS_KEY}`), env, fetchImpl)).status, 401)
  assert.equal(calls.length, 0)
  const ok = await drain(request(env.PERMAGENT_ANALYTICS_KEY), env, fetchImpl)
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { events: [] })
  assert.equal(calls[0].url, 'https://registry.example/v1/analytics/events?since=41&limit=5')
  await drain(request(env.PERMAGENT_ANALYTICS_KEY, '?since=0&limit=99999'), env, fetchImpl)
  assert.equal(calls[1].url, 'https://registry.example/v1/analytics/events?since=0&limit=1000')
  assert.equal((await drain(request(env.PERMAGENT_ANALYTICS_KEY, '?since=-1'), env, fetchImpl)).status, 400)
})

test('every page source carries the snippet tag once, in <head>, and the snippet keeps the relative endpoint and version guard', () => {
  const snippet = readFileSync(new URL('../permagent.js', import.meta.url), 'utf8')
  assert.ok(snippet.includes('var E = "/api/permagent-analytics/collect";'))
  assert.ok(snippet.includes('window.permagent.v = 2;'))
  for (const page of ['index.html', 'beacon-policy.html', '404.html', 'ideas.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8')
    assert.equal(html.split('<script src="/permagent.js"></script>').length, 2, page)
    assert.ok(html.indexOf('/permagent.js') < html.indexOf('</head>'), page)
  }
})
