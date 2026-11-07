import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Layers, Sparkles, X } from 'lucide-react'
import type { PageTabSnapshot, TidySuggestion } from '@intoponet/browser-api'
import { useGlassSheen } from './glass/useGlassSheen'
import { holdPage } from './browsingData/pageHold'
import './glass/glass.css'
import './tidySheet.css'

type Proposal = { name: string; tabIds: string[]; include: boolean }
type State = { status: 'loading' } | { status: 'unavailable'; reason: string } | { status: 'ready'; groups: Proposal[] } | { status: 'error' }

/**
 * Tidy: a preview of the folders Laya suggests for loose tabs. Nothing moves until Accept; Cancel
 * moves nothing. With Laya off it says why and offers Group by story instead.
 */
export function TidySheet({ tabs, onAccept, onGroupByStory, onClose }: {
  tabs: readonly PageTabSnapshot[]
  onAccept: (groups: Array<{ name: string; tabIds: string[] }>) => void
  onGroupByStory: () => void
  onClose: () => void
}) {
  const sheen = useGlassSheen<HTMLDivElement>()
  const [state, setState] = useState<State>({ status: 'loading' })
  const titles = new Map(tabs.map((tab) => [tab.id, tab.title || tab.url || 'Untitled page']))

  // The page is a native view drawn above the shell: hide it while the sheet is open, or it covers the sheet.
  useEffect(() => holdPage(), [])
  // Focus moves into the sheet, and back to what opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    sheen.current?.focus()
    return () => opener?.focus?.()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true
    window.intoponet.browserHost.tidyTabsSuggest().then((suggestion: TidySuggestion) => {
      if (!live) return
      if (!suggestion.available) setState({ status: 'unavailable', reason: suggestion.reason })
      else setState({ status: 'ready', groups: suggestion.groups.map((group) => ({ ...group, include: true })) })
    }, () => { if (live) setState({ status: 'error' }) })
    return () => { live = false }
  }, [])

  // Escape closes the sheet only, before the app's own Escape handling (which would close the page).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Tab stays inside the sheet: it is modal, and the sidebar behind it is out of reach.
  const keepFocusInside = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !sheen.current) return
    const focusable = [...sheen.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    const at = document.activeElement
    if (event.shiftKey && (at === first || at === sheen.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && at === last) { event.preventDefault(); first.focus() }
  }

  const groups = state.status === 'ready' ? state.groups : []
  const chosen = groups.filter((group) => group.include && group.name.trim() && group.tabIds.length)
  const moving = chosen.reduce((count, group) => count + group.tabIds.length, 0)
  const update = (index: number, change: Partial<Proposal>): void => {
    if (state.status !== 'ready') return
    setState({ status: 'ready', groups: state.groups.map((group, at) => (at === index ? { ...group, ...change } : group)) })
  }

  return createPortal(
    <div className="tidy-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={sheen} className="tidy-sheet lg-surface lg-sheen" role="dialog" aria-modal="true" aria-labelledby="tidy-title" tabIndex={-1} onKeyDown={keepFocusInside}>
        <header className="tidy-head">
          <h2 id="tidy-title"><Sparkles size={15} aria-hidden="true" /> Tidy tabs</h2>
          <button type="button" className="tidy-close" aria-label="Close" onClick={onClose}><X size={15} aria-hidden="true" /></button>
        </header>
        {state.status === 'loading' && <p className="tidy-status" role="status">Looking at your loose tabs on this Mac…</p>}
        {state.status === 'error' && <p className="tidy-status" role="alert">Tidy could not look at your tabs. Nothing was moved.</p>}
        {state.status === 'unavailable' && (
          <div className="tidy-explain">
            <p role="status">{state.reason}</p>
            <button type="button" className="tidy-accept" onClick={onGroupByStory}><Layers size={14} aria-hidden="true" /> Group by story</button>
          </div>
        )}
        {state.status === 'ready' && groups.length === 0 && <p className="tidy-status" role="status">Nothing to tidy: no loose tabs look alike enough.</p>}
        {state.status === 'ready' && groups.length > 0 && (
          <>
            <p className="tidy-note">Suggested from titles and addresses, computed on this Mac. Nothing moves until you accept.</p>
            <ul className="tidy-groups">
              {groups.map((group, index) => (
                <li key={index} className={`tidy-group${group.include ? '' : ' is-off'}`}>
                  <label className="tidy-include">
                    <input type="checkbox" checked={group.include} onChange={(event) => update(index, { include: event.currentTarget.checked })} aria-label={`Make a folder named ${group.name}`} />
                  </label>
                  <div className="tidy-group-body">
                    <input className="tidy-name" aria-label="Folder name" value={group.name} maxLength={80} onChange={(event) => update(index, { name: event.currentTarget.value })} />
                    <ul className="tidy-tabs">
                      {group.tabIds.map((id) => <li key={id}>{titles.get(id) ?? 'Tab'}</li>)}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
            <footer className="tidy-foot">
              <button type="button" className="tidy-cancel" onClick={onClose}>Cancel</button>
              <button type="button" className="tidy-accept" disabled={moving === 0} onClick={() => onAccept(chosen.map((group) => ({ name: group.name.trim(), tabIds: group.tabIds })))}>
                Make {chosen.length} {chosen.length === 1 ? 'folder' : 'folders'} ({moving} {moving === 1 ? 'tab' : 'tabs'})
              </button>
            </footer>
          </>
        )}
        {(state.status === 'unavailable' || state.status === 'error') && (
          <footer className="tidy-foot"><button type="button" className="tidy-cancel" onClick={onClose}>Close</button></footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
