import { recordServerEvent } from './_permagent.js'
import { countryName, sendNotification } from './_download-notify.js'

// POST /api/ideas: an idea from intoponet.com/ideas, emailed to the owner (with the sender's
// address as reply-to when they give one) and counted in analytics. Nothing is published.
// Privacy: the email address, if given, goes only into that email, never into analytics or storage.

export const AREAS = {
  globe: 'The globe and map',
  news: 'Local news',
  olds: 'The Olds',
  browsing: 'Browsing and tabs',
  privacy: 'Privacy and protection',
  beacons: 'Beacons and sharing',
  other: 'Something else',
}
const LIMITS = { idea: 3_000, name: 80 }
const MIN_FILL_MS = 3_000
const EMAIL = /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]{2,}$/
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const clean = (value, max) => (typeof value === 'string' ? value.replace(/[^\P{C}\n\t]/gu, '').trim().slice(0, max) : '')

/** The cleaned idea, or a reason it was refused. */
export function parseIdea(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid' }
  // A hidden field people never see, and a form filled in under three seconds: automated.
  if (clean(body.website, 200) || !(Number(body.elapsedMs) >= MIN_FILL_MS)) return { error: 'automated' }
  const idea = clean(body.idea, LIMITS.idea)
  if (idea.length < 10) return { error: 'too-short' }
  const area = Object.hasOwn(AREAS, body.area) ? body.area : 'other'
  const email = clean(body.email, 200)
  if (email && !EMAIL.test(email)) return { error: 'email' }
  return { idea, area, email: email || null, name: clean(body.name, LIMITS.name) || null }
}

export function composeIdeaEmail({ idea, area, email, name }, { when, country, timeZone }) {
  const time = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(when)
  const where = country ? ` from ${country}` : ''
  const from = [name, email].filter(Boolean).join(' · ')
  return {
    subject: `Intoponet idea: ${AREAS[area]}${where}`,
    text: `${idea}\n\nArea: ${AREAS[area]}\n${from ? `From: ${from} (reply to this email to answer them)` : 'From: anonymous'}\nSent ${time}${where} via intoponet.com/ideas`,
    ...(email ? { replyTo: email } : {}),
  }
}

const MESSAGES = {
  automated: 'That looked automated. Please try again.',
  'too-short': 'Please describe your idea in a sentence or two.',
  email: 'That email address does not look right. Leave it empty if you prefer.',
  invalid: 'Something went wrong. Please try again.',
}

export async function handleIdea(request, { env = process.env, now = () => new Date(), fetchImpl = fetch, waitUntil = (promise) => { promise.catch(() => {}) } } = {}) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  // Only from the site's own page.
  const origin = request.headers.get('origin')
  let sameSite = false
  try { sameSite = !!origin && new URL(origin).host === new URL(request.url).host } catch { sameSite = false }
  if (!sameSite) return json(403, { error: 'Forbidden.' })
  if (Number(request.headers.get('content-length') ?? 0) > 16_384) return json(413, { error: 'That is too long.' })
  let body
  try { body = JSON.parse((await request.text()).slice(0, 16_384)) } catch { return json(400, { error: MESSAGES.invalid }) }
  const parsed = parseIdea(body)
  if (parsed.error) return json(400, { error: MESSAGES[parsed.error] })
  const message = composeIdeaEmail(parsed, { when: now(), country: countryName(request.headers.get('x-vercel-ip-country')), timeZone: env.DOWNLOAD_NOTIFY_TIMEZONE || 'America/Halifax' })
  const sent = await sendNotification(env, message, fetchImpl).catch((error) => ({ sent: false, reason: error?.name ?? 'error' }))
  if (!sent.sent) {
    console.error(`Idea email failed: ${sent.reason}`)
    // Not delivered anywhere: say so rather than pretend.
    return json(503, { error: 'Your idea could not be sent just now. Please try again in a few minutes, or email support@atlasatlantic.co.' })
  }
  waitUntil(recordServerEvent(request, { name: 'idea_submitted', path: '/ideas', properties: { area: parsed.area, length: parsed.idea.length, withEmail: !!parsed.email } }, env, fetchImpl, now()).catch(() => {}))
  return json(202, { ok: true })
}
