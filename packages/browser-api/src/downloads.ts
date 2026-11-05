/**
 * Downloads manager: every file a page downloads (normal and private tabs) is listed with its
 * progress, and can be paused, resumed, cancelled, opened, shown in Finder or removed from the list.
 * Finished downloads from normal tabs are remembered (capped); private-tab downloads are listed only
 * until the app quits.
 */
export const downloadChannels = {
  command: 'intoponet:downloads',
  event: 'intoponet:downloads-event',
} as const

export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

/**
 * Why a download is waiting for the person:
 * - `dangerous-type`: a file type that can run code on a Mac (Keep / Discard; Discard by default).
 * - `multiple-downloads`: the page started several downloads on its own (Allow / Block).
 */
export type DownloadAttention = 'dangerous-type' | 'multiple-downloads'

export type DownloadEntry = {
  id: string
  filename: string
  /** Only the origin of the address the file came from, for display ("https://example.com"). */
  origin: string
  state: DownloadState
  receivedBytes: number
  /** 0 when the size is unknown. */
  totalBytes: number
  /** Smoothed bytes per second while progressing; 0 otherwise. */
  bytesPerSecond: number
  /** Epoch milliseconds. */
  startedAt: number
  endedAt: number | null
  isPrivate: boolean
  /** The file is still on disk (completed downloads only; false for others). */
  exists: boolean
  /** The download can be paused, resumed or cancelled right now (it belongs to this run of the app). */
  live: boolean
  /** A failed download that can be tried again. */
  canRetry: boolean
  attention: DownloadAttention | null
  /** A short caution shown with the file (e.g. disk images can contain apps). */
  note: string | null
  /** Plain reason when it failed or was refused. */
  error: string | null
}

export type DownloadCommand =
  | { type: 'list' }
  | { type: 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove' | 'retry' | 'keep' | 'discard' | 'allow-multiple' | 'block-multiple'; id: string }
  | { type: 'clear-finished' }

export type DownloadEvent = { type: 'list'; downloads: DownloadEntry[] }

export interface DownloadsApi {
  list(): Promise<DownloadEntry[]>
  pause(id: string): Promise<DownloadEntry[]>
  resume(id: string): Promise<DownloadEntry[]>
  cancel(id: string): Promise<DownloadEntry[]>
  /** Open the finished file with its default app. */
  open(id: string): Promise<DownloadEntry[]>
  /** Show the file in Finder. */
  show(id: string): Promise<DownloadEntry[]>
  /** Take it off the list (the file stays on disk). */
  remove(id: string): Promise<DownloadEntry[]>
  retry(id: string): Promise<DownloadEntry[]>
  /** Keep a file of a dangerous type. */
  keep(id: string): Promise<DownloadEntry[]>
  /** Throw away a file of a dangerous type (or one held for review). */
  discard(id: string): Promise<DownloadEntry[]>
  allowMultiple(id: string): Promise<DownloadEntry[]>
  blockMultiple(id: string): Promise<DownloadEntry[]>
  clearFinished(): Promise<DownloadEntry[]>
  subscribe(listener: (event: DownloadEvent) => void): () => void
}

const ID_COMMANDS = new Set(['pause', 'resume', 'cancel', 'open', 'show', 'remove', 'retry', 'keep', 'discard', 'allow-multiple', 'block-multiple'])

export function parseDownloadCommand(value: unknown): DownloadCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid downloads command.')
  const v = value as Record<string, unknown>
  const type = v['type']
  if (type === 'list' || type === 'clear-finished') return { type }
  if (typeof type === 'string' && ID_COMMANDS.has(type)) {
    const id = v['id']
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error('Invalid download.')
    return { type: type as Exclude<DownloadCommand, { type: 'list' | 'clear-finished' }>['type'], id }
  }
  throw new Error('Invalid downloads command.')
}

/**
 * File types that can run code when opened on a Mac. Zipped apps are fine (Gatekeeper checks them
 * when unpacked); a bare .app bundle arriving as one file is not.
 */
export const DANGEROUS_DOWNLOAD_EXTENSIONS = [
  'command', 'terminal', 'tool', 'app', 'pkg', 'mpkg',
  'webloc', 'inetloc', 'fileloc',
  'scpt', 'scptd', 'applescript', 'workflow', 'action',
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'jar',
] as const

/** Types that get a caution but no question (disk images are a common way to ship Mac apps). */
export const CAUTION_DOWNLOAD_EXTENSIONS = ['dmg'] as const

function extensionOf(filename: string): string {
  const name = filename.trim().toLowerCase().replace(/[.\s]+$/u, '')
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}

export function isDangerousDownload(filename: string): boolean {
  return (DANGEROUS_DOWNLOAD_EXTENSIONS as readonly string[]).includes(extensionOf(filename))
}

export function downloadCaution(filename: string): string | null {
  return (CAUTION_DOWNLOAD_EXTENSIONS as readonly string[]).includes(extensionOf(filename))
    ? 'Disk images can contain apps. Open it only if you trust where it came from.'
    : null
}
