import { useMemo, useState, type FormEvent } from 'react'
import { MapPin, Search, Sparkles, X } from 'lucide-react'
import { placeLabel, searchPlaces } from '../../shared/places/places'
import './PinEditor.css'

export type MapFieldAnchor = { lat: number; lon: number; label: string }
export type PinLocationOption = MapFieldAnchor & { id: string }
export type PinEditorValue = {
  url: string
  title: string
  topic: string
  note: string
  fieldAnchor?: MapFieldAnchor
}

export function PinEditor({
  initial,
  locations,
  suggestions = [],
  onCancel,
  onSave,
}: {
  initial: PinEditorValue
  locations: PinLocationOption[]
  /** Places named in the page (title, address, absorbed text): offered, never placed without saving. */
  suggestions?: PinLocationOption[]
  onCancel: () => void
  onSave: (value: PinEditorValue) => void
}) {
  const [url, setUrl] = useState(initial.url)
  const [title, setTitle] = useState(initial.title)
  const [topic, setTopic] = useState(initial.topic)
  const [note, setNote] = useState(initial.note)
  // The pin's place: the saved one, else the page's first suggestion (shown as suggested; saving confirms it).
  const [anchor, setAnchor] = useState<MapFieldAnchor | null>(initial.fieldAnchor ?? (suggestions[0] ? { lat: suggestions[0].lat, lon: suggestions[0].lon, label: suggestions[0].label } : null))
  const [suggested, setSuggested] = useState(!initial.fieldAnchor && !!suggestions[0])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(0)
  const [custom, setCustom] = useState(false)
  const [customLabel, setCustomLabel] = useState(initial.fieldAnchor?.label ?? '')
  const [customLat, setCustomLat] = useState(initial.fieldAnchor ? String(initial.fieldAnchor.lat) : '')
  const [customLon, setCustomLon] = useState(initial.fieldAnchor ? String(initial.fieldAnchor.lon) : '')
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return [] as Array<PinLocationOption & { hint: string }>
    const used = locations.filter((location) => location.label.toLowerCase().includes(q)).slice(0, 3).map((location) => ({ ...location, hint: 'Used before' }))
    const places = searchPlaces(query, 7).map((place) => ({ id: place.id, label: placeLabel(place), lat: place.lat, lon: place.lon, hint: place.kind === 'country' ? 'Country' : place.kind === 'region' ? `Region · ${place.country}` : place.country }))
    const seen = new Set<string>()
    return [...used, ...places].filter((item) => {
      const key = `${item.label}|${item.lat.toFixed(2)}|${item.lon.toFixed(2)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 8)
  }, [query, locations])
  const choose = (option: PinLocationOption, fromSuggestion = false): void => {
    setAnchor({ lat: option.lat, lon: option.lon, label: option.label.slice(0, 160) })
    setSuggested(fromSuggestion)
    setQuery('')
    setSearching(false)
    setCustom(false)
  }
  const [error, setError] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const safeUrl = url.trim()
    try {
      const parsed = new URL(safeUrl)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || safeUrl.length > 2_048) {
        throw new Error('Enter a web address using HTTP or HTTPS.')
      }
    } catch {
      setError('Enter a valid HTTP or HTTPS page address.')
      return
    }
    const cleanTitle = title.trim()
    const cleanTopic = topic.trim()
    if (!cleanTitle || cleanTitle.length > 180 || !cleanTopic || cleanTopic.length > 80) {
      setError('Add a page title and a topic or tag.')
      return
    }

    let fieldAnchor: MapFieldAnchor | undefined
    if (!custom && anchor) {
      fieldAnchor = { lat: anchor.lat, lon: anchor.lon, label: anchor.label.trim().slice(0, 160) }
    } else if (custom) {
      if (!customLat.trim() || !customLon.trim()) {
        setError('Enter both latitude and longitude, or choose no geographic location.')
        return
      }
      const lat = Number(customLat)
      const lon = Number(customLon)
      const label = customLabel.trim()
      if (!label || label.length > 160 || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
        setError('Enter a label, latitude from −90 to 90, and longitude from −180 to 180.')
        return
      }
      fieldAnchor = { lat, lon, label }
    }
    onSave({ url: safeUrl, title: cleanTitle, topic: cleanTopic, note: note.slice(0, 500), ...(fieldAnchor ? { fieldAnchor } : {}) })
  }

  return (
    <section className="pin-editor-backdrop" role="dialog" aria-modal="true" aria-labelledby="pin-editor-title" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }
      if (event.key === 'Tab') {
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea, button:not([disabled])')]
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }}>
      <form className="pin-editor" aria-labelledby="pin-editor-title" onSubmit={submit}>
        <div className="pin-editor-heading">
          <div>
            <span><MapPin size={13} aria-hidden="true" /> My map</span>
            <h2 id="pin-editor-title">Pin current page</h2>
          </div>
          <button type="button" aria-label="Cancel pin editing" onClick={onCancel}><X size={17} /></button>
        </div>
        <label>
          <span>Page title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} autoFocus />
        </label>
        <label>
          <span>Page address</span>
          <input value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2_048} spellCheck={false} />
        </label>
        <label>
          <span>Topic or tag</span>
          <input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={80} />
        </label>
        <div className="pin-editor-place">
          <span className="pin-editor-place-label">Map location <small>optional</small></span>
          {anchor && !searching && !custom ? (
            <div className="pin-editor-chosen">
              <MapPin size={14} aria-hidden="true" />
              <span>
                <strong>{anchor.label}</strong>
                <small>{suggested ? 'Suggested from this page · ' : ''}{anchor.lat.toFixed(2)}, {anchor.lon.toFixed(2)}</small>
              </span>
              <button type="button" onClick={() => { setSearching(true); setQuery('') }}>Change</button>
              <button type="button" aria-label="No map location" title="No map location" onClick={() => { setAnchor(null); setSuggested(false) }}><X size={13} /></button>
            </div>
          ) : !custom ? (
            <div className="pin-editor-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={query}
                placeholder="Search a city, region or country…"
                aria-label="Search for a place to pin this page"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls="pin-place-results"
                aria-activedescendant={results[active] ? `pin-place-${active}` : undefined}
                autoFocus={searching}
                onChange={(event) => { setQuery(event.target.value); setActive(0) }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(results.length - 1, index + 1)) }
                  if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }
                  if (event.key === 'Enter' && results[active]) { event.preventDefault(); choose(results[active]!) }
                  if (event.key === 'Escape' && searching && anchor) { event.preventDefault(); event.stopPropagation(); setSearching(false) }
                }}
              />
              {results.length > 0 && (
                <ul id="pin-place-results" role="listbox" className="pin-editor-results">
                  {results.map((result, index) => (
                    <li key={`${result.id}-${index}`} id={`pin-place-${index}`} role="option" aria-selected={index === active}>
                      <button type="button" className={index === active ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(result)}>
                        <strong>{result.label}</strong>
                        <small>{result.hint}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          {suggestions.length > 0 && !custom && (searching || !anchor || suggestions.length > 1) && (
            <div className="pin-editor-suggestions">
              <span><Sparkles size={11} aria-hidden="true" /> From this page:</span>
              {suggestions.map((suggestion) => (
                <button key={suggestion.id} type="button" className={anchor && anchor.label === suggestion.label ? 'is-chosen' : ''} onClick={() => choose(suggestion, true)}>
                  {suggestion.label}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="pin-editor-link" onClick={() => setCustom((value) => !value)}>
            {custom ? 'Search places instead' : 'Enter coordinates instead'}
          </button>
        </div>
        {custom && (
          <div className="pin-editor-coordinates">
            <label><span>Location label</span><input value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} maxLength={160} /></label>
            <label><span>Latitude</span><input type="number" min="-90" max="90" step="any" value={customLat} onChange={(event) => setCustomLat(event.target.value)} /></label>
            <label><span>Longitude</span><input type="number" min="-180" max="180" step="any" value={customLon} onChange={(event) => setCustomLon(event.target.value)} /></label>
            <small>Coordinates are your explicit map placement.</small>
          </div>
        )}
        <label>
          <span>Private note</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3} />
        </label>
        {error && <p className="pin-editor-error" role="alert">{error}</p>}
        <p className="pin-editor-footnote">Saved only in your private library. Suggestions come from the page's title, address and absorbed text; nothing is placed until you save.</p>
        <div className="pin-editor-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Save to My map</button>
        </div>
      </form>
    </section>
  )
}
