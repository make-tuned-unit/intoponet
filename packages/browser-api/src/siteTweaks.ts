/**
 * Make a site yours (SITE_TWEAKS): per-site hiding, reading width, font, colours and the person's
 * own style rules. Stored only on this Mac; style only, never a script.
 */
export const SITE_TWEAK_WIDTHS = ['narrow', 'medium', 'wide'] as const
export const SITE_TWEAK_FONTS = ['serif', 'sans', 'mono'] as const
export const SITE_TWEAK_COLORS = ['light', 'dark'] as const
export type SiteTweakWidth = (typeof SITE_TWEAK_WIDTHS)[number]
export type SiteTweakFont = (typeof SITE_TWEAK_FONTS)[number]
export type SiteTweakColors = (typeof SITE_TWEAK_COLORS)[number]

/** What is kept for one site. `hidden` are CSS selectors; `css` is the person's own style rules. */
export type SiteTweak = {
  enabled: boolean
  hidden: string[]
  width?: SiteTweakWidth | undefined
  font?: SiteTweakFont | undefined
  colors?: SiteTweakColors | undefined
  css?: string | undefined
  updatedAt: number
}

/** The shell's draft, before it is checked and stamped. */
export type SiteTweakDraft = Omit<SiteTweak, 'updatedAt'>

export type SiteTweakState = {
  /** The page's site (host without "www."), or null for pages that cannot have tweaks. */
  site: string | null
  tweak: SiteTweak | null
  /** A private tab: changes last only until private browsing ends and are never written. */
  isPrivate: boolean
}

export type SiteTweakListItem = {
  site: string
  enabled: boolean
  hiddenCount: number
  hasCss: boolean
  width?: SiteTweakWidth
  font?: SiteTweakFont
  colors?: SiteTweakColors
  updatedAt: number
}

export type SiteTweakSaveResult = { ok: true; tweak: SiteTweak | null } | { ok: false; error: string }

export type SiteTweakPick = { selector: string | null; error?: string }

export interface SiteTweakApi {
  state(): Promise<SiteTweakState>
  save(draft: SiteTweakDraft): Promise<SiteTweakSaveResult>
  setEnabled(enabled: boolean, site?: string): Promise<SiteTweakState>
  remove(site?: string): Promise<void>
  list(): Promise<SiteTweakListItem[]>
  pick(): Promise<SiteTweakPick>
  cancelPick(): Promise<void>
  clearPreview(): Promise<void>
}

/** Hosts only (what zoomSite() keys tweaks by). Refuses anything else. */
export function parseSiteTweakSite(value: unknown): string {
  if (typeof value !== 'string' || value.length > 253 || !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(value)) {
    throw new Error('Invalid site.')
  }
  return value
}

/** The draft as sent by the shell. Shape only: the detailed checks (selectors, CSS) happen in main. */
export function parseSiteTweakDraft(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid site tweak.')
  if (JSON.stringify(value).length > 64_000) throw new Error('Site tweak is too large.')
  return value as Record<string, unknown>
}
