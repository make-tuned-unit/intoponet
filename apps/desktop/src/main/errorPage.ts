import type { CertificateSummary, PageLoadError, PageLoadErrorKind } from '@intoponet/browser-api'

/**
 * The in-tab error page: what went wrong when a page could not load, in plain words.
 *
 * It is drawn by the shell over the tab's (hidden) page view rather than loaded into the tab as a
 * data: or custom-scheme page. The failed address stays the tab's committed entry (Chromium commits
 * its own blank error page at that URL), so the address bar keeps the real address, Back/Forward
 * and Reload act on it naturally, and the error page itself runs no page code: it cannot reach the
 * shell's API or the sign-in helper, and a hostile page cannot imitate or script it.
 */

/** Chromium's net error names for the codes the error page explains. */
const NET_ERROR_NAMES: Record<number, string> = {
  [-2]: 'ERR_FAILED',
  [-7]: 'ERR_TIMED_OUT',
  [-20]: 'ERR_BLOCKED_BY_CLIENT',
  [-21]: 'ERR_NETWORK_CHANGED',
  [-22]: 'ERR_BLOCKED_BY_ADMINISTRATOR',
  [-27]: 'ERR_BLOCKED_BY_RESPONSE',
  [-100]: 'ERR_CONNECTION_CLOSED',
  [-101]: 'ERR_CONNECTION_RESET',
  [-102]: 'ERR_CONNECTION_REFUSED',
  [-103]: 'ERR_CONNECTION_ABORTED',
  [-104]: 'ERR_CONNECTION_FAILED',
  [-105]: 'ERR_NAME_NOT_RESOLVED',
  [-106]: 'ERR_INTERNET_DISCONNECTED',
  [-107]: 'ERR_SSL_PROTOCOL_ERROR',
  [-108]: 'ERR_ADDRESS_INVALID',
  [-109]: 'ERR_ADDRESS_UNREACHABLE',
  [-113]: 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH',
  [-118]: 'ERR_CONNECTION_TIMED_OUT',
  [-137]: 'ERR_NAME_RESOLUTION_FAILED',
  [-200]: 'ERR_CERT_COMMON_NAME_INVALID',
  [-201]: 'ERR_CERT_DATE_INVALID',
  [-202]: 'ERR_CERT_AUTHORITY_INVALID',
  [-203]: 'ERR_CERT_CONTAINS_ERRORS',
  [-204]: 'ERR_CERT_NO_REVOCATION_MECHANISM',
  [-206]: 'ERR_CERT_REVOKED',
  [-207]: 'ERR_CERT_INVALID',
  [-208]: 'ERR_CERT_WEAK_SIGNATURE_ALGORITHM',
  [-210]: 'ERR_CERT_NON_UNIQUE_NAME',
  [-211]: 'ERR_CERT_WEAK_KEY',
  [-212]: 'ERR_CERT_NAME_CONSTRAINT_VIOLATION',
  [-213]: 'ERR_CERT_VALIDITY_TOO_LONG',
  [-214]: 'ERR_CERTIFICATE_TRANSPARENCY_REQUIRED',
  [-310]: 'ERR_TOO_MANY_REDIRECTS',
  [-324]: 'ERR_EMPTY_RESPONSE',
}

const OFFLINE_CODES = new Set([-106, -21])
const NOT_FOUND_CODES = new Set([-105, -137])
const TIMEOUT_CODES = new Set([-7, -118])
const UNREACHABLE_CODES = new Set([-100, -101, -103, -104, -109, -324])
const INSECURE_CODES = new Set([-107, -113])
const BLOCKED_CODES = new Set([-20, -22, -27])

/** The load was stopped (a new navigation replaced it, or it became a download): not an error. */
export const ABORTED = -3

export function isCertificateError(code: number): boolean {
  return code <= -200 && code > -300
}

export function netErrorName(code: number, description = ''): string {
  const fromDescription = /ERR_[A-Z0-9_]+/.exec(description)?.[0]
  return NET_ERROR_NAMES[code] ?? fromDescription ?? `ERR_${Math.abs(code)}`
}

/** Should the tab show the error page for this failure of its main frame? */
export function showsErrorPage(code: number, url: string): boolean {
  if (code === ABORTED || code >= 0) return false
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:'
  } catch {
    return false
  }
}

function hostOf(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' ? decodeURIComponent(parsed.pathname.split('/').pop() || parsed.pathname) : parsed.host
  } catch {
    return url.slice(0, 120)
  }
}

