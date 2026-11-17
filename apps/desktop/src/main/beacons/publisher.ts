import { createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { canonicalBeaconUrl, signingText, validateBeacon, type SignedRequest } from '@intoponet/beacon-core'
import type { BeaconDraft, BeaconPreview, BeaconReportKind, BeaconResource, BeaconState, PublishedBeacon } from '@intoponet/browser-api'
import { RETIRED_BEACON_REGISTRIES } from './defaults'
import { writeFileAtomic } from '../atomicFile'
import { readBoundedPublicJson } from '../boundedPublicJson'

/**
 * Beacon publisher (PRD §7 "the only component allowed to transmit a
 * user-approved contribution"). It sends exactly the validated payload the
 * person saw on the consent screen, signed with an anonymous key made on this
 * device. The key is kept encrypted by the OS keychain; it is not tied to any
 * account and the registry never publishes it.
 */
export type SecretBox = {
  available: () => boolean | Promise<boolean>
  seal: (text: string) => Buffer | Promise<Buffer>
  open: (sealed: Buffer) => string | Promise<string>
}

/** Registry answers are small; anything larger is refused rather than read into memory. */
const MAX_REGISTRY_BYTES = 1024 * 1024
const MAX_RESOURCES = 60
/** The most the registry gives in one answer, and how long that answer serves every place looked at. */
const PUBLIC_LIST_LIMIT = 100
const PUBLIC_LIST_KEPT_MS = 10 * 60_000

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** The record of beacons this Mac published, dropping anything malformed. */
export function parsePublished(value: unknown): PublishedBeacon[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): PublishedBeacon[] => {
    if (!item || typeof item !== 'object') return []
    const { id, url, title, publishedAt, registry } = item as Record<string, unknown>
    if (!isText(id, 80) || !id || !isText(url, 2048) || !isText(title, 400) || !isText(publishedAt, 40) || !isText(registry, 500)) return []
    return [{ id, url, title, publishedAt, registry }]
  })
}

