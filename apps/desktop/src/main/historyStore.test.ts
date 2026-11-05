import { describe, expect, it, vi } from 'vitest'
import { clearRangeStart, parseHistoryCommand } from '@intoponet/browser-api'
import { dayKey, HistoryStore } from './historyStore'

const DAY = 86_400_000
// Noon local time, so "yesterday" is unambiguous.
const NOON = new Date(2026, 10, 5, 12, 0, 0).getTime()

function store(options: { excluded?: string[]; now?: () => number } = {}) {
  let excluded = options.excluded ?? []
  let now = NOON
  const onChange = vi.fn()
  const history = new HistoryStore({ excludedSites: () => excluded, onChange, now: options.now ?? (() => now) })
  return {
    history,
    onChange,
    setNow: (value: number) => { now = value },
    setExcluded: (sites: string[]) => { excluded = sites },
  }
}

describe('HistoryStore', () => {
  it('records normal-tab http(s) visits and never private ones', () => {
    const { history } = store()
    expect(history.record({ url: 'https://example.com/a', title: 'A', isPrivate: false })).toBe(true)
    expect(history.record({ url: 'https://secret.example/', title: 'Secret', isPrivate: true })).toBe(false)
    expect(history.record({ url: 'file:///Users/me/x.html', title: 'File', isPrivate: false })).toBe(false)
    expect(history.record({ url: 'https://user:pw@example.com/', title: 'Creds', isPrivate: false })).toBe(false)
    expect(history.search('').total).toBe(1)
    expect(history.serialize()).not.toContain('secret.example')
  })

  it('respects sites left out, including subdomains, and forgets them when the list changes', () => {
    const { history, setExcluded } = store({ excluded: ['bank.com'] })
    expect(history.record({ url: 'https://www.bank.com/login', title: 'Bank', isPrivate: false })).toBe(false)
    expect(history.record({ url: 'https://app.bank.com/', title: 'Bank app', isPrivate: false })).toBe(false)
    history.record({ url: 'https://news.example/', title: 'News', isPrivate: false })
    setExcluded(['bank.com', 'news.example'])
    history.forgetExcluded()
    expect(history.search('').total).toBe(0)
  })

  it('records nothing while footprints are off', () => {
    const { history } = store()
    history.setPolicy({ footprints: false, retentionDays: 0 })
    expect(history.record({ url: 'https://example.com/', title: 'X', isPrivate: false })).toBe(false)
    expect(history.size).toBe(0)
  })

  it('drops visits older than the retention window', () => {
    const { history, setNow } = store()
    setNow(NOON - 40 * DAY)
    history.record({ url: 'https://old.example/', title: 'Old', isPrivate: false })
    setNow(NOON - 3 * DAY)
    history.record({ url: 'https://recent.example/', title: 'Recent', isPrivate: false })
    setNow(NOON)
    history.setPolicy({ footprints: true, retentionDays: 30 })
    expect(history.search('').days.flatMap((day) => day.visits.map((visit) => visit.host))).toEqual(['recent.example'])
    history.setPolicy({ footprints: true, retentionDays: 0 })
    setNow(NOON + 400 * DAY)
    expect(history.search('').total).toBe(1)
  })

  it('folds a reload into one visit and fills in a title that arrives later', () => {
    const { history, setNow } = store()
    history.record({ url: 'https://example.com/', title: '', isPrivate: false })
    setNow(NOON + 5_000)
    history.record({ url: 'https://example.com/', title: '', isPrivate: false })
    history.updateTitle('https://example.com/', 'Example Domain')
    const visits = history.search('').days[0]!.visits
    expect(visits).toHaveLength(1)
    expect(visits[0]!.title).toBe('Example Domain')
  })

  it('searches title and address, groups by local day and pages through results', () => {
    const { history, setNow } = store()
    for (let index = 0; index < 5; index += 1) {
      setNow(NOON - DAY - index * 60_000)
      history.record({ url: `https://wiki.example/page-${index}`, title: `Older ${index}`, isPrivate: false })
    }
    setNow(NOON)
    history.record({ url: 'https://example.com/climate', title: 'Climate change', isPrivate: false })
    setNow(NOON + 60_000)
    history.record({ url: 'https://other.example/', title: 'Other', isPrivate: false })

    const all = history.search('', 0, 4)
    expect(all.total).toBe(7)
    expect(all.days.map((day) => [day.day, day.visits.length])).toEqual([[dayKey(NOON), 2], [dayKey(NOON - DAY), 2]])
    expect(all.nextCursor).toBe(4)
    const rest = history.search('', 4, 4)
    expect(rest.days.flatMap((day) => day.visits).length).toBe(3)
    expect(rest.nextCursor).toBeNull()

    expect(history.search('CLIMATE').total).toBe(1)
    expect(history.search('wiki.example').total).toBe(5)
    expect(history.search('page-3').days[0]!.visits[0]!.title).toBe('Older 3')
  })

  it('deletes single visits, whole days and a time range', () => {
    const { history, setNow } = store()
    setNow(NOON - DAY)
    history.record({ url: 'https://yesterday.example/', title: 'Y', isPrivate: false })
    setNow(NOON - 2 * 3_600_000)
    history.record({ url: 'https://morning.example/', title: 'M', isPrivate: false })
    setNow(NOON)
    history.record({ url: 'https://now.example/', title: 'N', isPrivate: false })
    const nowVisit = history.search('now.example').days[0]!.visits[0]!
    history.delete([nowVisit.id])
    expect(history.search('now.example').total).toBe(0)

    history.record({ url: 'https://now.example/', title: 'N', isPrivate: false })
    expect(history.deleteSince(clearRangeStart('hour', NOON))).toEqual(['https://now.example'])
    expect(history.search('').total).toBe(2)

    history.deleteDay(dayKey(NOON - DAY))
    expect(history.search('').days.map((day) => day.day)).toEqual([dayKey(NOON)])
    history.clear()
    expect(history.size).toBe(0)
  })

  it('round-trips through its payload and keeps visits made while loading', () => {
    const { history } = store()
    history.record({ url: 'https://saved.example/', title: 'Saved', isPrivate: false })
    history.setPolicy({ footprints: true, retentionDays: 90 })
    const payload = history.serialize()

    const { history: next, setNow } = store()
    setNow(NOON + 120_000)
    next.record({ url: 'https://early.example/', title: 'Early', isPrivate: false })
    next.load(payload)
    expect(next.policy).toEqual({ footprints: true, retentionDays: 90 })
    expect(next.search('').days[0]!.visits.map((visit) => visit.host)).toEqual(['early.example', 'saved.example'])

    const { history: broken } = store()
    broken.load('{not json')
    broken.load(JSON.stringify({ schema: 'other', visits: [] }))
    expect(broken.size).toBe(0)
  })

  it('a policy set this run wins over the saved one', () => {
    const { history } = store()
    history.setPolicy({ footprints: false, retentionDays: 7 })
    const payload = history.serialize()
    const { history: next } = store()
    next.setPolicy({ footprints: true, retentionDays: 0 })
    next.load(payload, true)
    expect(next.policy).toEqual({ footprints: true, retentionDays: 0 })
  })
})

