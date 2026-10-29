import { sha256Hex } from './event-geography'
import type { FieldSnapshot } from './types'

export const snapshotIdentityVersion = 'field-snapshot-identity-v1' as const

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function canonicalSnapshotPayload(snapshot: Omit<FieldSnapshot, 'id'>): string {
  const content = snapshot as FieldSnapshot
  return canonicalJson({
    identityVersion: snapshotIdentityVersion,
    schema: content.schema,
    algorithm: content.algorithm,
    createdAt: content.createdAt,
    coverageNote: content.coverageNote,
    sources: content.sources,
    bands: content.bands,
  })
}

export function snapshotIdentity(snapshot: Omit<FieldSnapshot, 'id'>): string {
  return `snapshot-v1-${sha256Hex(canonicalSnapshotPayload(snapshot))}`
}