function parsePlace(value: unknown): { label: string; lat: number; lon: number } | null {
  if (!value || typeof value !== 'object') return null
  const { label, lat, lon } = value as Record<string, unknown>
  if (!isText(label, 300) || !isNumber(lat) || !isNumber(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { label, lat, lon }
}

/** A registry resource as the app shows it, or null when it is not one. */
export function parseResource(value: unknown): BeaconResource | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!isText(v['url'], 2048) || !/^https?:\/\//i.test(v['url']) || !isText(v['title'], 400) || !isText(v['topic'], 200)) return null
  if (v['note'] !== undefined && v['note'] !== null && !isText(v['note'], 1000)) return null
  if (!isText(v['publishers'], 200) || !isNumber(v['prominence']) || !isText(v['firstAt'], 40) || !isText(v['lastAt'], 40)) return null
  const places = (Array.isArray(v['places']) ? v['places'] : []).slice(0, 200).map(parsePlace).filter((place) => place !== null)
  let contested: BeaconResource['contested'] = null
  if (v['contested'] !== null && v['contested'] !== undefined) {
    const c = v['contested'] as Record<string, unknown>
    if (typeof c !== 'object' || !isNumber(c['count'])) return null
    contested = { count: c['count'], notes: (Array.isArray(c['notes']) ? c['notes'] : []).filter((note): note is string => isText(note, 1000)).slice(0, 20) }
  }
  return {
    url: v['url'], title: v['title'], topic: v['topic'],
    ...(typeof v['note'] === 'string' ? { note: v['note'] } : {}),
    places, publishers: v['publishers'], prominence: v['prominence'], firstAt: v['firstAt'], lastAt: v['lastAt'], contested,
  }
}

const isMissing = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'

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
  private keyLoading: Promise<{ privateKey: KeyObject; publisherKey: string }> | null = null
  private listed: { registry: string; at: number; resources: Promise<BeaconResource[]> } | null = null

  constructor(private readonly options: { files: Files; box: SecretBox; fetchImpl?: typeof fetch; defaultRegistry?: string; now?: () => number }) {}

  private load<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T
    } catch {
      return fallback
    }
  }

  private async write(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(value))
  }

  private published(): PublishedBeacon[] {
    return parsePublished(this.load<unknown>(this.options.files.published, []))
  }

  registry(): string {
    const stored = this.load<{ registry?: string }>(this.options.files.settings, {}).registry
    const saved = stored !== undefined && RETIRED_BEACON_REGISTRIES.includes(normalizeRegistry(stored) ?? '') ? undefined : stored
    return normalizeRegistry(saved ?? this.options.defaultRegistry ?? '') ?? ''
  }

  async state(): Promise<BeaconState> {
    return { registry: this.registry(), published: this.published(), canSign: await this.available() }
  }

  private async available(): Promise<boolean> {
    try {
      return await this.options.box.available()
    } catch {
      return false
    }
  }

  async setRegistry(url: string): Promise<BeaconState> {
    const registry = normalizeRegistry(url)
    if (registry === null) throw new Error('Use an https:// address for the beacon registry (http://localhost is allowed for testing).')
    await this.write(this.options.files.settings, { registry })
    return this.state()
  }

  /** Exactly what would leave this device, or why it can't. */
  preview(draft: BeaconDraft): BeaconPreview {
    const checked = validateBeacon(draft)
    if (!checked.ok) return { ok: false, reason: checked.reason }
    return { ok: true, payload: checked.payload as unknown as Record<string, unknown>, json: JSON.stringify(checked.payload, null, 2) }
  }

  /**
   * The anonymous signing key. It is made once, only when there is no key file yet: a key the
   * Keychain will not unlock (access denied, Keychain locked) is reported and left untouched, so
   * beacons published with it can still be withdrawn once access is allowed. A failure is not
   * remembered; the next attempt tries again.
   */
  private signer(): Promise<{ privateKey: KeyObject; publisherKey: string }> {
    if (this.key) return Promise.resolve(this.key)
    this.keyLoading ??= this.loadKey().then((key) => {
      this.key = key
      return key
    }).finally(() => { this.keyLoading = null })
    return this.keyLoading
  }

  private async loadKey(): Promise<{ privateKey: KeyObject; publisherKey: string }> {
    if (!(await this.available())) throw new Error('On-device encryption is unavailable, so a beacon key cannot be kept safely. Nothing was sent.')
    const file = this.options.files.key
    let sealed: Buffer | null
    try {
      sealed = await readFile(file)
    } catch (error) {
      if (!isMissing(error)) throw new Error('This Mac\'s beacon key could not be read. Nothing was sent, and the key was left as it is.')
      sealed = null
    }
    let pem: string
    if (sealed) {
      try {
        pem = await this.options.box.open(sealed)
        if (!pem) throw new Error('empty')
      } catch {
        throw new Error('The macOS Keychain did not unlock this Mac\'s beacon key. Allow Intoponet to use it and try again. Nothing was sent, and the key was left as it is.')
      }
    } else {
      pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
      await mkdir(dirname(file), { recursive: true })
      await writeFileAtomic(file, await this.options.box.seal(pem))
    }
    let privateKey: KeyObject
    try {
      privateKey = createPrivateKey(pem)
    } catch {
      throw new Error('This Mac\'s beacon key is damaged. Nothing was sent, and the key was left as it is.')
    }
    const publisherKey = (privateKey.export({ format: 'jwk' }) as { x: string }).x
    return { privateKey, publisherKey }
  }

  private async signed<T>(kind: SignedRequest<T>['kind'], body: T): Promise<SignedRequest<T>> {
    const { privateKey, publisherKey } = await this.signer()
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
    const body = await readBoundedPublicJson(response, MAX_REGISTRY_BYTES).catch(() => ({})) as unknown
    const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
    if (!response.ok) throw new Error(typeof error === 'string' && error ? error.slice(0, 300) : `The registry answered ${response.status}.`)
    return body
  }

  async publish(draft: BeaconDraft): Promise<PublishedBeacon> {
    const checked = validateBeacon(draft)
    if (!checked.ok) throw new Error(checked.reason)
    const result = await this.call('/v1/beacons', { method: 'POST', body: await this.signed('publish', checked.payload) })
    const id = result && typeof result === 'object' ? (result as { id?: unknown }).id : undefined
    if (!isText(id, 80) || !id) throw new Error('The registry gave an unexpected answer. The beacon may have been published; check the registry before trying again.')
    const record: PublishedBeacon = { id, url: checked.payload.url, title: checked.payload.title, publishedAt: new Date((this.options.now ?? Date.now)()).toISOString(), registry: this.registry() }
    await this.write(this.options.files.published, [record, ...this.published().filter((item) => item.id !== record.id)])
    return record
  }

  async withdraw(id: string): Promise<BeaconState> {
    const record = this.published().find((item) => item.id === id)
    if (!record) throw new Error('That beacon is not one this Mac published.')
    await this.call(`/v1/beacons/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: await this.signed('withdraw', { id }) })
    await this.write(this.options.files.published, this.published().filter((item) => item.id !== id))
    return this.state()
  }

  async report(url: string, kind: BeaconReportKind, text?: string): Promise<void> {
    const canonical = canonicalBeaconUrl(url)
    if (!canonical) throw new Error('That address cannot be reported.')
    await this.call('/v1/reports', { method: 'POST', body: await this.signed('report', { url: canonical, kind, ...(text ? { text } : {}) }) })
  }

  /**
   * The registry's public list, asked for without saying why: at most once in ten minutes, however many
   * places are looked at. A failed request is not kept, so the next look asks again.
   */
  private publicList(): Promise<BeaconResource[]> {
    const registry = this.registry()
    const now = (this.options.now ?? Date.now)()
    const kept = this.listed
    if (kept && kept.registry === registry && now - kept.at < PUBLIC_LIST_KEPT_MS) return kept.resources
    const resources = this.call(`/v1/beacons?limit=${PUBLIC_LIST_LIMIT}`, { method: 'GET' }).then((body) => {
      const list = body && typeof body === 'object' ? (body as { resources?: unknown }).resources : undefined
      return (Array.isArray(list) ? list : []).slice(0, PUBLIC_LIST_LIMIT).map(parseResource).filter((item) => item !== null)
    })
    const entry = { registry, at: now, resources }
    this.listed = entry
    resources.catch(() => { if (this.listed === entry) this.listed = null })
    return resources
  }

  /**
   * Beacons for a place (`bbox`: minLat, minLon, maxLat, maxLon) are picked out on this Mac from the
   * registry's public list. The place is never sent: selecting somewhere on the globe must not tell the
   * registry where the person is looking.
   */
  async read(filter: { topic?: string; bbox?: [number, number, number, number] } = {}): Promise<BeaconResource[]> {
    if (filter.bbox) {
      const [minLat, minLon, maxLat, maxLon] = filter.bbox
      const topic = filter.topic?.toLowerCase()
      return (await this.publicList())
        .filter((item) => (!topic || item.topic.toLowerCase() === topic) && item.places.some((place) => place.lat >= minLat && place.lat <= maxLat && place.lon >= minLon && place.lon <= maxLon))
        .slice(0, MAX_RESOURCES)
    }
    const params = new URLSearchParams({ limit: '60' })
    if (filter.topic) params.set('topic', filter.topic)
    const body = await this.call(`/v1/beacons?${params}`, { method: 'GET' })
    const resources = body && typeof body === 'object' ? (body as { resources?: unknown }).resources : undefined
    return (Array.isArray(resources) ? resources : []).slice(0, MAX_RESOURCES).map(parseResource).filter((item) => item !== null)
  }
}
