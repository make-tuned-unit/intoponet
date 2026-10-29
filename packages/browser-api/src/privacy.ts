/**
 * Private browsing and local-data protections (PRD MEM-001, §8.4).
 * Private tabs use an in-memory browsing session: nothing they do is stored
 * (no cookies or cache kept, no footprints, no interest signals, no restore),
 * and turning private browsing off closes them and wipes that session.
 */
export const privacyChannels = {
  command: 'intoponet:privacy',
  event: 'intoponet:privacy-event',
} as const

export type PrivacyState = {
  privateMode: boolean
  privateTabs: number
  /** Effective exclusion status for library, knowledge, Laya, and personal-data paths; null when unavailable, partial, or unverified. */
  backupExcluded: boolean | null
  /** Whether this computer can apply the Time Machine setting. */
  backupExclusionAvailable: boolean
  /** Persisted user choice, kept separate so an enabled request remains checked while paths are missing or status is partial. */
  backupExclusionRequested: boolean | null
  backupPaths: string[]
  /** Sites you never want absorbed or remembered (PRD ABS-005): no Absorb, no recent pages, no interest signals. */
  excludedSites: string[]
}

/** "https://www.Example.com/x" or "example.com" → "example.com"; null if it isn't a site name. */
export function normalizeSite(value: string): string | null {
  const raw = value.trim().toLowerCase()
  if (!raw) return null
  let host = raw
  try {
    host = new URL(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
  host = host.replace(/^www\./, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && host.length <= 253 ? host : null
}

/** Whether a page address belongs to one of the excluded sites (the site itself or any subdomain). */
export function isExcludedSite(url: string, sites: readonly string[]): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return false
  }
  return sites.some((site) => host === site || host.endsWith(`.${site}`))
}

export type PrivacyCommand =
  | { type: 'state' }
  | { type: 'set-private-mode'; on: boolean }
  | { type: 'set-backup-exclusion'; on: boolean }
  | { type: 'set-excluded-sites'; sites: string[] }

export interface PrivacyApi {
  state(): Promise<PrivacyState>
  setPrivateMode(on: boolean): Promise<PrivacyState>
  setBackupExclusion(on: boolean): Promise<PrivacyState>
  setExcludedSites(sites: string[]): Promise<PrivacyState>
  subscribe(listener: (state: PrivacyState) => void): () => void
}

export function parsePrivacyCommand(value: unknown): PrivacyCommand {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid privacy command.')
  const v = value as Record<string, unknown>
  switch (v['type']) {
    case 'state':
      return { type: 'state' }
    case 'set-private-mode':
    case 'set-backup-exclusion':
      if (typeof v['on'] !== 'boolean') throw new Error('Invalid privacy command.')
      return { type: v['type'], on: v['on'] }
    case 'set-excluded-sites': {
      if (!Array.isArray(v['sites']) || v['sites'].length > 500) throw new Error('Invalid privacy command.')
      const sites = [...new Set(v['sites'].map((site) => (typeof site === 'string' ? normalizeSite(site) : null)).filter((site): site is string => !!site))]
      return { type: 'set-excluded-sites', sites }
    }
    default:
      throw new Error('Invalid privacy command.')
  }
}