/** Certificate details for the page, from Electron's certificate (dates in seconds since 1970). */
export function summarizeCertificate(
  certificate: { subjectName?: string; issuerName?: string; validStart?: number; validExpiry?: number; fingerprint?: string } | null | undefined,
  error: string,
): CertificateSummary | undefined {
  if (!certificate) return undefined
  const date = (seconds: number | undefined): string => {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return ''
    const value = new Date(seconds * 1000)
    return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  }
  const clip = (text: string | undefined, max: number): string => (typeof text === 'string' ? text.slice(0, max) : '')
  return {
    subject: clip(certificate.subjectName, 300),
    issuer: clip(certificate.issuerName, 300),
    validFrom: date(certificate.validStart),
    validUntil: date(certificate.validExpiry),
    fingerprint: clip(certificate.fingerprint, 200),
    error: clip(error, 120),
  }
}

/** Plain words for a failed load. `online` is the Mac's network state when it failed. */
export function classifyLoadError(input: {
  code: number
  description?: string
  url: string
  online: boolean
  certificate?: CertificateSummary
}): PageLoadError {
  const { code, url, online } = input
  const host = hostOf(url)
  const codeName = netErrorName(code, input.description)
  const base = { url, host, code, codeName, autoRetry: false }
  const make = (kind: PageLoadErrorKind, title: string, detail: string, extra: Partial<PageLoadError> = {}): PageLoadError => ({ ...base, kind, title, detail, ...extra })

  // Without a network, every failure to reach a site is really "you are offline".
  if (OFFLINE_CODES.has(code) || (!online && (NOT_FOUND_CODES.has(code) || TIMEOUT_CODES.has(code) || UNREACHABLE_CODES.has(code)))) {
    return make('offline', 'No internet connection', 'Check Wi-Fi or your network cable. This page will load by itself when you are back online.', { autoRetry: true })
  }
  if (isCertificateError(code)) {
    const why: Record<string, string> = {
      ERR_CERT_DATE_INVALID: 'its security certificate has expired or is not valid yet. Your Mac’s clock may also be wrong.',
      ERR_CERT_AUTHORITY_INVALID: 'its security certificate is not from an authority your Mac trusts.',
      ERR_CERT_COMMON_NAME_INVALID: `its security certificate is for a different site, not ${host}.`,
      ERR_CERT_REVOKED: 'its security certificate has been revoked.',
    }
    return make(
      'certificate',
      'Connection not secure',
      `Intoponet did not load ${host} because ${why[codeName] ?? 'its security certificate could not be verified.'} Someone could be trying to read or change what you send. The page was not loaded.`,
      input.certificate ? { certificate: input.certificate } : {},
    )
  }
  if (NOT_FOUND_CODES.has(code)) {
    return make('not-found', `Can’t find ${host}`, 'The address may be misspelled, or the site may no longer exist.')
  }
  if (TIMEOUT_CODES.has(code)) {
    return make('timeout', `${host} took too long to respond`, 'The site may be busy or down. Try again in a moment.')
  }
  if (code === -102) {
    return make('refused', `${host} refused to connect`, 'Nothing answered at this address. The site may be down, or the address may be wrong.')
  }
  if (UNREACHABLE_CODES.has(code)) {
    return make('unreachable', `Can’t reach ${host}`, 'The connection was interrupted. Try again in a moment.')
  }
  if (INSECURE_CODES.has(code)) {
    return make('insecure', `${host} can’t provide a secure connection`, 'The site uses an unsupported or broken security setup.')
  }
  if (BLOCKED_CODES.has(code)) {
    return make('blocked', 'This page was blocked', `${host} could not be shown here.`)
  }
  if (code === -310) {
    return make('redirects', `${host} redirected too many times`, 'The site keeps sending the page somewhere else. Clearing its cookies may help.')
  }
  return make('other', 'This page couldn’t load', `${host} could not be loaded (${codeName}).`)
}

/**
 * Certificate problems seen for a page, kept briefly so the failed load that follows can show
 * them. Keyed by the page (webContents id) and the address.
 */
export class CertificateErrorMemo {
  private readonly entries = new Map<string, { summary: CertificateSummary; at: number }>()

  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 30_000) {}

  private key(owner: number, url: string): string {
    return `${owner} ${url}`
  }

  remember(owner: number, url: string, summary: CertificateSummary | undefined): void {
    if (!summary) return
    if (this.entries.size > 100) this.entries.clear()
    this.entries.set(this.key(owner, url), { summary, at: this.now() })
  }

  /** The certificate for this failed load (once). */
  take(owner: number, url: string): CertificateSummary | undefined {
    let key = this.key(owner, url)
    // A redirect can fail on a different address than the one the certificate was for: the page's latest.
    if (!this.entries.has(key)) key = [...this.entries.keys()].filter((item) => item.startsWith(`${owner} `)).pop() ?? key
    const entry = this.entries.get(key)
    this.entries.delete(key)
    if (!entry || this.now() - entry.at > this.ttlMs) return undefined
    return entry.summary
  }
}
