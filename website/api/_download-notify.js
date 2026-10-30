// /download/mac: redirect to the current DMG, and email the owner that someone downloaded it.
// Privacy: the email carries the version, the time and a country name only. No IP address,
// user agent or identifier is sent or stored. Bots, link previews and prefetches are not counted.

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|linkedin|pinterest|vkshare|w3c_validator|headless|lighthouse|pagespeed|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|undici|httpclient|libwww|scrapy|monitor|uptime|pingdom|statuscake|vercel-screenshot/i

/** A person's browser asking for the file, not a crawler, link unfurler or speculative prefetch. */
export function isHumanDownload(request) {
  if (request.method !== 'GET') return false
  const agent = request.headers.get('user-agent') ?? ''
  if (!agent || BOT.test(agent)) return false
  const purpose = `${request.headers.get('sec-purpose') ?? ''} ${request.headers.get('purpose') ?? ''} ${request.headers.get('x-moz') ?? ''}`
  return !/prefetch|preview/i.test(purpose)
}

export function countryName(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return null
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? null } catch { return null }
}

export function composeEmail({ version, when, country, timeZone }) {
  const time = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(when)
  const where = country ? ` from ${country}` : ''
  return {
    subject: `Intoponet ${version} downloaded${where}`,
    text: `Someone downloaded Intoponet ${version} for macOS (Apple silicon) on ${time}${where}.\n\nNo IP address or identifier is recorded; bots and link previews are not counted.\n— intoponet.com`,
  }
}

export async function sendNotification(env, message, fetchImpl = fetch) {
  const key = env.RESEND_API_KEY, to = env.DOWNLOAD_NOTIFY_TO
  if (!key || !to) return { sent: false, reason: 'not-configured' }
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.DOWNLOAD_NOTIFY_FROM || 'Intoponet <onboarding@resend.dev>', to: [to], subject: message.subject, text: message.text }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) return { sent: false, reason: `resend-${response.status}` }
  return { sent: true }
}

/** Always redirects; the email is sent alongside, and its failure never blocks the download. */
export function handleDownload(request, { release, env = process.env, now = () => new Date(), waitUntil = (promise) => { promise.catch(() => {}) }, fetchImpl = fetch } = {}) {
  if (isHumanDownload(request)) {
    const message = composeEmail({ version: release.version, when: now(), country: countryName(request.headers.get('x-vercel-ip-country')), timeZone: env.DOWNLOAD_NOTIFY_TIMEZONE || 'America/Halifax' })
    waitUntil(sendNotification(env, message, fetchImpl).then((result) => {
      if (!result.sent && result.reason !== 'not-configured') console.error(`Download notification failed: ${result.reason}`)
    }).catch((error) => console.error(`Download notification failed: ${error?.name ?? 'error'}`)))
  }
  return new Response(null, { status: 302, headers: { location: release.dmg, 'cache-control': 'no-store' } })
}
