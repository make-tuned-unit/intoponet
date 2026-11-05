import type { ClearBrowsingDataRequest, ClearRange, HistoryDay, HistoryPolicy, HistoryVisit } from '@intoponet/browser-api'
import { History as HistoryIcon, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { SiteIcon } from '../SiteIcon'
import { dayLabel, mergeDays } from './browsingDataModel'
import { onOpenHistory } from './historyAccess'
import { holdPage } from './pageHold'
import './browsingData.css'

const PAGE_SIZE = 100

/** What the library's recent pages should drop to match what was removed from history. */
export type HistoryForget = { urls: string[] } | { day: string } | { since: number }

export type HistoryHostProps = {
  /** Footprint settings (Privacy): history follows them. */
  policy: HistoryPolicy
  onOpenUrl: (url: string) => void
  onForget: (forget: HistoryForget) => void
  onNotice?: (message: string) => void
}

/**
 * Mount once. Opens on the library drawer's History button (openHistory()) and on ⌘Y (the app
 * menu sends the main process's openHistoryPane()). Also keeps the main process's history policy in
 * step with the footprint settings.
 */
export function HistoryHost({ policy, onOpenUrl, onForget, onNotice }: HistoryHostProps) {
  const [open, setOpen] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    void window.intoponet.history.setPolicy(policy).catch(() => undefined)
  }, [policy.footprints, policy.retentionDays]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const show = (): void => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setOpen(true)
    }
    const stopLocal = onOpenHistory(show)
    const stopMain = window.intoponet.history.subscribe((event) => { if (event.type === 'open') show() })
    return () => { stopLocal(); stopMain() }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    returnFocus.current?.focus?.()
  }, [])

  if (!open) return null
  return (
    <HistoryPane
      footprints={policy.footprints}
      onClose={close}
      onOpenUrl={(url) => { close(); onOpenUrl(url) }}
      onForget={onForget}
      {...(onNotice ? { onNotice } : {})}
    />
  )
}

