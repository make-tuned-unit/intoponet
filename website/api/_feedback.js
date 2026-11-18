import { recordServerEvent } from './_permagent.js'
import { countryName, sendNotification } from './_download-notify.js'

// POST /api/feedback: a rating and/or comment from the desktop app, emailed to the owner and
// counted in analytics (with the first 256 characters of the comment). Privacy: only what the person
// wrote, their rating, the app version and a country name are kept. No IP address or user agent.

const COMMENT_LIMIT = 2_000
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/** The cleaned feedback, or null when it is not feedback. */
export function parseFeedback(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const rating = Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : null
  // Control characters out (newlines and tabs stay).
  const comment = typeof body.comment === 'string' ? body.comment.replace(/[^\P{C}\n\t]/gu, '').trim().slice(0, COMMENT_LIMIT) : ''
  const version = typeof body.version === 'string' && /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(body.version) ? body.version : null
  if (rating === null && !comment) return null
  if (!version) return null
  return { rating, comment, version }
}

export function composeFeedbackEmail({ rating, comment, version }, { when, country, timeZone }) {
  const time = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(when)
  const where = country ? ` from ${country}` : ''
  const stars = rating ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)` : 'No rating'
  return {
    subject: `Intoponet feedback${rating ? `: ${rating}/5` : ''}${where}`,
    text: `${stars}\n\n${comment || '(No comment)'}\n\nIntoponet ${version} for macOS · ${time}${where}\n\nOnly the rating, the comment, the app version and a country are sent. No IP address or identifier.\n— intoponet.com`,
  }
}

export async function handleFeedback(request, { env = process.env, now = () => new Date(), fetchImpl = fetch, waitUntil = (promise) => { promise.catch(() => {}) } } = {}) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  // Only the desktop app sends this (it names its version); browsers posting from other sites are refused.
  if (!request.headers.get('x-intoponet-app') || request.headers.get('origin')) return json(403, { error: 'Forbidden.' })
  if (Number(request.headers.get('content-length') ?? 0) > 16_384) return json(413, { error: 'Too large.' })
  let body
  try { body = JSON.parse((await request.text()).slice(0, 16_384)) } catch { return json(400, { error: 'Invalid JSON.' }) }
  const feedback = parseFeedback(body)
  if (!feedback) return json(400, { error: 'A rating or a comment, and the app version, are needed.' })
  const country = countryName(request.headers.get('x-vercel-ip-country'))
  waitUntil(recordServerEvent(request, {
    name: 'app_feedback',
    path: '/api/feedback',
    properties: { version: feedback.version, ...(feedback.rating ? { rating: feedback.rating } : {}), hasComment: !!feedback.comment, comment: feedback.comment.slice(0, 256) },
    isBot: false,
  }, env, fetchImpl, now()).catch(() => {}))
  const message = composeFeedbackEmail(feedback, { when: now(), country, timeZone: env.DOWNLOAD_NOTIFY_TIMEZONE || 'America/Halifax' })
  const sent = await sendNotification(env, message, fetchImpl).catch((error) => ({ sent: false, reason: error?.name ?? 'error' }))
  if (!sent.sent && sent.reason !== 'not-configured') console.error(`Feedback email failed: ${sent.reason}`)
  return json(202, { ok: true })
}
