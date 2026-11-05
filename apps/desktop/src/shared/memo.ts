/**
 * Remembers a pure function's results by a string key, up to `max` entries (then starts over).
 * Digest rebuilds see the same headlines again and again; this keeps them from redoing the
 * same language detection, place matching and tokenizing (a fresh start sees ~110,000
 * headlines, so the limit is well above that). Callers must not mutate results.
 */
export function memoize<A extends unknown[], R>(fn: (...args: A) => R, key: (...args: A) => string, max = 400_000): (...args: A) => R {
  let cache = new Map<string, R>()
  return (...args: A): R => {
    const k = key(...args)
    const hit = cache.get(k)
    if (hit !== undefined || cache.has(k)) return hit as R
    const value = fn(...args)
    if (cache.size >= max) cache = new Map()
    cache.set(k, value)
    return value
  }
}