describe('history command validation', () => {
  it('accepts well-formed commands and refuses others', () => {
    expect(parseHistoryCommand({ type: 'search', query: 'x', cursor: 0, limit: 50 })).toEqual({ type: 'search', query: 'x', cursor: 0, limit: 50 })
    expect(parseHistoryCommand({ type: 'delete-day', day: '2026-11-05' })).toEqual({ type: 'delete-day', day: '2026-11-05' })
    expect(parseHistoryCommand({ type: 'clear-browsing-data', request: { range: 'week', history: true, siteData: false, cache: true, downloads: false } }).type).toBe('clear-browsing-data')
    expect(() => parseHistoryCommand({ type: 'search', query: 'x', cursor: -1, limit: 50 })).toThrow()
    expect(() => parseHistoryCommand({ type: 'search', query: 'x', cursor: 0, limit: 5_000 })).toThrow()
    expect(() => parseHistoryCommand({ type: 'delete', ids: [] })).toThrow()
    expect(() => parseHistoryCommand({ type: 'set-policy', policy: { footprints: true, retentionDays: 3 } })).toThrow()
    expect(() => parseHistoryCommand({ type: 'clear-browsing-data', request: { range: 'year', history: true, siteData: true, cache: true, downloads: true } })).toThrow()
  })
  it('clear ranges reach back an hour, a day, a week or all time', () => {
    expect(clearRangeStart('hour', NOON)).toBe(NOON - 3_600_000)
    expect(clearRangeStart('day', NOON)).toBe(NOON - DAY)
    expect(clearRangeStart('week', NOON)).toBe(NOON - 7 * DAY)
    expect(clearRangeStart('all', NOON)).toBe(0)
  })
})
