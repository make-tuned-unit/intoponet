/**
 * Site permissions (PRD WEB-001, WEB-006): a site asks, you answer in a bar
 * under the toolbar, and the answer is remembered for that site (private
 * tabs: only until private browsing ends).
 */
export const sitePermissionChannels = {
  command: 'intoponet:site-permissions',
  event: 'intoponet:site-permissions-event',
} as const

export const SITE_PERMISSION_KINDS = ['camera', 'microphone', 'location', 'notifications', 'clipboard-read', 'popups'] as const
export type SitePermissionKind = (typeof SITE_PERMISSION_KINDS)[number]
export type SitePermissionDecision = 'allow' | 'block'
/** What the person can answer in the bar: 'allow-once' grants this request without remembering it. */
export type SitePermissionAnswer = SitePermissionDecision | 'allow-once' | 'dismiss'

export type SitePermissionRequest = {
  id: string
  /** e.g. "https://meet.google.com" */
  origin: string
  /** The page's own origin, when the asking site is a frame embedded in it. */
  topOrigin?: string
  kinds: SitePermissionKind[]
  /** Asked from a private tab: the answer is forgotten when private browsing ends. */
  isPrivate: boolean
  /** Asked from a workspace with separate sign-ins: its name (the answer is kept for that workspace only). */
  workspace?: string
}

export type SitePermissionEvent =
  | { type: 'request'; request: SitePermissionRequest }
  | { type: 'resolved'; id: string }
  | { type: 'changed'; origin: string }

export type SitePermissionCommand =
  | { type: 'decide'; id: string; decision: SitePermissionAnswer }
  | { type: 'list'; origin: string }
  | { type: 'reset'; origin: string; kind?: SitePermissionKind }
  | { type: 'pending' }

export type SitePermissionMap = Partial<Record<SitePermissionKind, SitePermissionDecision>>

export interface SitePermissionApi {
  decide(id: string, decision: SitePermissionAnswer): Promise<void>
  list(origin: string): Promise<SitePermissionMap>
  reset(origin: string, kind?: SitePermissionKind): Promise<SitePermissionMap>
  pending(): Promise<SitePermissionRequest[]>
  subscribe(listener: (event: SitePermissionEvent) => void): () => void
}

const isKind = (value: unknown): value is SitePermissionKind => typeof value === 'string' && (SITE_PERMISSION_KINDS as readonly string[]).includes(value)
const isOrigin = (value: unknown): value is string => typeof value === 'string' && value.length <= 300 && /^https?:\/\/[^/\s]+$/i.test(value)

export function parseSitePermissionCommand(value: unknown): SitePermissionCommand {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid site permission command.')
  const v = value as Record<string, unknown>
  switch (v['type']) {
    case 'decide':
      if (typeof v['id'] !== 'string' || v['id'].length > 80 || !['allow', 'allow-once', 'block', 'dismiss'].includes(v['decision'] as string)) break
      return { type: 'decide', id: v['id'], decision: v['decision'] as SitePermissionAnswer }
    case 'list':
      if (!isOrigin(v['origin'])) break
      return { type: 'list', origin: v['origin'] }
    case 'reset':
      if (!isOrigin(v['origin']) || (v['kind'] !== undefined && !isKind(v['kind']))) break
      return v['kind'] === undefined ? { type: 'reset', origin: v['origin'] } : { type: 'reset', origin: v['origin'], kind: v['kind'] as SitePermissionKind }
    case 'pending':
      return { type: 'pending' }
  }
  throw new Error('Invalid site permission command.')
}

/** Words for a request: "your camera and microphone". */
export function describePermissionKinds(kinds: SitePermissionKind[]): string {
  const words: Record<SitePermissionKind, string> = {
    camera: 'your camera',
    microphone: 'your microphone',
    location: 'your location',
    notifications: 'to show notifications',
    'clipboard-read': 'to read your clipboard',
    popups: 'to open pop-ups',
  }
  const uses = kinds.filter((kind) => kind === 'camera' || kind === 'microphone' || kind === 'location').map((kind) => words[kind].replace(/^your /, ''))
  const parts: string[] = []
  if (uses.length) parts.push(`use your ${uses.length > 1 ? `${uses.slice(0, -1).join(', ')} and ${uses.at(-1)}` : uses[0]}`)
  for (const kind of kinds) if (kind === 'notifications' || kind === 'clipboard-read' || kind === 'popups') parts.push(words[kind].replace(/^to /, ''))
  return parts.join(' and ')
}
