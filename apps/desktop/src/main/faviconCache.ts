import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Site icons for bookmarks and lists, stored on this Mac as small data URLs.
 * An icon comes from a page you visited (Chromium reports it), or from the
 * site's own /favicon.ico — never from a third-party icon service, and
 * fetched without cookies. Renderers only ever receive data URLs.
 */
const MAX_BYTES = 100_000
const RETRY_MS = 7 * 24 * 3_600_000
const HOST = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i

type Entry = { data: string | null; at: number }

export function isIconHost(host: string): boolean {
  return HOST.test(host) && !/^(localhost|.*\.local|.*\.internal)$/i.test(host)
}

export class FaviconCache {
  private readonly entries = new Map<string, Entry>()
  private readonly inflight = new Map<string, Promise<void>>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly file: string, private readonly fetchImpl: typeof fetch = fetch) {
    try {
      if (existsSync(file)) {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Entry>
        for (const [host, entry] of Object.entries(raw)) if (isIconHost(host) && entry && typeof entry.at === 'number') this.entries.set(host, entry)
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
    void this.fetchIcon(iconUrl).then((data) => { if (data) this.set(host, data) })
  }

  /** Icons for these hosts: cached ones at once; missing ones fetched from the site's /favicon.ico first. */
  async get(hosts: string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(hosts.filter(isIconHost))].slice(0, 300)
    const now = Date.now()
    const missing = wanted.filter((host) => {
      const entry = this.entries.get(host)
      return !entry || (!entry.data && now - entry.at > RETRY_MS)
    })
    for (let i = 0; i < missing.length; i += 6) {
      await Promise.all(missing.slice(i, i + 6).map((host) => this.load(host)))
    }
    const out: Record<string, string> = {}
    for (const host of wanted) {
      const data = this.entries.get(host)?.data
      if (data) out[host] = data
    }
    return out
  }

  private load(host: string): Promise<void> {
    const existing = this.inflight.get(host)
    if (existing) return existing
    const job = (async () => {
      const data = await this.fetchIcon(`https://${host}/favicon.ico`)
        ?? (host.startsWith('www.') ? null : await this.fetchIcon(`https://www.${host}/favicon.ico`))
      this.entries.set(host, { data, at: Date.now() })
      this.scheduleSave()
    })().finally(() => this.inflight.delete(host))
    this.inflight.set(host, job)
    return job
  }

  private async fetchIcon(url: string): Promise<string | null> {
    try {
      const response = await this.fetchImpl(url, { redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(5_000), headers: { accept: 'image/*' } })
      if (!response.ok) return null
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > MAX_BYTES) return null
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return null
      const mime = type.startsWith('image/') ? type : sniff(bytes)
      if (!mime) return null
      return `data:${mime};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }

  private set(host: string, data: string): void {
    this.entries.set(host, { data, at: Date.now() })
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.entries)), { encoding: 'utf8', mode: 0o600 })
      } catch {
        // Best effort.
      }
    }, 2_000)
    this.saveTimer.unref?.()
  }
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
