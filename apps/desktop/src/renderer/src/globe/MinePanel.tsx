import { BookOpenText, MapPin } from 'lucide-react'
import type { KnowledgeRecord } from '@intoponet/browser-api'
import type { SavedBookmark } from '../localLibrary'
import { useGlassSheen } from '../glass/useGlassSheen'
import '../glass/glass.css'
import './globe.css'

/**
 * The private side of the globe: your pinned places and the places named in
 * pages you absorbed. Nothing here is public or shared.
 */
export function MinePanel({
  pins,
  records,
  onFly,
  onOpenPin,
  onOpenRecord,
}: {
  pins: SavedBookmark[]
  records: KnowledgeRecord[]
  onFly: (lat: number, lon: number) => void
  onOpenPin: (url: string) => void
  onOpenRecord: (id: string) => void
}) {
  const sheen = useGlassSheen<HTMLDivElement>()
  const placed = pins.filter((pin) => pin.fieldAnchor)
  const withPlaces = records.filter((record) => record.places.length > 0)
  return (
    <aside ref={sheen} className="globe-panel lg-surface lg-sheen mine-panel" aria-label="Your places">
      <h2 className="globe-list-heading">Your places<span>{placed.length + withPlaces.length}</span></h2>
      <div className="globe-list mine-list">
        {placed.length === 0 && withPlaces.length === 0 && (
          <p className="globe-empty">Pin a page to a place, or absorb an article, and it appears here and on your private globe.</p>
        )}
        {placed.length > 0 && (
          <section aria-label="Pinned places">
            <h3>Pinned</h3>
            <ul>
              {placed.map((pin) => (
                <li key={pin.url}>
                  <button type="button" className="globe-row" style={{ ['--layer-color' as string]: '#a69be8' }} onClick={() => { onFly(pin.fieldAnchor!.lat, pin.fieldAnchor!.lon); onOpenPin(pin.url) }}>
                    <span className="globe-row-dot" aria-hidden="true" />
                    <span className="globe-row-text">
                      <strong>{pin.title || pin.url}</strong>
                      <small><MapPin size={10} aria-hidden="true" /> {pin.fieldAnchor!.label}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {withPlaces.length > 0 && (
          <section aria-label="From your knowledge">
            <h3>From your knowledge</h3>
            <ul>
              {withPlaces.map((record) => (
                <li key={record.id} className="mine-record">
                  <button type="button" className="globe-row" style={{ ['--layer-color' as string]: '#d6c9ff' }} onClick={() => onOpenRecord(record.id)}>
                    <span className="globe-row-dot" aria-hidden="true" />
                    <span className="globe-row-text">
                      <strong>{record.title}</strong>
                      <small><BookOpenText size={10} aria-hidden="true" /> {record.siteName ?? new URL(record.url).hostname}</small>
                    </span>
                  </button>
                  <div className="mine-places">
                    {record.places.slice(0, 8).map((place) => (
                      <button key={`${place.name}-${place.countryCode}`} type="button" onClick={() => onFly(place.lat, place.lon)} title={`Mentioned ${place.count}×`}>
                        {place.name}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  )
}
