import { createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { canonicalBeaconUrl, signingText, validateBeacon, type SignedRequest } from '@intoponet/beacon-core'
import type { BeaconDraft, BeaconPreview, BeaconReportKind, BeaconResource, BeaconState, PublishedBeacon } from '@intoponet/browser-api'
import { RETIRED_BEACON_REGISTRIES } from './defaults'

/**
 * Beacon publisher (PRD §7 "the only component allowed to transmit a
 * user-approved contribution"). It sends exactly the validated payload the
 * person saw on the consent screen, signed with an anonymous key made on this
 * device. The key is kept encrypted by the OS keychain; it is not tied to any
 * account and the registry never publishes it.
 */
export type SecretBox = { available: () => boolean; seal: (text: string) => Buffer; open: (sealed: Buffer) => string }

type Files = { key: string; settings: string; published: string }

/** Registry addresses: https anywhere, or http on this computer for development. */
export function normalizeRegistry(value: string): string | null {
  const raw = value.trim().replace(/\/+$/, '')
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
    if (url.username || url.password || url.search || url.hash) return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export class BeaconPublisher {
  private key: { privateKey: KeyObject; publisherKey: string } | null = null

  constructor(private readonly options: { files: Files; box: SecretBox; fetchImpl?: typeof fetch; defaultRegistry?: string; now?: () => number }) {}

  private load<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T
    } catch {
      return fallback
    }
  }

  private write(file: string, value: unknown): void {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
  }

  registry(): string {
    const stored = this.load<{ registry?: string }>(this.options.files.settings, {}).registry
    const saved = stored !== undefined && RETIRED_BEACON_REGISTRIES.includes(normalizeRegistry(stored) ?? '') ? undefined : stored
    return normalizeRegistry(saved ?? this.options.defaultRegistry ?? '') ?? ''
  }

  state(): BeaconState {
    return { registry: this.registry(), published: this.load<PublishedBeacon[]>(this.options.files.published, []), canSign: this.options.box.available() }
  }

  setRegistry(url: string): BeaconState {
    const registry = normalizeRegistry(url)
    if (registry === null) throw new Error('Use an https:// address for the beacon registry (http://localhost is allowed for testing).')
    this.write(this.options.files.settings, { registry })
    return this.state()
  }

  /** Exactly what would leave this device, or why it can't. */
  preview(draft: BeaconDraft): BeaconPreview {
    const checked = validateBeacon(draft)
    if (!checked.ok) return { ok: false, reason: checked.reason }
    return { ok: true, payload: checked.payload as unknown as Record<string, unknown>, json: JSON.stringify(checked.payload, null, 2) }
  }

  private signer(): { privateKey: KeyObject; publisherKey: string } {
    if (this.key) return this.key
    if (!this.options.box.available()) throw new Error('On-device encryption is unavailable, so a beacon key cannot be kept safely. Nothing was sent.')
    let pem: string | null = null
    try {
      pem = this.options.box.open(readFileSync(this.options.files.key))
    } catch {
      pem = null
    }
    if (!pem) {
      const pair = generateKeyPairSync('ed25519')
      pem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
      mkdirSync(dirname(this.options.files.key), { recursive: true })
      writeFileSync(this.options.files.key, this.options.box.seal(pem), { mode: 0o600 })
    }
    const privateKey = createPrivateKey(pem)
    const publisherKey = (privateKey.export({ format: 'jwk' }) as { x: string }).x
    this.key = { privateKey, publisherKey }
    return this.key
  }

  private signed<T>(kind: SignedRequest<T>['kind'], body: T): SignedRequest<T> {
    const { privateKey, publisherKey } = this.signer()
    const at = new Date((this.options.now ?? Date.now)()).toISOString()
    const nonce = randomBytes(18).toString('base64url')
    const signature = sign(null, Buffer.from(signingText(kind, body, publisherKey, at, nonce)), privateKey).toString('base64url')
    return { kind, body, publisherKey, at, nonce, signature }
  }

  private async call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> {
    const registry = this.registry()
    if (!registry) throw new Error('No beacon registry is set up yet. Add its address in Settings › Beacons.')
    const response = await (this.options.fetchImpl ?? fetch)(`${registry}${path}`, {
      method: init.method,
      headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      // Beacons never carry cookies or other browsing state.
      credentials: 'omit',
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? `The registry answered ${response.status}.`)
    return body
  }

  async publish(draft: BeaconDraft): Promise<PublishedBeacon> {
    const checked = validateBeacon(draft)
    if (!checked.ok) throw new Error(checked.reason)
    const result = await this.call('/v1/beacons', { method: 'POST', body: this.signed('publish', checked.payload) }) as { id: string }
    const record: PublishedBeacon = { id: result.id, url: checked.payload.url, title: checked.payload.title, publishedAt: new Date((this.options.now ?? Date.now)()).toISOString(), registry: this.registry() }
    this.write(this.options.files.published, [record, ...this.state().published.filter((item) => item.id !== record.id)])
    return record
  }

  async withdraw(id: string): Promise<BeaconState> {
    const record = this.state().published.find((item) => item.id === id)
    if (!record) throw new Error('That beacon is not one this Mac published.')
    await this.call(`/v1/beacons/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: this.signed('withdraw', { id }) })
    this.write(this.options.files.published, this.state().published.filter((item) => item.id !== id))
    return this.state()
  }

  async report(url: string, kind: BeaconReportKind, text?: string): Promise<void> {
    const canonical = canonicalBeaconUrl(url)
    if (!canonical) throw new Error('That address cannot be reported.')
    await this.call('/v1/reports', { method: 'POST', body: this.signed('report', { url: canonical, kind, ...(text ? { text } : {}) }) })
  }

  async read(filter: { topic?: string; bbox?: [number, number, number, number] } = {}): Promise<BeaconResource[]> {
    const params = new URLSearchParams({ limit: '60' })
    if (filter.topic) params.set('topic', filter.topic)
    if (filter.bbox) params.set('bbox', filter.bbox.join(','))
    const body = await this.call(`/v1/beacons?${params}`, { method: 'GET' }) as { resources?: BeaconResource[] }
    return body.resources ?? []
  }
}
