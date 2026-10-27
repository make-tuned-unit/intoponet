import { isSensitiveUrl } from '@intoponet/local-knowledge'

/**
 * Sensitive-page policy for Absorb (PRD ABS-005). Banking, health, sign-in,
 * payment and private-message pages are never absorbed. The URL is checked
 * before any script runs in the page; form signals are checked from the
 * isolated extraction result.
 */
/** Whole path segments only, so news articles like /pay-rise-for-nurses or /news/health/… stay absorbable. */
const SENSITIVE_PATH = /(^|\/)(log-?in|sign-?in|sign-?up|auth|oauth|sso|account|accounts|my-?account|password|checkout|cart|payment|payments|billing|invoice|banking|wallet|patient|patients|prescriptions?|messages|inbox|mail|webmail)(\/|$)/i
const SENSITIVE_QUERY = /(^|[?&])(password|token|session|auth|oauth_token|code)=/i
/** Hosts that name a bank, credit union or care provider anywhere in a label. */
const SENSITIVE_HOST_WORD = /(bank|banque|creditunion|hospital|clinic|pharmacy|patient)/i
const SENSITIVE_HOST_PREFIX = /^(login|signin|auth|accounts?|secure|mail|webmail|inbox|messages?|pay|payments?|billing|checkout|banking|portal|myaccount)\./i

export const REFUSALS = {
  notWeb: 'Only ordinary web pages (http or https) can be absorbed.',
  sensitiveSite: 'Banking, health and account sites are never absorbed, so nothing was saved.',
  sensitivePage: 'This looks like a sign-in, account, payment or messages page, so it was not absorbed.',
  formFields: 'This page has a password or card field, so it was not absorbed.',
  noPage: 'Open a page in the browser first, then absorb it.',
  excludedSite: 'You left this site out in Privacy, so it is never absorbed. Remove it there to absorb from it.',
  noSelection: 'Select the text you want to keep on the page, then try again.',
  tooLittle: 'There isn’t enough readable text on this page to absorb.',
  failed: 'The page’s text could not be read. Try again once it has finished loading.',
} as const

/** A user-facing refusal reason, or null when the URL may be absorbed. */
export function urlRefusal(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return REFUSALS.notWeb
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return REFUSALS.notWeb
  if (url.username || url.password) return REFUSALS.sensitivePage
  if (isSensitiveUrl(value) || SENSITIVE_HOST_WORD.test(url.hostname)) return REFUSALS.sensitiveSite
  if (SENSITIVE_HOST_PREFIX.test(url.hostname)) return REFUSALS.sensitivePage
  if (SENSITIVE_PATH.test(url.pathname) || SENSITIVE_QUERY.test(url.search)) return REFUSALS.sensitivePage
  return null
}

/** Refusal from signals found inside the page (never the field values). */
export function pageRefusal(flags: { password: boolean; payment: boolean }): string | null {
  return flags.password || flags.payment ? REFUSALS.formFields : null
}
