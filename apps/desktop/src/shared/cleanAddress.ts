import { TRACKING_PARAMETER } from '@intoponet/beacon-core'

/**
 * A web address with known tracking parameters (utm_*, fbclid, gclid…) removed, for copying and
 * sharing. Everything else is kept as it was, including the fragment and parameter order.
 * Non-web addresses are returned unchanged.
 */
export function cleanAddress(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return value
  const keys = [...new Set(url.searchParams.keys())]
  const tracking = keys.filter((key) => TRACKING_PARAMETER.test(key))
  if (!tracking.length) return value
  for (const key of tracking) url.searchParams.delete(key)
  // URLSearchParams re-encodes what it keeps; rebuild only when something was removed.
  if (![...url.searchParams.keys()].length) url.search = ''
  return url.toString()
}
