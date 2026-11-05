/** Reading settings kept on this device. The reading language itself lives with translation (useTranslate). */
export type AppSettings = {
  /**
   * Show everything in your language: pages, headlines and story titles in other
   * languages are translated on this Mac as they appear, downloading a language the
   * first time it is needed. On unless turned off.
   */
  autoTranslate: boolean
  /** Sites never translated automatically (host names without "www."). */
  neverTranslate: string[]
}

/** v2: automatic translation became the default (v1 was opt-in, so v1 is not read). */
export const appSettingsKey = 'intoponet.settings.v2'
/**
 * Headlines and titles in your language ("1") or as published ("0"). v2 flipped the
 * default to on; v1 ("1" only when switched on) cannot tell an explicit "off" from the
 * old default, so it is not read.
 */
export const headlinePrefKey = 'intoponet.translate.headlines.v2'
export const headlinePrefEvent = 'intoponet:headline-pref'
export const defaultAppSettings: AppSettings = { autoTranslate: true, neverTranslate: [] }

const MAX_SITES = 300

export function parseAppSettings(payload: string | null): AppSettings {
  try {
    const raw = JSON.parse(payload ?? 'null') as Partial<AppSettings> | null
    if (!raw || typeof raw !== 'object') return defaultAppSettings
    const sites = Array.isArray(raw.neverTranslate) ? raw.neverTranslate.filter((site): site is string => typeof site === 'string' && isSiteKey(site)) : []
    return { autoTranslate: raw.autoTranslate !== false, neverTranslate: [...new Set(sites)].slice(0, MAX_SITES) }
  } catch {
    return defaultAppSettings
  }
}

export function readAppSettings(): AppSettings {
  try {
    return parseAppSettings(localStorage.getItem(appSettingsKey))
  } catch {
    return defaultAppSettings
  }
}

export function writeAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(appSettingsKey, JSON.stringify(settings))
  } catch {
    // Applies for this session only.
  }
}

/** Headline translation is on unless the reader chose "Original". */
export function parseHeadlinePref(value: string | null): boolean {
  return value !== '0'
}

function isSiteKey(value: string): boolean {
  return value.length > 0 && value.length <= 253 && /^[a-z0-9.-]+$/.test(value) && !value.startsWith('.')
}

/** The site a "never translate" choice applies to: the host without "www.", or null for non-web pages. */
export function siteKey(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) return null
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    return isSiteKey(host) ? host : null
  } catch {
    return null
  }
}

/** True when the page's site, or a site it is part of (news.example.com under example.com), is never translated. */
export function isNeverTranslated(url: string, sites: string[]): boolean {
  const host = siteKey(url)
  if (!host) return false
  return sites.some((site) => host === site || host.endsWith(`.${site}`))
}

export function withNeverTranslate(settings: AppSettings, site: string, never: boolean): AppSettings {
  const rest = settings.neverTranslate.filter((item) => item !== site)
  return { ...settings, neverTranslate: never ? [site, ...rest].slice(0, MAX_SITES) : rest }
}

/**
 * Whether a page should be translated automatically now, and which models it
 * still needs (they download automatically). Returns null when nothing should happen.
 */
export function autoTranslatePlan(input: {
  enabled: boolean
  /** The site is on the "never translate" list. */
  blocked?: boolean
  detected: string | null
  target: string
  supported: (code: string | null) => boolean
  ready: Set<string>
  alreadyTried: boolean
}): { from: string; to: string; missing: string[] } | null {
  const { enabled, detected, target } = input
  if (!enabled || input.blocked || !detected || detected === target || input.alreadyTried) return null
  if (!input.supported(detected) || !input.supported(target)) return null
  return { from: detected, to: target, missing: [target, detected].filter((code) => !input.ready.has(code)) }
}
