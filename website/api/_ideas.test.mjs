import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleIdea, parseIdea } from './_ideas.js'

const env = { RESEND_API_KEY: 'k', DOWNLOAD_NOTIFY_TO: 'owner@example.com', BEACON_REGISTRY_ORIGIN: 'https://registry.example', BEACON_EDGE_SECRET: 's'.repeat(32), PERMAGENT_ANALYTICS_SALT: 'salt' }
const idea = { area: 'news', idea: 'Show local news for small towns in Nova Scotia', name: 'Sam', email: 'sam@example.com', website: '', elapsedMs: 12_000 }
const post = (body, headers = {}) => new Request('https://intoponet.com/api/ideas', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'https://intoponet.com', 'user-agent': 'Mozilla/5.0', 'x-vercel-ip-country': 'CA', ...headers } })
const recorder = (status = 200) => {
  const calls = []
  return { calls, fetchImpl: async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status }) } }
}

test('an idea is emailed to the owner with the sender as reply-to, and counted without their address', async () => {
  const { calls, fetchImpl } = recorder()
  const pending = []
  const response = await handleIdea(post(idea), { env, fetchImpl, waitUntil: (p) => pending.push(p) })
  await Promise.all(pending)
  assert.equal(response.status, 202)
  const email = calls.find((call) => call.url === 'https://api.resend.com/emails')
  assert.equal(email.body.subject, 'Intoponet idea: Local news from Canada')
  assert.equal(email.body.reply_to, 'sam@example.com')
  assert.match(email.body.text, /small towns in Nova Scotia/)
  const event = calls.find((call) => call.url.endsWith('/v1/analytics/events'))
  assert.equal(event.body.name, 'idea_submitted')
  assert.ok(!JSON.stringify(event.body).includes('sam@example.com'))
})

test('refuses other sites, bots and empty ideas', async () => {
  const { calls, fetchImpl } = recorder()
  assert.equal((await handleIdea(post(idea, { origin: 'https://evil.example' }), { env, fetchImpl })).status, 403)
  assert.equal((await handleIdea(post({ ...idea, website: 'http://spam' }), { env, fetchImpl })).status, 400)
  assert.equal((await handleIdea(post({ ...idea, elapsedMs: 500 }), { env, fetchImpl })).status, 400)
  assert.equal((await handleIdea(post({ ...idea, idea: 'hi' }), { env, fetchImpl })).status, 400)
  assert.equal((await handleIdea(post({ ...idea, email: 'not an email' }), { env, fetchImpl })).status, 400)
  assert.equal(calls.length, 0)
})

test('says so when the idea could not be delivered', async () => {
  const { fetchImpl } = recorder(500)
  const response = await handleIdea(post(idea), { env, fetchImpl })
  assert.equal(response.status, 503)
  assert.match((await response.json()).error, /could not be sent/)
})

test('anonymous ideas are fine, and unknown areas become "something else"', () => {
  assert.deepEqual(parseIdea({ idea: 'A dark map style please', area: 'nope', elapsedMs: 5000 }), { idea: 'A dark map style please', area: 'other', email: null, name: null })
})
