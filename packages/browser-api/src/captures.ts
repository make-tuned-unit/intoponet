/**
 * Page captures: screenshots and silent screen recordings of the visible
 * page area. Captures are ordinary PNG/WebM files in a Finder folder per
 * bookmark group (~/Pictures/Intoponet/<Group>/), so they can be reused in
 * videos and demos. Nothing is uploaded. Recordings come from the page's own compositor frames, so no OS
 * screen-recording permission is involved and no other window is captured.
 */

export const captureChannels = {
  command: 'captures:command',
  event: 'captures:event',
} as const

export const CAPTURE_LIMITS = {
  titleLength: 300,
  urlLength: 4_096,
  /** Encoded recording upload cap. */
  videoBytes: 750 * 1024 * 1024,
  recordingMs: 10 * 60 * 1000,
  /** Recording frames are downscaled to at most this width. */
  frameWidth: 1920,
} as const

export type CaptureKind = 'image' | 'video'

export type CaptureRecord = {
  id: string
  kind: CaptureKind
  title: string
  sourceUrl: string
  createdAt: string
  /** Stored media size in pixels. */
  width: number
  height: number
  durationMs?: number
  byteLength: number
  /** Bookmark group (Collection id); null or an unknown id means Unsorted. */
  groupId: string | null
  /** File name in the group's Finder folder. */
  fileName?: string
}

/** Normalized [0, 1] rectangle in the frozen page frame. */
export type CaptureCrop = { x: number; y: number; width: number; height: number }

export type PendingCapture = {
  pendingId: string
  /** JPEG preview of the frozen frame. */
  previewUrl: string
  /** Frame size in device pixels. */
  width: number
  height: number
  /** Page view rectangle in window coordinates (CSS px), for overlay placement. */
  viewBounds: { x: number; y: number; width: number; height: number }
  title: string
  sourceUrl: string
}

export type CaptureCommand =
  | { type: 'begin' }
  | { type: 'cancel'; pendingId: string }
  | { type: 'save-image'; pendingId: string; crop: CaptureCrop; groupId: string | null }
  | { type: 'start-recording'; pendingId: string; crop: CaptureCrop }
  | { type: 'stop-frames' }
  | { type: 'save-video'; pendingId: string; bytes: Uint8Array; mimeType: string; durationMs: number; groupId: string | null }
  | { type: 'list' }
  | { type: 'update'; id: string; groupId?: string | null; title?: string }
  | { type: 'delete'; id: string }
  | { type: 'delete-all' }
  | { type: 'reveal'; id: string }
  | { type: 'open-folder'; groupId: string | null }
  | { type: 'sync-groups'; groups: Array<{ id: string; label: string }> }
  | { type: 'copy-image'; id: string }
  | { type: 'set-page-hidden'; hidden: boolean }

export type CaptureEvent =
  | { type: 'frame'; jpeg: Uint8Array; width: number; height: number }
  | { type: 'recording-interrupted'; reason: 'tab-changed' | 'page-closed' }
  | { type: 'changed'; records: CaptureRecord[] }

export interface CaptureApi {
  begin(): Promise<PendingCapture>
  cancel(pendingId: string): Promise<void>
  saveImage(pendingId: string, crop: CaptureCrop, groupId: string | null): Promise<CaptureRecord>
  startRecording(pendingId: string, crop: CaptureCrop): Promise<void>
  stopFrames(): Promise<void>
  saveVideo(pendingId: string, bytes: Uint8Array, mimeType: string, durationMs: number, groupId: string | null): Promise<CaptureRecord>
  list(): Promise<CaptureRecord[]>
  update(id: string, patch: { groupId?: string | null; title?: string }): Promise<CaptureRecord>
  remove(id: string): Promise<void>
  removeAll(): Promise<void>
  /** Show the capture's file selected in Finder. */
  reveal(id: string): Promise<void>
  /** Open a bookmark group's capture folder in Finder (null: Unsorted). */
  openFolder(groupId: string | null): Promise<void>
  /** Keep Finder folders named after the current bookmark groups. */
  syncGroups(groups: Array<{ id: string; label: string }>): Promise<void>
  copyImage(id: string): Promise<void>
  setPageHidden(hidden: boolean): Promise<void>
  /** `intoponet-capture://` URL for full media or its thumbnail. */
  mediaUrl(record: Pick<CaptureRecord, 'id' | 'createdAt'>, variant: 'media' | 'thumb'): string
  subscribe(listener: (event: CaptureEvent) => void): () => void
}

export const CAPTURE_SCHEME = 'intoponet-capture'
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isCaptureId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function parseCaptureCrop(value: unknown): CaptureCrop {
  if (!isRecord(value)) throw new Error('Invalid capture crop.')
  const { x, y, width, height } = value
  if (!finiteIn(x, 0, 1) || !finiteIn(y, 0, 1) || !finiteIn(width, 0.001, 1) || !finiteIn(height, 0.001, 1) ||
      x + width > 1.000001 || y + height > 1.000001) throw new Error('Invalid capture crop.')
  return { x, y, width, height }
}

