import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SitePermissionDecision, SitePermissionEvent, SitePermissionKind, SitePermissionMap, SitePermissionRequest } from '@intoponet/browser-api'

/** Chromium permissions granted without asking: harmless, and expected by ordinary pages. */
const ALWAYS_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock'])

/**
 * What a Chromium permission request is asking for, in our terms. null means
 * "never grant" (anything not listed: MIDI, USB, serial, window management, …).
 */
export function kindsFor(permission: string, mediaTypes: readonly string[] = []): SitePermissionKind[] | 'always' | null {
  if (ALWAYS_ALLOW.has(permission)) return 'always'
  switch (permission) {
    case 'media': {
      const kinds: SitePermissionKind[] = []
      if (mediaTypes.includes('video')) kinds.push('camera')
      if (mediaTypes.includes('audio')) kinds.push('microphone')
      return kinds.length ? kinds : ['camera', 'microphone']
    }
    case 'geolocation': return ['location']
    case 'notifications': return ['notifications']
    case 'clipboard-read': return ['clipboard-read']
    default: return null
  }
}

/** "https://meet.google.com/abc" → "https://meet.google.com"; null for anything not http(s). */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null
  } catch {
    return null
  }
}

type Saved = Record<string, SitePermissionMap>

/** Remembered answers per origin. A file for normal browsing; memory only for private tabs. */
export class SitePermissionStore {
  private data: Saved = {}
  constructor(private readonly file: string | null) {
    if (!file) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (raw && typeof raw === 'object') this.data = raw as Saved
    } catch {
      // No saved answers yet.
    }
  }
  get(origin: string): SitePermissionMap {
    return { ...(this.data[origin] ?? {}) }
  }
  set(origin: string, kinds: SitePermissionKind[], decision: SitePermissionDecision): void {
    this.data[origin] = { ...(this.data[origin] ?? {}), ...Object.fromEntries(kinds.map((kind) => [kind, decision])) }
    this.save()
  }
  reset(origin: string, kind?: SitePermissionKind): void {
    if (!kind) delete this.data[origin]
    else if (this.data[origin]) {
      delete this.data[origin][kind]
      if (Object.keys(this.data[origin]).length === 0) delete this.data[origin]
    }
    this.save()
  }
  clear(): void {
    this.data = {}
    this.save()
  }
  private save(): void {
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 })
    } catch {
      // Answers still apply for this session.
    }
  }
}

type Pending = { request: SitePermissionRequest; callbacks: Array<(granted: boolean) => void>; owner: number; timer: ReturnType<typeof setTimeout> }

/**
 * Turns Chromium permission requests into one prompt per site and request,
 * answered by the user. Stored answers apply at once; unanswered prompts are
 * declined after `timeoutMs`.
 */
export class SitePermissionBroker {
  private pending = new Map<string, Pending>()

  constructor(private readonly options: {
    store: (isPrivate: boolean) => SitePermissionStore
    emit: (event: SitePermissionEvent) => void
    /** Ask macOS for camera/microphone access the first time a site is allowed them. */
    systemAccess?: (kind: 'camera' | 'microphone') => Promise<boolean>
    timeoutMs?: number
  }) {}

  /** Answer from storage if possible: true/false, or null when the user must be asked. */
  check(origin: string | null, kinds: SitePermissionKind[] | 'always' | null, isPrivate: boolean): boolean | null {
    if (kinds === 'always') return true
    if (!kinds || !origin) return false
    const saved = this.options.store(isPrivate).get(origin)
    if (kinds.some((kind) => saved[kind] === 'block')) return false
    if (kinds.every((kind) => saved[kind] === 'allow')) return true
    return null
  }

  request(input: { origin: string | null; kinds: SitePermissionKind[] | 'always' | null; isPrivate: boolean; owner: number }, callback: (granted: boolean) => void): void {
    const known = this.check(input.origin, input.kinds, input.isPrivate)
    if (known !== null || !input.origin || !Array.isArray(input.kinds)) {
      callback(known === true)
      return
    }
    const kinds = input.kinds
    // The same site asking again while a prompt is open joins that prompt.
    const same = [...this.pending.values()].find((item) => item.owner === input.owner && item.request.origin === input.origin && item.request.kinds.join() === kinds.join())
    if (same) {
      same.callbacks.push(callback)
      return
    }
    const request: SitePermissionRequest = { id: randomUUID(), origin: input.origin, kinds, isPrivate: input.isPrivate }
    const timer = setTimeout(() => this.finish(request.id, false), this.options.timeoutMs ?? 120_000)
    timer.unref?.()
    this.pending.set(request.id, { request, callbacks: [callback], owner: input.owner, timer })
    this.options.emit({ type: 'request', request })
  }

  async decide(id: string, decision: SitePermissionDecision | 'dismiss'): Promise<void> {
    const item = this.pending.get(id)
    if (!item) return
    const { origin, kinds, isPrivate } = item.request
    if (decision !== 'dismiss') {
      this.options.store(isPrivate).set(origin, kinds, decision)
      this.options.emit({ type: 'changed', origin })
    }
    let granted = decision === 'allow'
    if (granted && this.options.systemAccess) {
      for (const kind of kinds) {
        if ((kind === 'camera' || kind === 'microphone') && !(await this.options.systemAccess(kind).catch(() => false))) granted = false
      }
    }
    this.finish(id, granted)
  }

  /** A page navigated away or closed: its open prompts no longer apply. */
  dropOwner(owner: number): void {
    for (const [id, item] of this.pending) if (item.owner === owner) this.finish(id, false)
  }

  list(): SitePermissionRequest[] {
    return [...this.pending.values()].map((item) => item.request)
  }

  private finish(id: string, granted: boolean): void {
    const item = this.pending.get(id)
    if (!item) return
    clearTimeout(item.timer)
    this.pending.delete(id)
    for (const callback of item.callbacks) callback(granted)
    this.options.emit({ type: 'resolved', id })
  }
}
