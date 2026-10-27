/** Hosts this Mac has seen declare a paywall (kept locally, so future headlines from them are labelled). */
const KEY = 'intoponet.paywalled-hosts.v1'

export function learnedPaywalls(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((host): host is string => typeof host === 'string').slice(0, 500) : []
  } catch {
    return []
  }
}

export function rememberPaywall(url: string): void {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const hosts = learnedPaywalls()
    if (!hosts.includes(host)) localStorage.setItem(KEY, JSON.stringify([host, ...hosts].slice(0, 500)))
  } catch {
    // ignore
  }
}
