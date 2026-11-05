import { randomUUID } from 'node:crypto'
import { isExcludedSite, type HistoryDay, type HistoryPolicy, type HistorySearchResult, type HistoryVisit } from '@intoponet/browser-api'

/**
 * Browsing history for normal tabs. The same rules as the library's recent pages apply: nothing
 * from private tabs, nothing from sites left out, nothing while footprints are off, http(s) pages
 * only, and visits older than the retention window are dropped. The caller seals what `serialize`
 * returns (it is never written as plain text).
 */
export type HistoryStoreOptions = {
  /** Sites left out (Privacy › Sites to leave out). */
  excludedSites: () => readonly string[]
  /** Called after visits change (debounce or seal and save here). */
  onChange?: () => void
  now?: () => number
  maxVisits?: number
}

type StoredHistory = { schema: 'intoponet.history.v1'; policy: HistoryPolicy; visits: HistoryVisit[] }

const DEFAULT_POLICY: HistoryPolicy = { footprints: true, retentionDays: 0 }
/** A reload or a quick return to the same address updates the last visit instead of adding one. */
const SAME_VISIT_MS = 60_000
/** A title that arrives later (single-page apps) still names its visit. */
const TITLE_UPDATE_MS = 10 * 60_000
const DAY_MS = 86_400_000

export function dayKey(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function recordable(url: string): boolean {
  if (url.length > 8_192) return false
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password
  } catch {
    return false
  }
}

export class HistoryStore {
  /** Newest first. */
  private visits: HistoryVisit[] = []
  private policyValue: HistoryPolicy = DEFAULT_POLICY
  private readonly now: () => number
  private readonly maxVisits: number

  constructor(private readonly options: HistoryStoreOptions) {
    this.now = options.now ?? Date.now
    this.maxVisits = options.maxVisits ?? 20_000
  }

  get policy(): HistoryPolicy {
    return this.policyValue
  }

  /** Load a saved payload (unreadable payloads start empty). `keepPolicy`: a policy already set this run wins. */
  load(payload: string | null, keepPolicy = false): void {
    if (!payload) return
    try {
      const raw = JSON.parse(payload) as Partial<StoredHistory>
      if (raw.schema !== 'intoponet.history.v1' || !Array.isArray(raw.visits)) return
      const policy = raw.policy
      if (!keepPolicy && policy && typeof policy.footprints === 'boolean' && [0, 7, 30, 90].includes(policy.retentionDays)) this.policyValue = { footprints: policy.footprints, retentionDays: policy.retentionDays }
      // Visits recorded while the file was still being read are kept too.
      const known = new Set(this.visits.map((visit) => visit.id))
      const loaded = raw.visits
        .filter((visit): visit is HistoryVisit => typeof visit?.id === 'string' && typeof visit.url === 'string' && recordable(visit.url) && typeof visit.title === 'string' && typeof visit.visitedAt === 'number' && Number.isFinite(visit.visitedAt))
        .filter((visit) => !known.has(visit.id))
        .map((visit) => ({ id: visit.id, url: visit.url, title: visit.title.slice(0, 1_000), host: hostOf(visit.url), visitedAt: visit.visitedAt }))
      this.visits = [...this.visits, ...loaded].sort((a, b) => b.visitedAt - a.visitedAt).slice(0, this.maxVisits)
      this.prune(false)
      this.forgetExcluded(false)
    } catch {
      // Start empty rather than fail to open.
    }
  }

  serialize(): string {
    const stored: StoredHistory = { schema: 'intoponet.history.v1', policy: this.policyValue, visits: this.visits }
    return JSON.stringify(stored)
  }

  setPolicy(policy: HistoryPolicy): void {
    const changed = policy.footprints !== this.policyValue.footprints || policy.retentionDays !== this.policyValue.retentionDays
    this.policyValue = { footprints: policy.footprints, retentionDays: policy.retentionDays }
    const removed = this.prune(false)
    if (changed || removed) this.options.onChange?.()
  }

