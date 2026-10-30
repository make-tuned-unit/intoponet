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
