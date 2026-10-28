import { useEffect, useState } from 'react'
import type { GlobeSignal } from './globeSignals'
import { relativeTime } from './globeSignals'
import { eventPicture } from './naturalEvent'

type Coverage = { title: string; url: string; publisher: string; publishedAt: string }

/**
 * A natural event in the card itself: NASA's satellite picture of the place
 * (fire hotspots in red), and news coverage that names the event, instead of
 * sending the reader to an agency's raw records.
 */
export function EventView({ signal, now, coverage, onOpen }: { signal: GlobeSignal; now: number; coverage: Coverage[]; onOpen: (url: string) => void }) {
  // The newest day NASA has imagery for (a day's pictures appear about a day later): up to four days back.
  const [shown, setShown] = useState<{ src: string; day: string; hotspots: boolean } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setShown(null)
    setFailed(false)
    void (async () => {
      for (let back = 0; back < 4 && !cancelled; back += 1) {
        const candidate = eventPicture(signal, now, back)
        try {
          const response = await fetch(candidate.url)
          if (!response.ok || response.headers.get('Data-Present') === 'false') continue
          const blob = await response.blob()
          if (blob.size < 6_000 || cancelled) continue
          objectUrl = URL.createObjectURL(blob)
          setShown({ src: objectUrl, day: candidate.day, hotspots: candidate.hotspots })
          return
        } catch {
          // Try the day before.
        }
      }
      if (!cancelled) setFailed(true)
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [signal.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const picture = shown ?? { ...eventPicture(signal, now), src: '' }
  const worldview = `https://worldview.earthdata.nasa.gov/?v=${[signal.lon - 6, signal.lat - 4, signal.lon + 6, signal.lat + 4].map((value) => value.toFixed(2)).join(',')}&t=${picture.day}${picture.hotspots ? '&l=VIIRS_NOAA20_CorrectedReflectance_TrueColor,VIIRS_NOAA20_Thermal_Anomalies_375m_All' : ''}`
  const day = new Date(`${picture.day}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <div className="event-view">
      {!failed && (
        <figure className={`event-picture${shown ? '' : ' is-loading'}`}>
          <button type="button" onClick={() => onOpen(worldview)} title="Open in NASA Worldview to zoom and change the day">
            {shown ? <img src={shown.src} alt={`Satellite image of the area around ${signal.title} on ${day}`} /> : <span className="event-picture-wait">Finding the latest satellite picture…</span>}
            <span className="event-crosshair" aria-hidden="true" />
          </button>
          <figcaption>VIIRS satellites, {day}{picture.hotspots ? ' · red dots: fire detected by heat' : ''} · NASA</figcaption>
        </figure>
      )}
      {coverage.length > 0 && (
        <section className="event-coverage" aria-label="In the news">
          <h3>In the news</h3>
          <ul>
            {coverage.map((item) => (
              <li key={item.url}>
                <button type="button" onClick={() => onOpen(item.url)}>{item.title}</button>
                <small>{item.publisher} · {relativeTime(item.publishedAt, now)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