  /** Record a visit. Returns false when the rules say it is not kept. */
  record(input: { url: string; title: string; isPrivate: boolean }): boolean {
    if (input.isPrivate || !this.policyValue.footprints || !recordable(input.url)) return false
    if (isExcludedSite(input.url, this.options.excludedSites())) return false
    const now = this.now()
    const title = input.title.trim().slice(0, 1_000)
    const last = this.visits[0]
    if (last && last.url === input.url && now - last.visitedAt < SAME_VISIT_MS) {
      last.visitedAt = now
      if (title) last.title = title
    } else {
      this.visits.unshift({ id: randomUUID(), url: input.url, title, host: hostOf(input.url), visitedAt: now })
      if (this.visits.length > this.maxVisits) this.visits.length = this.maxVisits
    }
    this.options.onChange?.()
    return true
  }

  /** A page's title arrived after its visit was recorded. */
  updateTitle(url: string, title: string): void {
    const clean = title.trim().slice(0, 1_000)
    if (!clean) return
    const visit = this.visits.find((candidate) => candidate.url === url)
    if (!visit || this.now() - visit.visitedAt > TITLE_UPDATE_MS || visit.title === clean) return
    visit.title = clean
    this.options.onChange?.()
  }

  /** Substring search on title and address, newest first, grouped by local day. */
  search(query: string, cursor = 0, limit = 100): HistorySearchResult {
    this.prune()
    const needle = query.trim().toLocaleLowerCase()
    const matches = needle
      ? this.visits.filter((visit) => visit.title.toLocaleLowerCase().includes(needle) || visit.url.toLocaleLowerCase().includes(needle))
      : this.visits
    const page = matches.slice(cursor, cursor + limit)
    const days: HistoryDay[] = []
    for (const visit of page) {
      const key = dayKey(visit.visitedAt)
      const group = days.at(-1)
      if (group?.day === key) group.visits.push({ ...visit })
      else days.push({ day: key, visits: [{ ...visit }] })
    }
    const next = cursor + page.length
    return { days, nextCursor: next < matches.length ? next : null, total: matches.length }
  }

  /** Newest visits (for address-bar suggestions). */
  recent(limit: number): HistoryVisit[] {
    return this.visits.slice(0, limit).map((visit) => ({ ...visit }))
  }

  delete(ids: readonly string[]): number {
    const set = new Set(ids)
    return this.removeWhere((visit) => set.has(visit.id))
  }

  deleteDay(day: string): number {
    return this.removeWhere((visit) => dayKey(visit.visitedAt) === day)
  }

  /** Remove visits since a time (0 = everything). Returns the origins those visits were on. */
  deleteSince(since: number): string[] {
    const origins = this.originsSince(since)
    this.removeWhere((visit) => visit.visitedAt >= since)
    return origins
  }

  originsSince(since: number): string[] {
    const origins = new Set<string>()
    for (const visit of this.visits) {
      if (visit.visitedAt < since) break
      try { origins.add(new URL(visit.url).origin) } catch { /* recordable already */ }
    }
    return [...origins]
  }

  clear(): void {
    this.removeWhere(() => true)
  }

  /** Drop visits from sites now left out. */
  forgetExcluded(notify = true): number {
    const sites = this.options.excludedSites()
    if (!sites.length) return 0
    return this.removeWhere((visit) => isExcludedSite(visit.url, sites), notify)
  }

  /** Apply the retention window. Returns whether anything was removed. */
  prune(notify = true): boolean {
    const days = this.policyValue.retentionDays
    if (!days) return false
    const cutoff = this.now() - days * DAY_MS
    return this.removeWhere((visit) => visit.visitedAt < cutoff, notify) > 0
  }

  get size(): number {
    return this.visits.length
  }

  private removeWhere(predicate: (visit: HistoryVisit) => boolean, notify = true): number {
    const before = this.visits.length
    this.visits = this.visits.filter((visit) => !predicate(visit))
    const removed = before - this.visits.length
    if (removed && notify) this.options.onChange?.()
    return removed
  }
}
