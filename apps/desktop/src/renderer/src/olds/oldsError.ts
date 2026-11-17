/**
 * What The Olds says when a lookup fails. Only a lookup that Wikipedia answered and that matched
 * nothing may say there is no history: a missing network, a server error, rate limiting or an
 * unreadable answer each say so, and all of them can be tried again.
 */
export function oldsErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : ''
  if (/not answering|rate limit|responded \d{3}|sent an answer that could not be read/i.test(message)) return 'Wikipedia and Wikidata are not answering properly right now. Try again in a moment.'
  if (/network|fetch|timed out|timeout|ENOTFOUND/i.test(message)) return 'Could not reach Wikidata. Check your connection and try again.'
  return 'No sourced history could be found for this.'
}
