export type UpdateState = 'disabled' | 'idle' | 'checking' | 'downloading' | 'downloaded' | 'not-available' | 'error'

export type UpdateStatus = {
  state: UpdateState
  currentVersion: string
  disabledReason?: 'preview' | 'unsupported-platform' | 'not-configured'
  error?: string
}

export type UpdateCommand = { type: 'status' } | { type: 'check-and-download' } | { type: 'restart' }

export interface UpdatesApi {
  status(): Promise<UpdateStatus>
  checkAndDownload(): Promise<UpdateStatus>
  restart(): Promise<UpdateStatus>
  subscribe(listener: (status: UpdateStatus) => void): () => void
}

export const updateChannels = {
  command: 'intoponet:updates:command',
  event: 'intoponet:updates:event',
} as const

export function parseUpdateCommand(value: unknown): UpdateCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid update command.')
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'type')) throw new Error('Invalid update command.')
  const type = record['type']
  if (type !== 'status' && type !== 'check-and-download' && type !== 'restart') throw new Error('Invalid update command.')
  return { type }
}
