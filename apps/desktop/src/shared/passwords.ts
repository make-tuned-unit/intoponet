// Saved passwords: what the app shell and main process say to each other.
// Passwords only cross this channel when the person reveals one in Settings.

export const passwordChannels = {
  command: 'intoponet:passwords',
  event: 'intoponet:passwords-event',
} as const

/** A saved sign-in as the shell sees it (no password). */
export type SavedLogin = {
  id: string
  origin: string
  username: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

/** "Save password for …?" or "Update password?" after a sign-in. */
export type PasswordOffer = {
  id: string
  origin: string
  username: string
  kind: 'save' | 'update'
}

/** What the shell shows for the page in front. */
export type PasswordPageState = {
  origin: string
  offer: PasswordOffer | null
  /** Saved accounts for this site. */
  accounts: Array<{ id: string; username: string }>
  /** Several accounts and none filled yet: ask which one. */
  choose: boolean
  /** The account that was filled, if any. */
  filled: string | null
}

export type PasswordVaultStatus = {
  /** On-device encryption works. */
  available: boolean
  /** The saved file exists but could not be opened. */
  unreadable: boolean
  count: number
}

export type PasswordCommand =
  | { type: 'page-state' }
  | { type: 'decide'; id: string; decision: 'save' | 'never' | 'dismiss' }
  | { type: 'fill'; id: string }
  | { type: 'dismiss-choice' }
  | { type: 'list' }
  | { type: 'status' }
  | { type: 'reveal'; id: string }
  | { type: 'copy'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'never-list' }
  | { type: 'remove-never'; origin: string }

export type PasswordEvent =
  | { type: 'page-state'; state: PasswordPageState | null }
  | { type: 'changed' }

export interface PasswordApi {
  pageState(): Promise<PasswordPageState | null>
  decide(id: string, decision: 'save' | 'never' | 'dismiss'): Promise<void>
  fill(id: string): Promise<void>
  dismissChoice(): Promise<void>
  list(): Promise<SavedLogin[]>
  status(): Promise<PasswordVaultStatus>
  /** Asks for Touch ID (or a confirmation) first; null when the person declines. */
  reveal(id: string): Promise<string | null>
  /** Copies after Touch ID (or a confirmation); cleared from the clipboard after 30 s. */
  copy(id: string): Promise<boolean>
  remove(id: string): Promise<void>
  neverList(): Promise<string[]>
  removeNever(origin: string): Promise<void>
  subscribe(listener: (event: PasswordEvent) => void): () => void
}

const ID = /^[A-Za-z0-9-]{8,64}$/

const id = (value: unknown): string => {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid password id.')
  return value
}

export function parsePasswordCommand(value: unknown): PasswordCommand {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  switch (input['type']) {
    case 'page-state': return { type: 'page-state' }
    case 'list': return { type: 'list' }
    case 'status': return { type: 'status' }
    case 'never-list': return { type: 'never-list' }
    case 'dismiss-choice': return { type: 'dismiss-choice' }
    case 'decide': {
      const decision = input['decision']
      if (decision !== 'save' && decision !== 'never' && decision !== 'dismiss') throw new Error('Invalid decision.')
      return { type: 'decide', id: id(input['id']), decision }
    }
    case 'fill': return { type: 'fill', id: id(input['id']) }
    case 'reveal': return { type: 'reveal', id: id(input['id']) }
    case 'copy': return { type: 'copy', id: id(input['id']) }
    case 'remove': return { type: 'remove', id: id(input['id']) }
    case 'remove-never': {
      const origin = input['origin']
      if (typeof origin !== 'string' || origin.length > 300 || !/^https?:\/\/[^/\s]+$/.test(origin)) throw new Error('Invalid site.')
      return { type: 'remove-never', origin }
    }
    default: throw new Error('Invalid password command.')
  }
}

/** "accounts.example.com" from "https://accounts.example.com". */
export function siteLabel(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}
