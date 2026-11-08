import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { WorkspaceAnchor as Anchor, WorkspaceSnapshot } from '@intoponet/browser-api'
import { placeLabel, searchPlaces, type Place } from '../../shared/places/places'

/** The place a workspace is anchored to, as the place search gives it (the same search as a pin's place). */
export function anchorFromPlace(place: Place): Anchor {
  return { lat: place.lat, lon: place.lon, label: placeLabel(place).slice(0, 80), placeId: place.id }
}

const hint = (place: Place): string => (place.kind === 'country' ? 'Country' : place.kind === 'region' ? `Region · ${place.country}` : place.country)

/**
 * Anchors a workspace to a place the person searches for (never their device's location). Type,
 * ↑/↓ to choose, Enter to anchor, Escape to cancel. Opens in the sidebar, under the workspace.
 */
export function AnchorPicker({ workspace, onDone, onError }: { workspace: WorkspaceSnapshot; onDone: () => void; onError: (caught: unknown) => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  // Anchored, cancelled or Escape: focus goes back to what opened it (the workspace's actions button).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const frame = requestAnimationFrame(() => field.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus()
    }
  }, [])
  const results = useMemo(() => (query.trim().length < 2 ? [] : searchPlaces(query.trim(), 7)), [query])
  const choose = (place: Place): void => {
    if (busy) return
    setBusy(true)
    void window.intoponet.workspaces.update(workspace.id, { anchor: anchorFromPlace(place) }).then(onDone, (caught: unknown) => {
      setBusy(false)
      onError(caught)
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(results.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault()
      choose(results[active]!)
    }
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (results[active]) choose(results[active]!)
  }
  return (
    <form
      className="tab-rail-workspace-editor tab-rail-anchor"
      role="dialog"
      aria-label={`Anchor ${workspace.name} to a place`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onDone()
      }}
    >
      <label className="tab-rail-workspace-field">
        <span>Place</span>
        <input
          ref={field}
          className="tab-rail-workspace-name-input"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="workspace-anchor-results"
          aria-activedescendant={results[active] ? `workspace-anchor-${active}` : undefined}
          aria-autocomplete="list"
          value={query}
          maxLength={80}
          placeholder="Search a city, region or country"
          onChange={(event) => { setQuery(event.target.value); setActive(0) }}
          onKeyDown={onKeyDown}
        />
      </label>
      {results.length > 0 && (
        <ul id="workspace-anchor-results" role="listbox" aria-label="Places" className="tab-rail-anchor-results">
          {results.map((place, index) => (
            <li key={`${place.id}-${index}`} role="presentation">
              <button type="button" id={`workspace-anchor-${index}`} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(place)}>
                <strong>{placeLabel(place)}</strong>
                <small>{hint(place)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && results.length === 0 && <p className="tab-rail-anchor-empty" role="status">No place matches.</p>}
      <div className="tab-rail-workspace-buttons">
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
