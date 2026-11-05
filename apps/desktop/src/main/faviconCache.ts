import { existsSync, readFileSync } from 'node:fs'
import { writeFileAtomic } from './atomicFile'
import { isIP } from 'node:net'
import { isPrivateAddress } from './publicAddress'

/**
 * Site icons for bookmarks and lists, stored on this Mac as small data URLs.
 * An icon comes from a page you visited (Chromium reports it), or from the
 * site's own /favicon.ico — never from a third-party icon service, and
 * fetched without cookies. Renderers only ever receive data URLs.
 */
const MAX_BYTES = 100_000
const RETRY_MS = 7 * 24 * 3_600_000
/** Hosts kept; the least recently used are dropped beyond this. */
export const MAX_ICON_HOSTS = 1_000
/** A page that keeps changing its icon is fetched at most this often. */
const REMEMBER_COOLDOWN_MS = 30_000
const HOST = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i

type Entry = { data: string | null; at: number }

export function isIconHost(host: string): boolean {
  return HOST.test(host) && !/^(localhost|.*\.local|.*\.internal)$/i.test(host)
}

export class FaviconCache {
  private readonly entries = new Map<string, Entry>()
  private readonly inflight = new Map<string, Promise<void>>()
  /** Page-reported icons: one fetch per host at a time, then a pause before the next. */
  private readonly remembering = new Map<string, number>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly file: string, private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = Date.now) {
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Entry>
        for (const [host, entry] of Object.entries(raw)) {
          if (isIconHost(host) && entry && typeof entry.at === 'number' && (entry.data === null || typeof entry.data === 'string')) this.entries.set(host, entry)
        }
        this.trim()
      }
    } catch {
      // Start empty.
    }
  }

  /** Called when a visited page reports its icon. */
  remember(pageUrl: string, iconUrl: string): void {
    let host: string
    try {
      host = new URL(pageUrl).hostname
    } catch {
      return
    }
    if (!isIconHost(host) || !/^https?:\/\//i.test(iconUrl)) return
    const now = this.now()
    const last = this.remembering.get(host)
    if (last !== undefined && (last === Infinity || now - last < REMEMBER_COOLDOWN_MS)) return
    // Infinity marks a fetch in flight; the cooldown starts when it ends.
    this.remembering.set(host, Infinity)
    void this.fetchIcon(iconUrl)
      .then((data) => { if (data) this.set(host, data) })
      .finally(() => {
        this.remembering.set(host, this.now())
        if (this.remembering.size > 200) {
          const cutoff = this.now() - REMEMBER_COOLDOWN_MS
          for (const [known, at] of this.remembering) if (at !== Infinity && at < cutoff) this.remembering.delete(known)
        }
      })
  }

  /** Icons for these hosts: cached ones at once; missing ones fetched from the site's /favicon.ico first. */
  async get(hosts: string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(hosts.filter(isIconHost))].slice(0, 300)
    const now = this.now()
    const missing = wanted.filter((host) => {
      const entry = this.entries.get(host)
      return !entry || (!entry.data && now - entry.at > RETRY_MS)
    })
    for (let i = 0; i < missing.length; i += 6) {
      await Promise.all(missing.slice(i, i + 6).map((host) => this.load(host)))
    }
    const out: Record<string, string> = {}
    for (const host of wanted) {
      const entry = this.entries.get(host)
      if (!entry) continue
      // Recently used hosts are kept longest.
      this.entries.delete(host)
      this.entries.set(host, entry)
      if (entry.data) out[host] = entry.data
    }
    return out
  }

  private load(host: string): Promise<void> {
    const existing = this.inflight.get(host)
    if (existing) return existing
    const job = (async () => {
      const data = await this.fetchIcon(`https://${host}/favicon.ico`)
        ?? (host.startsWith('www.') ? null : await this.fetchIcon(`https://www.${host}/favicon.ico`))
      this.store(host, { data, at: this.now() })
    })().finally(() => this.inflight.delete(host))
    this.inflight.set(host, job)
    return job
  }

  private async fetchIcon(url: string): Promise<string | null> {
    try {
      // A page reports its own icon address: never fetch from this Mac or the local network.
      if (!publicIconUrl(url)) return null
      const response = await this.fetchImpl(url, { redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(5_000), headers: { accept: 'image/*' } })
      if (response.url && !publicIconUrl(response.url)) {
        await response.body?.cancel().catch(() => undefined)
        return null
      }
      if (!response.ok) return null
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      const bytes = await readAtMost(response, MAX_BYTES)
      if (!bytes?.byteLength) return null
      const mime = type.startsWith('image/') ? type : sniff(bytes)
      if (!mime) return null
      return `data:${mime};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }

  private set(host: string, data: string): void {
    this.store(host, { data, at: this.now() })
  }

  private store(host: string, entry: Entry): void {
    this.entries.delete(host)
    this.entries.set(host, entry)
    this.trim()
    this.scheduleSave()
  }

  /** Drop the least recently used hosts beyond the cap. */
  private trim(): void {
    while (this.entries.size > MAX_ICON_HOSTS) this.entries.delete(this.entries.keys().next().value!)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      // Best effort: a failed save leaves the previous file whole.
      void writeFileAtomic(this.file, JSON.stringify(Object.fromEntries(this.entries))).catch(() => undefined)
    }, 2_000)
    this.saveTimer.unref?.()
  }
}

/** The whole body, or null when it is larger than `limit` (read as a stream, so a huge or endless body is cut off). */
async function readAtMost(response: Response, limit: number): Promise<Buffer | null> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > limit) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Image types by magic bytes (sites often serve favicon.ico without a content type). */
function sniff(bytes: Buffer): string | null {
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'image/x-icon'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.slice(0, 5).toString() === '<?xml' || bytes.slice(0, 4).toString() === '<svg') return 'image/svg+xml'
  if (bytes.slice(8, 12).toString() === 'WEBP') return 'image/webp'
  return null
}

/** An http(s) icon address not on this Mac or a local network (literal private IPs, localhost, .local). */
export function publicIconUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !isIP(host)) return false
    return !isIP(host) || !isPrivateAddress(host)
  } catch {
    return false
  }
}
