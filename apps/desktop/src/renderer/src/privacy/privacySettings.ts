/**
 * Footprint settings for this device (PRD MEM-001, §8.4). Footprints are the
 * recent pages and interest signals Intoponet keeps while you browse.
 */
export type RetentionDays = 0 | 7 | 30 | 90

export type PrivacySettings = {
  /** Keep recent pages and interest signals. Off: browsing leaves no footprints. */
  footprints: boolean
  /** How long recent pages are kept; 0 keeps them until you delete them. */
  retentionDays: RetentionDays
}

export const privacySettingsKey = 'intoponet.privacy.v1'
export const RETENTION_OPTIONS: Array<{ days: RetentionDays; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'Until I delete them' },
]
export const defaultPrivacySettings: PrivacySettings = { footprints: true, retentionDays: 0 }

export function parsePrivacySettings(payload: string | null): PrivacySettings {
  try {
    const raw = JSON.parse(payload ?? 'null') as Partial<PrivacySettings> | null
    if (!raw || typeof raw !== 'object') return defaultPrivacySettings
    const days = RETENTION_OPTIONS.some((option) => option.days === raw.retentionDays) ? (raw.retentionDays as RetentionDays) : defaultPrivacySettings.retentionDays
    return { footprints: raw.footprints !== false, retentionDays: days }
  } catch {
    return defaultPrivacySettings
  }
}

export function readPrivacySettings(): PrivacySettings {
  try {
    return parsePrivacySettings(localStorage.getItem(privacySettingsKey))
  } catch {
    return defaultPrivacySettings
  }
}

export function writePrivacySettings(settings: PrivacySettings): void {
  try {
    localStorage.setItem(privacySettingsKey, JSON.stringify(settings))
  } catch {
    // The setting still applies for this session.
  }
}
