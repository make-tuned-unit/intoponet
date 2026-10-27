/** Reading settings kept on this device. The reading language itself lives with translation (useTranslate). */
export type AppSettings = {
  /** Translate pages in other languages into your language as they load. */
  autoTranslate: boolean
  /** Download a missing language model the first time a page needs it (otherwise the translate bar offers it). */
  autoDownload: boolean
}

export const appSettingsKey = 'intoponet.settings.v1'
export const headlinePrefKey = 'intoponet.translate.headlines.v1'
export const defaultAppSettings: AppSettings = { autoTranslate: false, autoDownload: false }

export function parseAppSettings(payload: string | null): AppSettings {
  try {
    const raw = JSON.parse(payload ?? 'null') as Partial<AppSettings> | null
    if (!raw || typeof raw !== 'object') return defaultAppSettings
    return { autoTranslate: raw.autoTranslate === true, autoDownload: raw.autoDownload === true }
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

/**
 * Whether a page should be translated automatically now, and which models it
 * still needs. Returns null when nothing should happen.
 */
export function autoTranslatePlan(input: {
  enabled: boolean
  detected: string | null
  target: string
  supported: (code: string | null) => boolean
  ready: Set<string>
  alreadyTried: boolean
}): { from: string; to: string; missing: string[] } | null {
  const { enabled, detected, target } = input
  if (!enabled || !detected || detected === target || input.alreadyTried) return null
  if (!input.supported(detected) || !input.supported(target)) return null
  return { from: detected, to: target, missing: [detected, target].filter((code) => !input.ready.has(code)) }
}
