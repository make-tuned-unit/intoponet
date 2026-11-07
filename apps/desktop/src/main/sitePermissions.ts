import { randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SitePermissionAnswer, SitePermissionDecision, SitePermissionEvent, SitePermissionKind, SitePermissionMap, SitePermissionRequest } from '@intoponet/browser-api'
import type { WebContents } from 'electron'
import { writeFileAtomicSync } from './atomicFile'

/** Page and popup prompts expire with their owning document/process. */
export function bindPermissionOwnerLifecycle(contents: Pick<WebContents, 'id' | 'on' | 'once'>, dropOwner: (owner: number) => void): void {
  const id = contents.id
  contents.on('did-start-navigation', (details) => {
    // Requests currently carry an owner, not a frame ID. Conservatively
    // invalidate that owner's prompts when any frame changes documents.
    if (!details.isSameDocument) dropOwner(id)
  })
  contents.on('did-navigate', () => dropOwner(id))
  contents.on('render-process-gone', () => dropOwner(id))
  contents.once('destroyed', () => dropOwner(id))
}

/**
 * Chromium permissions granted without asking: harmless, and expected by ordinary pages.
 * Fullscreen comes with a notice naming the site and Esc to leave; pointer and keyboard lock
 * (which would take the mouse or Esc away from you) are refused.
 */
const ALWAYS_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write'])

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

/**
 * Where an answer is kept. A site asking as the page you opened is keyed by its origin alone;
 * a frame embedded in another site is keyed by both ("<frame> in <top>"), so allowing
 * meet.example.com in its own tab does not let it use your camera inside some other page.
 * Answers saved before this rule are plain origins, so they keep applying only to top-level use.
 */
export function permissionKey(origin: string, topOrigin?: string | null): string {
  return topOrigin && topOrigin !== origin ? `${origin} in ${topOrigin}` : origin
}

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
      // Atomic: a crash mid-write keeps the previous answers rather than an empty file.
      writeFileAtomicSync(this.file, JSON.stringify(this.data))
    } catch {
      // Answers still apply for this session.
    }
  }
}

type Pending = { request: SitePermissionRequest; scope: string; callbacks: Array<(granted: boolean) => void>; owner: number; timer: ReturnType<typeof setTimeout>; decisionVersion: number; allowing: boolean }

/**
 * Turns Chromium permission requests into one prompt per site and request,
 * answered by the user. Stored answers apply at once; unanswered prompts are
 * declined after `timeoutMs`.
 *
 * `scope` says whose answers these are: 'default' (the shared sign-ins), `ws:<id>` (a workspace with
 * separate sign-ins, which keeps its own file) or private (isPrivate, memory only). A prompt and a
 * remembered answer never cross scopes.
 */
export class SitePermissionBroker {
  private pending = new Map<string, Pending>()

  constructor(private readonly options: {
    store: (isPrivate: boolean, scope: string) => SitePermissionStore
    emit: (event: SitePermissionEvent) => void
    /** Ask macOS for camera/microphone access the first time a site is allowed them. */
    systemAccess?: (kind: 'camera' | 'microphone') => Promise<boolean>
    timeoutMs?: number
  }) {}

  /** Answer from storage if possible: true/false, or null when the user must be asked. */
  check(origin: string | null, kinds: SitePermissionKind[] | 'always' | null, isPrivate: boolean, topOrigin?: string | null, scope = 'default'): boolean | null {
    if (kinds === 'always') return true
    if (!kinds || !origin) return false
    const saved = this.options.store(isPrivate, scope).get(permissionKey(origin, topOrigin))
    if (kinds.some((kind) => saved[kind] === 'block')) return false
    if (kinds.every((kind) => saved[kind] === 'allow')) return true
    return null
  }

  request(input: { origin: string | null; topOrigin?: string | null; kinds: SitePermissionKind[] | 'always' | null; isPrivate: boolean; owner: number; scope?: string }, callback: (granted: boolean) => void): void {
    const scope = input.scope ?? 'default'
    const known = this.check(input.origin, input.kinds, input.isPrivate, input.topOrigin, scope)
    if (known !== null || !input.origin || !Array.isArray(input.kinds)) {
      callback(known === true)
      return
    }
    const kinds = input.kinds
    const key = permissionKey(input.origin, input.topOrigin)
    // The same site asking again while a prompt is open joins that prompt.
    const same = [...this.pending.values()].find((item) => item.owner === input.owner && item.scope === scope && keyOf(item.request) === key && item.request.kinds.join() === kinds.join())
    if (same) {
      same.callbacks.push(callback)
      return
    }
    const embedded = input.topOrigin && input.topOrigin !== input.origin ? { topOrigin: input.topOrigin } : {}
    const request: SitePermissionRequest = { id: randomUUID(), origin: input.origin, ...embedded, kinds, isPrivate: input.isPrivate }
    const timer = setTimeout(() => this.finish(request.id, false), this.options.timeoutMs ?? 120_000)
    timer.unref?.()
    this.pending.set(request.id, { request, scope, callbacks: [callback], owner: input.owner, timer, decisionVersion: 0, allowing: false })
    this.options.emit({ type: 'request', request })
  }

  async decide(id: string, decision: SitePermissionAnswer): Promise<void> {
    const item = this.pending.get(id)
    if (!item) return
    const allows = decision === 'allow' || decision === 'allow-once'
    if (allows && item.allowing) return
    const version = ++item.decisionVersion
    item.allowing = allows
    const { kinds, isPrivate } = item.request
    const { scope } = item
    const key = keyOf(item.request)
    // Only a remembered answer settles the site's other waiting prompts.
    const remembered = decision === 'allow' || decision === 'block'
    if (remembered) {
      for (const [otherId, other] of this.pending) {
        if (otherId !== id && keyOf(other.request) === key && other.request.isPrivate === isPrivate && other.scope === scope
          && other.request.kinds.some((kind) => kinds.includes(kind))) this.finish(otherId, false)
      }
    }
    let granted = allows
    if (granted && this.options.systemAccess) {
      for (const kind of kinds) {
        if ((kind === 'camera' || kind === 'microphone') && !(await this.options.systemAccess(kind).catch(() => false))) granted = false
        // Navigation, reset, teardown or a newer decision invalidates the
        // response even when the OS permission dialog cannot be canceled.
        if (this.pending.get(id) !== item || item.decisionVersion !== version) return
      }
    }
    if (this.pending.get(id) !== item || item.decisionVersion !== version) return
    if (remembered) {
      this.options.store(isPrivate, scope).set(key, kinds, decision)
      this.options.emit({ type: 'changed', origin: item.request.topOrigin ?? item.request.origin })
    }
    this.finish(id, granted)
  }

  /** Reset also invalidates outstanding requests, including an OS prompt. */
  reset(origin: string, isPrivate: boolean, kind?: SitePermissionKind, scope = 'default'): void {
    this.options.store(isPrivate, scope).reset(origin, kind)
    for (const [id, item] of this.pending) {
      if (keyOf(item.request) === origin && item.request.isPrivate === isPrivate && item.scope === scope
        && (!kind || item.request.kinds.includes(kind))) this.finish(id, false)
    }
    this.options.emit({ type: 'changed', origin })
  }

  /** Leaving a private session must invalidate consent still awaiting the OS. */
  clear(isPrivate: boolean, scope = 'default'): void {
    for (const [id, item] of this.pending) if (item.request.isPrivate === isPrivate && item.scope === scope) this.finish(id, false)
    this.options.store(isPrivate, scope).clear()
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

const keyOf = (request: SitePermissionRequest): string => permissionKey(request.origin, request.topOrigin)
