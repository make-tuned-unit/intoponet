/**
 * The user agent web pages see: plain Chrome. Electron's default adds "Electron/x" and the
 * app's name and version, and some sites (africanews.com, for one) then tell readers to
 * upgrade their browser. Client hints already report only Chromium.
 */
export function browserUserAgent(fallback: string): string {
  return fallback.replace(/ (?:Electron|Intoponet)\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim()
}
