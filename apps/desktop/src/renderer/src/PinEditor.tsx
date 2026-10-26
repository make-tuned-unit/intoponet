import { useState, type FormEvent } from 'react'
import { MapPin, X } from 'lucide-react'
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
  onCancel,
  onSave,
}: {
  initial: PinEditorValue
  locations: PinLocationOption[]
  onCancel: () => void
  onSave: (value: PinEditorValue) => void
}) {
  const [url, setUrl] = useState(initial.url)
  const [title, setTitle] = useState(initial.title)
  const [topic, setTopic] = useState(initial.topic)
  const [note, setNote] = useState(initial.note)
  const matchingLocation = initial.fieldAnchor
    ? locations.find((location) => location.lat === initial.fieldAnchor?.lat && location.lon === initial.fieldAnchor?.lon)
    : undefined
  const [locationChoice, setLocationChoice] = useState(
    initial.fieldAnchor ? matchingLocation ? `known:${matchingLocation.id}` : 'custom' : '',
  )
  const [customLabel, setCustomLabel] = useState(initial.fieldAnchor?.label ?? '')
  const [customLat, setCustomLat] = useState(initial.fieldAnchor ? String(initial.fieldAnchor.lat) : '')
  const [customLon, setCustomLon] = useState(initial.fieldAnchor ? String(initial.fieldAnchor.lon) : '')
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
    if (locationChoice.startsWith('known:')) {
      const selected = locations.find((location) => `known:${location.id}` === locationChoice)
      if (!selected) {
        setError('Choose a listed location or clear the location field.')
        return
      }
      fieldAnchor = { lat: selected.lat, lon: selected.lon, label: selected.label.trim().slice(0, 160) }
    } else if (locationChoice === 'custom') {
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
        <label>
          <span>Map location <small>optional</small></span>
          <select value={locationChoice} onChange={(event) => setLocationChoice(event.target.value)}>
            <option value="">No geographic location</option>
            {locations.map((location) => <option key={location.id} value={`known:${location.id}`}>{location.label}</option>)}
            <option value="custom">Enter coordinates</option>
          </select>
        </label>
        {locationChoice === 'custom' && (
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
        <p className="pin-editor-footnote">Saved only in your private library. No location is inferred from the page.</p>
        <div className="pin-editor-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Save to My map</button>
        </div>
      </form>
    </section>
  )
}