function parseGroupId(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value
  throw new Error('Invalid capture group.')
}

function parseId(value: unknown, label = 'capture'): string {
  if (!isCaptureId(value)) throw new Error(`Invalid ${label} id.`)
  return value
}

export function parseCaptureCommand(value: unknown): CaptureCommand {
  if (!isRecord(value) || typeof value['type'] !== 'string') throw new Error('Invalid capture command.')
  switch (value['type']) {
    case 'begin':
    case 'list':
    case 'stop-frames':
    case 'delete-all':
      return { type: value['type'] }
    case 'cancel':
      return { type: 'cancel', pendingId: parseId(value['pendingId'], 'pending') }
    case 'save-image':
      return { type: 'save-image', pendingId: parseId(value['pendingId'], 'pending'), crop: parseCaptureCrop(value['crop']), groupId: parseGroupId(value['groupId']) }
    case 'start-recording':
      return { type: 'start-recording', pendingId: parseId(value['pendingId'], 'pending'), crop: parseCaptureCrop(value['crop']) }
    case 'save-video': {
      const bytes = value['bytes']
      const mimeType = value['mimeType']
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > CAPTURE_LIMITS.videoBytes) throw new Error('Invalid recording.')
      if (typeof mimeType !== 'string' || !/^video\/webm(;\s*codecs=[\w.,]+)?$/.test(mimeType)) throw new Error('Invalid recording type.')
      if (!finiteIn(value['durationMs'], 0, CAPTURE_LIMITS.recordingMs + 5_000)) throw new Error('Invalid recording duration.')
      return { type: 'save-video', pendingId: parseId(value['pendingId'], 'pending'), bytes, mimeType, durationMs: value['durationMs'], groupId: parseGroupId(value['groupId']) }
    }
    case 'update': {
      const command: CaptureCommand = { type: 'update', id: parseId(value['id']) }
      if ('groupId' in value) command.groupId = parseGroupId(value['groupId'])
      if ('title' in value) {
        const title = value['title']
        if (typeof title !== 'string' || title.trim().length === 0 || title.length > CAPTURE_LIMITS.titleLength) throw new Error('Invalid capture title.')
        command.title = title.trim()
      }
      return command
    }
    case 'open-folder':
      return { type: 'open-folder', groupId: parseGroupId(value['groupId']) }
    case 'sync-groups': {
      const groups = value['groups']
      if (!Array.isArray(groups) || groups.length > 500) throw new Error('Invalid capture groups.')
      return {
        type: 'sync-groups',
        groups: groups.map((group: unknown) => {
          if (!isRecord(group) || typeof group['label'] !== 'string' || group['label'].length > 200) throw new Error('Invalid capture group.')
          return { id: parseGroupId(group['id']) ?? '', label: group['label'] }
        }).filter((group) => group.id),
      }
    }
    case 'delete':
    case 'reveal':
    case 'copy-image':
      return { type: value['type'], id: parseId(value['id']) }
    case 'set-page-hidden':
      if (typeof value['hidden'] !== 'boolean') throw new Error('Invalid page visibility.')
      return { type: 'set-page-hidden', hidden: value['hidden'] }
    default:
      throw new Error('Unknown capture command.')
  }
}

/** Validate one stored record (index files are untrusted input on read). */
export function parseCaptureRecord(value: unknown): CaptureRecord | null {
  if (!isRecord(value)) return null
  const { id, kind, title, sourceUrl, createdAt, width, height, durationMs, byteLength, groupId, fileName } = value
  if (!isCaptureId(id) || (kind !== 'image' && kind !== 'video')) return null
  if (typeof title !== 'string' || title.length > CAPTURE_LIMITS.titleLength) return null
  if (typeof sourceUrl !== 'string' || sourceUrl.length > CAPTURE_LIMITS.urlLength) return null
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) return null
  if (!finiteIn(width, 1, 20_000) || !finiteIn(height, 1, 20_000) || !finiteIn(byteLength, 1, CAPTURE_LIMITS.videoBytes * 2)) return null
  if (durationMs !== undefined && !finiteIn(durationMs, 0, CAPTURE_LIMITS.recordingMs + 5_000)) return null
  if (groupId !== null && (typeof groupId !== 'string' || groupId.length === 0 || groupId.length > 128)) return null
  return {
    id, kind, title, sourceUrl, createdAt, width, height, byteLength, groupId,
    ...(typeof durationMs === 'number' ? { durationMs } : {}),
    ...(typeof fileName === 'string' && fileName.length <= 260 ? { fileName } : {}),
  }
}
