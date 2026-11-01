import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleDownload, isHumanDownload, composeEmail, countryName } from './_download-notify.js'

const release = { version: '0.1.2', dmg: 'https://blob.example/releases/0.1.2/Intoponet-0.1.2-arm64.dmg' }
const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const req = (headers = {}, method = 'GET') => new Request('https://intoponet.com/download/mac', { method, headers })
const env = { RESEND_API_KEY: 're_test', DOWNLOAD_NOTIFY_TO: 'owner@example.org', DOWNLOAD_NOTIFY_FROM: 'Intoponet <downloads@example.org>' }

test('redirects to the DMG and emails version, time and country only', async () => {
  const sent = []; const pending = []
  const response = handleDownload(req({ 'user-agent': safari, 'x-vercel-ip-country': 'CA', 'x-real-ip': '203.0.113.9' }), {
    release, env, now: () => new Date('2026-10-30T23:15:00Z'), waitUntil: (p) => pending.push(p),
    fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return new Response('{}', { status: 200 }) },
  })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), release.dmg)
  await Promise.all(pending)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, 'https://api.resend.com/emails')
  assert.equal(sent[0].auth, 'Bearer re_test')
  assert.deepEqual(sent[0].body.to, ['owner@example.org'])
  assert.match(sent[0].body.subject, /0\.1\.2 downloaded from Canada/)
  assert.match(sent[0].body.text, /Oct 30, 2026/)
  assert.doesNotMatch(JSON.stringify(sent[0].body), /203\.0\.113\.9|Safari|Mozilla/)
})

test('does not count bots, link previews, prefetches or HEAD requests', () => {
  assert.equal(isHumanDownload(req({ 'user-agent': 'Slackbot-LinkExpanding 1.0' })), false)
  assert.equal(isHumanDownload(req({ 'user-agent': 'curl/8.7.1' })), false)
  assert.equal(isHumanDownload(req({ 'user-agent': safari, 'sec-purpose': 'prefetch' })), false)
  assert.equal(isHumanDownload(req({ 'user-agent': safari }, 'HEAD')), false)
  assert.equal(isHumanDownload(req({})), false)
  assert.equal(isHumanDownload(req({ 'user-agent': safari })), true)
})

test('still redirects when email is unconfigured or fails', async () => {
  let called = 0; const pending = []
  const failing = handleDownload(req({ 'user-agent': safari }), { release, env, waitUntil: (p) => pending.push(p), fetchImpl: async () => { called++; throw new Error('network down') } })
  assert.equal(failing.status, 302)
  await Promise.all(pending)
  assert.equal(called, 1)
  const unconfigured = handleDownload(req({ 'user-agent': safari }), { release, env: {}, waitUntil: (p) => pending.push(p), fetchImpl: async () => { throw new Error('should not be called') } })
  assert.equal(unconfigured.headers.get('location'), release.dmg)
})

test('formats country and time plainly', () => {
  assert.equal(countryName('PS'), 'Palestinian Territories')
  assert.equal(countryName('xx'), null)
  assert.match(composeEmail({ version: '0.1.2', when: new Date('2026-10-30T23:15:00Z'), country: null, timeZone: 'America/Halifax' }).subject, /^Intoponet 0\.1\.2 downloaded$/)
})

test('reports the reason Resend gives when a send is rejected', async () => {
  const { sendNotification } = await import('./_download-notify.js')
  const result = await sendNotification(env, { subject: 's', text: 't' }, async () => new Response(JSON.stringify({ name: 'validation_error', message: 'You can only send testing emails to your own email address.' }), { status: 403 }))
  assert.equal(result.sent, false)
  assert.match(result.reason, /^resend-403 validation_error: You can only send testing emails/)
  assert.doesNotMatch(result.reason, /re_test|owner@example/)
})

test('tolerates spaces and quotes in the recipient setting, and rejects malformed ones locally', async () => {
  const { sendNotification } = await import('./_download-notify.js')
  const sent = []
  const ok = await sendNotification({ RESEND_API_KEY: ' re_test\n', DOWNLOAD_NOTIFY_TO: ' "owner@example.org" , second@example.org\n' }, { subject: 's', text: 't' }, async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}') })
  assert.equal(ok.sent, true)
  assert.deepEqual(sent[0].to, ['owner@example.org', 'second@example.org'])
  const bad = await sendNotification({ RESEND_API_KEY: 're_test', DOWNLOAD_NOTIFY_TO: 'not an address' }, { subject: 's', text: 't' }, async () => { throw new Error('should not send') })
  assert.deepEqual(bad, { sent: false, reason: 'invalid-recipient' })
})

test('records each download in analytics: version, country and bot flag, no IP or user agent', async () => {
  const sent = []; const pending = []
  const analyticsEnv = { ...env, BEACON_REGISTRY_ORIGIN: 'https://registry.example', BEACON_EDGE_SECRET: 's'.repeat(32), PERMAGENT_ANALYTICS_SALT: 'salt' }
  const fetchImpl = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{}', { status: 202 }) }
  handleDownload(req({ 'user-agent': safari, 'x-vercel-ip-country': 'CA', 'x-real-ip': '203.0.113.9' }), { release, env: analyticsEnv, waitUntil: (p) => pending.push(p), fetchImpl })
  handleDownload(req({ 'user-agent': 'curl/8.7.1' }), { release, env: analyticsEnv, waitUntil: (p) => pending.push(p), fetchImpl })
  handleDownload(req({ 'user-agent': safari }, 'HEAD'), { release, env: analyticsEnv, waitUntil: (p) => pending.push(p), fetchImpl })
  await Promise.all(pending)
  const events = sent.filter((call) => call.url === 'https://registry.example/v1/analytics/events').map((call) => call.body)
  assert.equal(events.length, 2)
  assert.deepEqual({ kind: events[0].kind, name: events[0].name, path: events[0].path, country: events[0].country, isBot: events[0].isBot, properties: events[0].properties },
    { kind: 'event', name: 'download', path: '/download/mac', country: 'CA', isBot: false, properties: { version: '0.1.2', platform: 'macos', arch: 'arm64' } })
  assert.equal(events[0].visitorHash.length, 32)
  assert.equal(events[1].isBot, true)
  assert.doesNotMatch(JSON.stringify(events), /203\.0\.113\.9|Safari|curl/)
  // The owner's email still goes out once, for the person only.
  assert.equal(sent.filter((call) => call.url === 'https://api.resend.com/emails').length, 1)
})
