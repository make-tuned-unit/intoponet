/**
 * Requests are signed with an Ed25519 key made on the publisher's device. The
 * key is anonymous: it is not linked to an account, and the registry never
 * publishes it. It lets the same device withdraw its beacons and lets the
 * registry rate-limit per device.
 */
export type SignedRequest<T> = {
  kind: 'publish' | 'withdraw' | 'report'
  body: T
  /** Base64url raw 32-byte Ed25519 public key. */
  publisherKey: string
  /** ISO time; the registry rejects requests more than 5 minutes off. */
  at: string
  /** Random string; the registry rejects reuse. */
  nonce: string
  /** Base64url Ed25519 signature of signingText(kind, body, publisherKey, at, nonce). */
  signature: string
}

/** JSON with sorted keys at every level, so both sides sign identical bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function signingText(kind: SignedRequest<unknown>['kind'], body: unknown, publisherKey: string, at: string, nonce: string): string {
  return `intoponet-beacon-v1\n${kind}\n${publisherKey}\n${at}\n${nonce}\n${canonicalJson(body)}`
}

export const CLOCK_SKEW_MS = 5 * 60_000