function timeLabel(time: number): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function HistoryPane({ footprints, onClose, onOpenUrl, onForget, onNotice }: {
  footprints: boolean
  onClose: () => void
  onOpenUrl: (url: string) => void
  onForget: (forget: HistoryForget) => void
  onNotice?: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const [days, setDays] = useState<HistoryDay[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const headingId = useId()

  useEffect(() => holdPage(), [])
  useEffect(() => { search.current?.focus() }, [])

  const load = useCallback(async (text: string, from: number) => {
    const id = ++request.current
    setLoading(true)
    try {
      const result = await window.intoponet.history.search(text, { cursor: from, limit: PAGE_SIZE })
      if (id !== request.current) return
      setDays((current) => (from === 0 ? result.days : mergeDays(current, result.days)))
      setTotal(result.total)
      setCursor(result.nextCursor)
    } catch {
      if (id === request.current) onNotice?.('History could not be read.')
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [onNotice])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query, 0), query ? 150 : 0)
    return () => window.clearTimeout(timer)
  }, [query, load])
  useEffect(() => window.intoponet.history.subscribe((event) => {
    if (event.type === 'changed') void load(query, 0)
  }), [query, load])

  const removeVisit = (visit: HistoryVisit): void => {
    setDays((current) => current.map((day) => ({ ...day, visits: day.visits.filter((item) => item.id !== visit.id) })).filter((day) => day.visits.length))
    setTotal((count) => Math.max(0, count - 1))
    void window.intoponet.history.delete([visit.id]).then(() => onForget({ urls: [visit.url] }), () => onNotice?.('That page could not be removed from history.'))
  }
  const removeDay = (day: HistoryDay): void => {
    setDays((current) => current.filter((item) => item.day !== day.day))
    void window.intoponet.history.deleteDay(day.day).then(() => {
      onForget({ day: day.day })
      void load(query, 0)
    }, () => onNotice?.('That day could not be removed from history.'))
  }

  // Escape closes (the clear dialog first) wherever focus is, before the app's own Escape handling.
  const clearButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (clearing) {
        setClearing(false)
        clearButton.current?.focus()
      } else onClose()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [clearing, onClose])

  // Keep Tab inside the dialog.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !dialog.current) return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="history-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialog} className="history-pane lg-surface" role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={onKeyDown}>
        <div className="history-head">
          <h2 id={headingId}><HistoryIcon size={17} aria-hidden="true" /> History</h2>
          <button ref={clearButton} type="button" className="history-text-button" aria-expanded={clearing} onClick={() => setClearing(true)}>Clear browsing data…</button>
          <button type="button" className="downloads-icon-button" aria-label="Close history" onClick={onClose}><X size={16} /></button>
        </div>
        <label className="history-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={search}
            type="search"
            value={query}
            placeholder="Search history"
            aria-label="Search history"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {!footprints && <p className="history-note">Footprints are off (Privacy): new visits are not being kept.</p>}
        <div className="history-results" aria-busy={loading}>
          {days.length === 0 && !loading ? (
            <p className="history-empty">{query ? `No visits match “${query}”.` : 'Pages you visit in normal tabs will appear here. Private tabs and sites you left out are never kept.'}</p>
          ) : (
            days.map((day) => (
              <section key={day.day} className="history-day" aria-label={dayLabel(day.day)}>
                <div className="history-day-head">
                  <h3>{dayLabel(day.day)}</h3>
                  <button type="button" className="history-text-button" onClick={() => removeDay(day)} aria-label={`Delete all history from ${dayLabel(day.day)}`}>Delete day</button>
                </div>
                <ul>
                  {day.visits.map((visit) => (
                    <li key={visit.id} className="history-visit">
                      <button type="button" className="history-open" onClick={() => onOpenUrl(visit.url)} title={visit.url}>
                        <time dateTime={new Date(visit.visitedAt).toISOString()}>{timeLabel(visit.visitedAt)}</time>
                        <SiteIcon url={visit.url} />
                        <strong>{visit.title || visit.host}</strong>
                        <span>{visit.host}</span>
                      </button>
                      <button type="button" className="downloads-icon-button" aria-label={`Remove ${visit.title || visit.host} from history`} onClick={() => removeVisit(visit)}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          {cursor !== null && (
            <button type="button" className="history-more" disabled={loading} onClick={() => void load(query, cursor)}>
              Show more ({total - days.reduce((sum, day) => sum + day.visits.length, 0)} left)
            </button>
          )}
        </div>
        {clearing && (
          <ClearBrowsingData
            onCancel={() => { setClearing(false); clearButton.current?.focus() }}
            onDone={(message, since, history) => {
              setClearing(false)
              if (history) onForget({ since })
              onNotice?.(message)
              void load(query, 0)
            }}
          />
        )}
      </div>
    </div>
  )
}

const RANGE_OPTIONS: Array<[ClearRange, string]> = [['hour', 'Last hour'], ['day', 'Last 24 hours'], ['week', 'Last 7 days'], ['all', 'All time']]

function ClearBrowsingData({ onCancel, onDone }: { onCancel: () => void; onDone: (message: string, since: number, history: boolean) => void }) {
  const [form, setForm] = useState<ClearBrowsingDataRequest>({ range: 'hour', history: true, siteData: false, cache: true, downloads: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const headingId = useId()
  const first = useRef<HTMLSelectElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  const nothing = !form.history && !form.siteData && !form.cache && !form.downloads
  const toggle = (key: 'history' | 'siteData' | 'cache' | 'downloads', label: string, hint: string) => (
    <label className="clear-option">
      <input type="checkbox" checked={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />
      <span><strong>{label}</strong><small>{hint}</small></span>
    </label>
  )
  const submit = (): void => {
    setBusy(true)
    setError('')
    void window.intoponet.history.clearBrowsingData(form).then((result) => {
      const what = result.cleared.length ? `Cleared ${result.cleared.join(', ')}.` : 'Nothing was cleared.'
      onDone([what, ...result.notes].join(' '), result.since, form.history)
    }, () => {
      setBusy(false)
      setError('Browsing data could not be cleared.')
    })
  }
  return (
    <div className="clear-data" role="group" aria-labelledby={headingId}>
      <h3 id={headingId}>Clear browsing data</h3>
      <label className="clear-range">
        Time range
        <select ref={first} value={form.range} onChange={(event) => setForm({ ...form, range: event.target.value as ClearRange })}>
          {RANGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {toggle('history', 'Browsing history', 'Pages visited in normal tabs, and the library’s recent pages.')}
      {toggle('siteData', 'Cookies and site data', 'Signs you out of most sites. For a time range: the sites visited in it.')}
      {toggle('cache', 'Cached images and files', 'Always cleared for all time.')}
      {toggle('downloads', 'Downloads list', 'The files stay in your Downloads folder.')}
      {error && <p className="history-note" role="alert">{error}</p>}
      <div className="clear-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="is-primary" disabled={busy || nothing} onClick={submit}>{busy ? 'Clearing…' : 'Clear'}</button>
      </div>
    </div>
  )
}
