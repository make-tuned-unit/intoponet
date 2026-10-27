/**
 * Beacons on the desktop (PRD §4.6). The main process is the only part
 * allowed to transmit a beacon, and only after the renderer showed the exact
 * payload and the person agreed (BCN-002).
 */
export const beaconChannels = { command: 'intoponet:beacons' } as const

export type BeaconDraft = {
  url: string
  title: string
  topic: string
  note?: string
  place?: { label: string; lat: number; lon: number }
}

export type PublishedBeacon = { id: string; url: string; title: string; publishedAt: string; registry: string }

export type BeaconState = {
  /** Registry address, or '' when none is set up yet. */
  registry: string
  published: PublishedBeacon[]
  /** False when on-device encryption for the anonymous key is unavailable. */
  canSign: boolean
}

export type BeaconPreview =
  | { ok: true; payload: Record<string, unknown>; json: string }
  | { ok: false; reason: string }

export type BeaconResource = {
  url: string
  title: string
  topic: string
  note?: string
  places: Array<{ label: string; lat: number; lon: number }>
  publishers: string
  prominence: number
  firstAt: string
  lastAt: string
  contested: { count: number; notes: string[] } | null
}

export type BeaconReportKind = 'spam' | 'harmful' | 'misleading' | 'broken' | 'contest'

export type BeaconCommand =
  | { type: 'state' }
  | { type: 'set-registry'; url: string }
  | { type: 'preview'; draft: BeaconDraft }
  | { type: 'publish'; draft: BeaconDraft }
  | { type: 'withdraw'; id: string }
  | { type: 'report'; url: string; kind: BeaconReportKind; text?: string }
  | { type: 'read'; topic?: string; bbox?: [number, number, number, number] }

export interface BeaconApi {
  state(): Promise<BeaconState>
  setRegistry(url: string): Promise<BeaconState>
  preview(draft: BeaconDraft): Promise<BeaconPreview>
  publish(draft: BeaconDraft): Promise<PublishedBeacon>
  withdraw(id: string): Promise<BeaconState>
  report(url: string, kind: BeaconReportKind, text?: string): Promise<void>
  read(filter?: { topic?: string; bbox?: [number, number, number, number] }): Promise<BeaconResource[]>
}

const REPORT_KINDS = new Set(['spam', 'harmful', 'misleading', 'broken', 'contest'])
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

function draftFrom(value: unknown): BeaconDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!text(v['url'], 2048) || !text(v['title'], 400) || !text(v['topic'], 200)) return null
  const draft: BeaconDraft = { url: v['url'], title: v['title'], topic: v['topic'] }
  if (v['note'] !== undefined) {
    if (!text(v['note'], 1000)) return null
    draft.note = v['note']
  }
  if (v['place'] !== undefined) {
    const p = v['place'] as Record<string, unknown> | null
    if (!p || !text(p['label'], 300) || typeof p['lat'] !== 'number' || typeof p['lon'] !== 'number') return null
    draft.place = { label: p['label'], lat: p['lat'], lon: p['lon'] }
  }
  return draft
}

export function parseBeaconCommand(value: unknown): BeaconCommand {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid beacon command.')
  const v = value as Record<string, unknown>
  switch (v['type']) {
    case 'state':
      return { type: 'state' }
    case 'set-registry':
      if (text(v['url'], 500)) return { type: 'set-registry', url: v['url'] }
      break
    case 'preview':
    case 'publish': {
      const draft = draftFrom(v['draft'])
      if (draft) return { type: v['type'], draft }
      break
    }
    case 'withdraw':
      if (text(v['id'], 80)) return { type: 'withdraw', id: v['id'] }
      break
    case 'report':
      if (text(v['url'], 2048) && typeof v['kind'] === 'string' && REPORT_KINDS.has(v['kind']) && (v['text'] === undefined || text(v['text'], 500))) {
        return { type: 'report', url: v['url'], kind: v['kind'] as BeaconReportKind, ...(typeof v['text'] === 'string' ? { text: v['text'] } : {}) }
      }
      break
    case 'read': {
      const bbox = v['bbox']
      if (bbox !== undefined && !(Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => typeof n === 'number' && Number.isFinite(n)))) break
      if (v['topic'] !== undefined && !text(v['topic'], 80)) break
      return { type: 'read', ...(typeof v['topic'] === 'string' ? { topic: v['topic'] } : {}), ...(bbox ? { bbox: bbox as [number, number, number, number] } : {}) }
    }
  }
  throw new Error('Invalid beacon command.')
}
