import { randomUUID } from 'node:crypto'
import type { BrowsingEvent, ExternalOpenRequest } from '@intoponet/browser-api'

/**
 * Links to other apps (mailto:, tel:, facetime:, zoommtg:, slack:, spotify:…). A page never opens
 * another app by itself: the shell asks "Open <app>?" first, one prompt at a time, and only for
 * schemes that hand a link to an app. Anything that reaches into the Mac itself (files, scripts,
 * network shares, Terminal) is refused outright.
 */

/** Longest address handed to another app (a long mailto: body still fits). */
export const MAX_EXTERNAL_URL_LENGTH = 4_096

/**
 * Never handed to another app. Web addresses load in the tab; the rest reach local files, run
 * script, mount network volumes, open Terminal or install software, which no web page should start.
 */
export const BLOCKED_EXTERNAL_SCHEMES: ReadonlySet<string> = new Set([
  // Handled by the browser itself, or not a link at all.
  'http', 'https', 'ws', 'wss', 'file', 'javascript', 'data', 'blob', 'about', 'filesystem',
  'chrome', 'chrome-extension', 'chrome-untrusted', 'chrome-error', 'chrome-search', 'devtools', 'view-source',
  'intoponet-capture', 'electron', 'jar', 'vbscript',
  // Network volumes and remote shells (Finder mounts them; Terminal opens them).
  'ftp', 'ftps', 'sftp', 'smb', 'afp', 'nfs', 'cifs', 'vnc', 'ssh', 'telnet', 'rlogin', 'x-man-page',
  // Scripts, automation, installers, local help.
  'applescript', 'shortcuts', 'workflow', 'terminal', 'help', 'itms-services', 'x-apple-helpbasic',
  // Windows equivalents (harmless here, refused anyway).
  'ms-msdt', 'search-ms', 'ms-officecmd', 'ms-cxh', 'ms-cxh-full',
])

export type ExternalTarget =
  | { kind: 'web' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'external'; scheme: string; href: string }

/** What a navigation to `value` means: a web page, another app, or something refused. */
export function classifyExternalUrl(value: string): ExternalTarget {
  if (typeof value !== 'string' || value.length === 0) return { kind: 'blocked', reason: 'empty' }
  if (value.length > MAX_EXTERNAL_URL_LENGTH) return { kind: 'blocked', reason: 'too long' }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { kind: 'blocked', reason: 'invalid' }
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if (scheme === 'http' || scheme === 'https') return { kind: 'web' }
  if (!/^[a-z][a-z0-9+.-]{0,39}$/.test(scheme)) return { kind: 'blocked', reason: 'invalid scheme' }
  if (BLOCKED_EXTERNAL_SCHEMES.has(scheme)) return { kind: 'blocked', reason: `${scheme}: is not opened from web pages` }
  if (url.username || url.password) return { kind: 'blocked', reason: 'credentials' }
  const href = url.href
  if (href.length > MAX_EXTERNAL_URL_LENGTH) return { kind: 'blocked', reason: 'too long' }
  // Control characters have no place in a link handed to another app.
  if (/[\u0000-\u001f\u007f]/.test(href)) return { kind: 'blocked', reason: 'control characters' }
  return { kind: 'external', scheme, href }
}

