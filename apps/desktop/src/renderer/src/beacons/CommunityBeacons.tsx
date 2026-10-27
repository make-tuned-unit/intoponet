import { useEffect, useState } from 'react'
import { Flag, Radio } from 'lucide-react'
import type { BeaconReportKind, BeaconResource } from '@intoponet/browser-api'
import './beacons.css'

const host = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/**
 * Beacons people published near a place (PRD BCN-003/004): ranked by
 * prominence with diminishing returns, with source, contest notes, and a way
 * to report or dispute each one.
 */
export function CommunityBeacons({ lat, lon, onOpen }: { lat: number; lon: number; onOpen: (url: string) => void }) {
  const api = window.intoponet.beacons
  const [items, setItems] = useState<BeaconResource[] | null>(null)
  const [registry, setRegistry] = useState<string | null>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const [kind, setKind] = useState<BeaconReportKind>('misleading')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    setItems(null)
    void api.state().then((state) => {
      if (cancelled) return
      setRegistry(state.registry)
      if (!state.registry) return
      void api.read({ bbox: [lat - 6, lon - 8, lat + 6, lon + 8] }).then((list) => { if (!cancelled) setItems(list) }, () => { if (!cancelled) setItems([]) })
    }, () => undefined)
    return () => { cancelled = true }
  }, [api, lat, lon])

  if (!registry || !items || items.length === 0) return null
  return (
    <section className="community-beacons" aria-label="Beacons near here">
      <small title="Pages people deliberately recommended for this area. Prominence grows slowly with independent publishers in each region, so volume from one place can’t dominate."><Radio size={11} aria-hidden="true" /> Beacons near here</small>
      <ul>
        {items.slice(0, 5).map((item) => (
          <li key={item.url}>
            <button type="button" className="community-beacon-open" onClick={() => onOpen(item.url)}>
              <strong>{item.title}</strong>
              <span>{host(item.url)} · {item.topic} · recommended by {item.publishers}</span>
              {item.note && <em>“{item.note}”</em>}
              {item.contested && <span className="community-beacon-contested" title={item.contested.notes.join('\n')}>Disputed: {item.contested.notes[0]}</span>}
            </button>
            <button type="button" className="community-beacon-flag" aria-label={`Report or dispute ${item.title}`} title="Report or dispute" onClick={() => { setReporting(reporting === item.url ? null : item.url); setStatus('') }}><Flag size={12} /></button>
            {reporting === item.url && (
              <form className="community-beacon-report" onSubmit={(event) => {
                event.preventDefault()
                void api.report(item.url, kind, text.trim() || undefined).then(() => { setStatus('Thanks. Reports are reviewed; three independent reports hide a beacon until then.'); setReporting(null); setText('') }, (caught: unknown) => setStatus(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'It could not be sent.'))
              }}>
                <select value={kind} onChange={(event) => setKind(event.target.value as BeaconReportKind)} aria-label="Reason">
                  <option value="misleading">Misleading</option>
                  <option value="contest">I dispute it (shown publicly)</option>
                  <option value="spam">Spam</option>
                  <option value="harmful">Harmful</option>
                  <option value="broken">Broken link</option>
                </select>
                <input value={text} onChange={(event) => setText(event.target.value)} maxLength={500} placeholder={kind === 'contest' ? 'What you dispute and why (shown publicly)' : 'Details (optional)'} />
                <button type="submit">Send</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {status && <p className="community-beacon-status" role="status">{status}</p>}
    </section>
  )
}
