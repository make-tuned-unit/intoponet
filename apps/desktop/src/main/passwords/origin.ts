const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The origin (scheme, host, port) a password may be saved for or filled into:
 * https sites, and http only on this Mac (localhost). Anything else is null.
 */
export function passwordOrigin(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  if (parsed.protocol === 'https:' && (parsed.hostname.includes('.') || LOCAL_HOSTS.has(parsed.hostname))) return parsed.origin
  if (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) return parsed.origin
  return null
}

/** The same site for passwords: same scheme and port, host equal once a leading "www." is dropped. */
export function sameLoginSite(a: string, b: string): boolean {
  if (a === b) return true
  try {
    const left = new URL(a)
    const right = new URL(b)
    return left.protocol === right.protocol && left.port === right.port && bareHost(left.hostname) === bareHost(right.hostname)
  } catch {
    return false
  }
}

const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, '')
