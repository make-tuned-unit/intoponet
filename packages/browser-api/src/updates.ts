export type UpdateState = 'disabled' | 'idle' | 'checking' | 'downloading' | 'downloaded' | 'not-available' | 'error'

export type UpdateStatus = {
  state: UpdateState
  currentVersion: string
  /** Checks run on their own (shortly after launch, then about daily). */
  automatic?: boolean
  /** ISO time of the last check, manual or automatic. */
  lastCheckedAt?: string
  /** The version that has downloaded and is ready to install, when known. */
  availableVersion?: string
  disabledReason?: 'preview' | 'unsupported-platform' | 'not-configured'
  error?: string
}

export type UpdateCommand = { type: 'status' } | { type: 'check-and-download' } | { type: 'restart' } | { type: 'set-automatic'; enabled: boolean }

export interface UpdatesApi {
  status(): Promise<UpdateStatus>
  checkAndDownload(): Promise<UpdateStatus>
  restart(): Promise<UpdateStatus>
  setAutomatic(enabled: boolean): Promise<UpdateStatus>
  subscribe(listener: (status: UpdateStatus) => void): () => void
}

export const updateChannels = {
  command: 'intoponet:updates:command',
  event: 'intoponet:updates:event',
} as const

export function parseUpdateCommand(value: unknown): UpdateCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid update command.')
  const record = value as Record<string, unknown>
  const type = record['type']
  if (type === 'set-automatic') {
    if (Object.keys(record).length !== 2 || typeof record['enabled'] !== 'boolean') throw new Error('Invalid update command.')
    return { type, enabled: record['enabled'] }
  }
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'type')) throw new Error('Invalid update command.')
  if (type !== 'status' && type !== 'check-and-download' && type !== 'restart') throw new Error('Invalid update command.')
  return { type }
}