/** "https://zoom.us/j/1" → "https://zoom.us"; '' for anything that is not a web page. */
export function siteOf(pageUrl: string): string {
  try {
    const url = new URL(pageUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : ''
  } catch {
    return ''
  }
}

/** Shortened for the prompt: "mailto:someone@example.com?subject=…". */
export function displayTarget(href: string, max = 120): string {
  let shown = href
  try { shown = decodeURI(href) } catch { /* keep encoded */ }
  shown = shown.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
  return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown
}

type Remembered = Record<string, string[]>

/** Parses the remembered (site → schemes) file; anything malformed is dropped. */
export function parseRemembered(raw: unknown): Remembered {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const result: Remembered = {}
  for (const [site, schemes] of Object.entries(raw as Record<string, unknown>).slice(0, 1_000)) {
    if (!siteOf(site) || siteOf(site) !== site || !Array.isArray(schemes)) continue
    const valid = schemes.filter((scheme): scheme is string => typeof scheme === 'string' && classifyExternalUrl(`${scheme}:x`).kind === 'external').slice(0, 50)
    if (valid.length) result[site] = [...new Set(valid)]
  }
  return result
}

type Pending = { request: ExternalOpenRequest; href: string; owner: number; timer: ReturnType<typeof setTimeout> }

export type ExternalOpenResult = 'opened' | 'prompted' | 'web' | 'blocked' | 'no-app' | 'dropped'

export type ExternalOpenOptions = {
  emit: (event: BrowsingEvent) => void
  openExternal: (href: string) => Promise<void>
  /** The app that opens this link ("Mail"), or '' when none does. */
  appName: (href: string) => string
  /** Remembered "Always allow" answers, as saved; null when nothing is saved. */
  remembered?: unknown
  save?: (data: string) => void
  now?: () => number
  /** Unanswered prompts are cancelled after this long. */
  timeoutMs?: number
}

/** Prompts per page: at most this many in a minute, and none for a while after "Cancel". */
const PER_PAGE_PER_MINUTE = 4
const AFTER_CANCEL_MS = 5_000
/** Remembered sites still open apps at most this often per page. */
const OPENS_PER_PAGE_PER_10S = 3
const MAX_WAITING = 4

/** Asks before a page opens another app; remembers "Always allow" per (site, scheme) outside private tabs. */
export class ExternalOpenBroker {
  private readonly pending = new Map<string, Pending>()
  private readonly asked = new Map<number, number[]>()
  private readonly opened = new Map<number, number[]>()
  private readonly quietUntil = new Map<number, number>()
  private remembered: Remembered

  constructor(private readonly options: ExternalOpenOptions) {
    this.remembered = parseRemembered(options.remembered ?? null)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /** Times within `windowMs`, newest last (old ones dropped). */
  private recent(map: Map<number, number[]>, owner: number, windowMs: number): number[] {
    const now = this.now()
    const times = (map.get(owner) ?? []).filter((time) => now - time < windowMs)
    map.set(owner, times)
    return times
  }

  isRemembered(site: string, scheme: string): boolean {
    return !!site && (this.remembered[site]?.includes(scheme) ?? false)
  }

  /** A page (`owner`, showing `pageUrl`) wants to open `href`. */
  request(input: { href: string; pageUrl: string; isPrivate: boolean; owner: number }): ExternalOpenResult {
    const target = classifyExternalUrl(input.href)
    if (target.kind === 'web') return 'web'
    if (target.kind === 'blocked') return 'blocked'
    const site = siteOf(input.pageUrl)
    const appName = this.options.appName(target.href)
    if (!appName) return 'no-app'
    if (!input.isPrivate && this.isRemembered(site, target.scheme)) {
      const opens = this.recent(this.opened, input.owner, 10_000)
      if (opens.length >= OPENS_PER_PAGE_PER_10S) return 'dropped'
      opens.push(this.now())
      void this.options.openExternal(target.href).catch(() => undefined)
      return 'opened'
    }
    // One prompt per page at a time, a few a minute at most, and a pause after "Cancel".
    if ([...this.pending.values()].some((item) => item.owner === input.owner)) return 'dropped'
    if (this.pending.size >= MAX_WAITING) return 'dropped'
    if ((this.quietUntil.get(input.owner) ?? 0) > this.now()) return 'dropped'
    const asks = this.recent(this.asked, input.owner, 60_000)
    if (asks.length >= PER_PAGE_PER_MINUTE) return 'dropped'
    asks.push(this.now())
    const request: ExternalOpenRequest = {
      id: randomUUID(),
      scheme: target.scheme,
      appName,
      site,
      target: displayTarget(target.href),
      isPrivate: input.isPrivate,
    }
    const timer = setTimeout(() => this.resolve(request.id, 'cancel', false, false), this.options.timeoutMs ?? 60_000)
    ;(timer as { unref?: () => void }).unref?.()
    this.pending.set(request.id, { request, href: target.href, owner: input.owner, timer })
    this.options.emit({ type: 'external-request', request })
    return 'prompted'
  }

  /** The person answered the prompt. */
  decide(id: string, decision: 'open' | 'cancel', always: boolean): void {
    this.resolve(id, decision, always, true)
  }

  private resolve(id: string, decision: 'open' | 'cancel', always: boolean, byPerson: boolean): void {
    const item = this.pending.get(id)
    if (!item) return
    clearTimeout(item.timer)
    this.pending.delete(id)
    this.options.emit({ type: 'external-resolved', id })
    if (decision === 'cancel') {
      if (byPerson) this.quietUntil.set(item.owner, this.now() + AFTER_CANCEL_MS)
      return
    }
    if (always && !item.request.isPrivate && item.request.site) this.remember(item.request.site, item.request.scheme)
    void this.options.openExternal(item.href).catch(() => undefined)
  }

  private remember(site: string, scheme: string): void {
    const schemes = this.remembered[site] ?? []
    if (schemes.includes(scheme)) return
    this.remembered = { ...this.remembered, [site]: [...schemes, scheme] }
    try { this.options.save?.(JSON.stringify(this.remembered)) } catch { /* applies this session */ }
  }

  /** Forget "Always allow" for a site (or every site). */
  forget(site?: string): void {
    if (site) {
      const { [site]: _removed, ...rest } = this.remembered
      this.remembered = rest
    } else {
      this.remembered = {}
    }
    try { this.options.save?.(JSON.stringify(this.remembered)) } catch { /* applies this session */ }
  }

  /** The page went away (closed, or navigated): its prompt is withdrawn. */
  dropOwner(owner: number): void {
    for (const [id, item] of this.pending) if (item.owner === owner) this.resolve(id, 'cancel', false, false)
    this.asked.delete(owner)
    this.opened.delete(owner)
    this.quietUntil.delete(owner)
  }

  list(): ExternalOpenRequest[] {
    return [...this.pending.values()].map((item) => item.request)
  }
}
