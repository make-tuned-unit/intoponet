import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeFeedbackEmail, handleFeedback, parseFeedback } from './_feedback.js'

const env = { RESEND_API_KEY: 'k', DOWNLOAD_NOTIFY_TO: 'owner@example.com', BEACON_REGISTRY_ORIGIN: 'https://registry.example', BEACON_EDGE_SECRET: 's'.repeat(32), PERMAGENT_ANALYTICS_SALT: 'salt' }
const post = (body, headers = {}) => new Request('https://intoponet.com/api/feedback', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-intoponet-app': '0.1.11', 'user-agent': 'Intoponet', 'x-vercel-ip-country': 'CA', ...headers } })
const recorder = () => {
  const calls = []
  return { calls, fetchImpl: async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }) } }
}

test('feedback is emailed to the owner and counted, with nothing identifying', async () => {
  const { calls, fetchImpl } = recorder()
  const pending = []
  const response = await handleFeedback(post({ rating: 4, comment: 'Love the globe\u0007', version: '0.1.11' }), { env, fetchImpl, waitUntil: (p) => pending.push(p), now: () => new Date('2026-11-05T12:00:00Z') })
  await Promise.all(pending)
  assert.equal(response.status, 202)
  const email = calls.find((call) => call.url === 'https://api.resend.com/emails')
  assert.match(email.body.subject, /Intoponet feedback: 4\/5 from Canada/)
  assert.match(email.body.text, /Love the globe\n/)
  const event = calls.find((call) => call.url.endsWith('/v1/analytics/events'))
  assert.equal(event.body.name, 'app_feedback')
  assert.equal(event.body.properties.rating, 4)
})

test('refuses browsers, empty feedback and other methods', async () => {
  const { calls, fetchImpl } = recorder()
  assert.equal((await handleFeedback(post({ rating: 5, version: '0.1.11' }, { origin: 'https://evil.example' }), { env, fetchImpl })).status, 403)
  assert.equal((await handleFeedback(new Request('https://intoponet.com/api/feedback', { method: 'POST', body: '{}' }), { env, fetchImpl })).status, 403)
  assert.equal((await handleFeedback(post({ comment: '  ', version: '0.1.11' }), { env, fetchImpl })).status, 400)
  assert.equal((await handleFeedback(new Request('https://intoponet.com/api/feedback'), { env, fetchImpl })).status, 405)
  assert.equal(calls.length, 0)
})

test('parse keeps a rating or a comment and the version', () => {
  assert.deepEqual(parseFeedback({ rating: 9, comment: 'ok', version: '0.1.11' }), { rating: null, comment: 'ok', version: '0.1.11' })
  assert.equal(parseFeedback({ rating: 3, version: 'x' }), null)
  assert.equal(parseFeedback({ rating: 3, comment: 'a'.repeat(5000), version: '0.1.11' }).comment.length, 2000)
  assert.match(composeFeedbackEmail({ rating: null, comment: 'hi', version: '0.1.11' }, { when: new Date(), country: null, timeZone: 'UTC' }).subject, /^Intoponet feedback$/)
})
