import { useEffect, useRef, useState } from 'react'
import { Crosshair } from 'lucide-react'
import type { SiteTweak, SiteTweakDraft, SiteTweakListItem, SiteTweakState } from '@intoponet/browser-api'
import './siteTweaks.css'

/**
 * Make a site yours: the "Customize site" panel under the protection bar, and the list in Settings.
 * Everything here is style. Changes go to the main process, which checks them before keeping them.
 */

const api = () => window.intoponet.browserHost.siteTweaks

const WIDTHS: Array<[SiteTweakDraft['width'], string]> = [[undefined, 'Default'], ['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']]
const FONTS: Array<[SiteTweakDraft['font'], string]> = [[undefined, 'Default'], ['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Mono']]
const COLOURS: Array<[SiteTweakDraft['colors'], string]> = [[undefined, 'Default'], ['light', 'Light'], ['dark', 'Dark']]

/** The whole tweak as a draft to save, with one part changed. */
export function draftOf(tweak: SiteTweak | null, patch: Partial<SiteTweakDraft> = {}): SiteTweakDraft {
  return {
    enabled: tweak?.enabled ?? true,
    hidden: tweak?.hidden ?? [],
    width: tweak?.width,
    font: tweak?.font,
    colors: tweak?.colors,
    css: tweak?.css ?? '',
    ...patch,
  }
}

/** What a Settings row says about a site's tweaks, in a few words. */
export function describeTweaks(item: Pick<SiteTweakListItem, 'hiddenCount' | 'hasCss' | 'width' | 'font' | 'colors'>): string {
  const parts: string[] = []
  if (item.hiddenCount) parts.push(`${item.hiddenCount} hidden ${item.hiddenCount === 1 ? 'element' : 'elements'}`)
  if (item.width) parts.push(`${item.width} width`)
  if (item.font) parts.push(`${item.font} font`)
  if (item.colors) parts.push(`${item.colors} colours`)
  if (item.hasCss) parts.push('own styles')
  return parts.join(' · ') || 'No changes'
}

export function SiteTweaksPanel({ pageUrl }: { pageUrl: string }) {
  const [state, setState] = useState<SiteTweakState | null>(null)
  const [css, setCss] = useState('')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const hideButton = useRef<HTMLButtonElement>(null)
  const saveButton = useRef<HTMLButtonElement>(null)
  // Focus follows the picker: on Save once an element is picked, back on Hide an element… once the pick ends
  // without one, or once the picked element is saved or let go (their buttons go away).
  const wasPicked = useRef<string | null>(null)
  const refocusHide = useRef(false)
  useEffect(() => {
    if (picked) saveButton.current?.focus()
    else if (picking) return
    else if (refocusHide.current || (wasPicked.current && (!document.activeElement || document.activeElement === document.body))) hideButton.current?.focus()
    refocusHide.current = false
    wasPicked.current = picked
  }, [picked, picking])

  const load = (): Promise<void> => api().state().then(
    (next) => { setState(next); setCss(next.tweak?.css ?? '') },
    () => setState({ site: null, tweak: null, isPrivate: false }),
  )
  // A new page (or site) may have other tweaks: read them again.
  useEffect(() => {
    setPicked(null)
    setMessage('')
    setError('')
    void load()
  }, [pageUrl])

  const save = async (patch: Partial<SiteTweakDraft>, done: string): Promise<boolean> => {
    const result = await api().save(draftOf(state?.tweak ?? null, patch))
    if (!result.ok) {
      setError(result.error)
      setMessage('')
      return false
    }
    setError('')
    setMessage(done)
    setState((previous) => (previous ? { ...previous, tweak: result.tweak } : previous))
    setCss(result.tweak?.css ?? '')
    return true
  }

  const pick = async (): Promise<void> => {
    setError('')
    // Read out as the page takes the keyboard: how to pick without a mouse.
    setMessage('Click an element on the page, or press Tab to move to one: ↑ takes the element around it, Enter chooses it, Escape stops.')
    setPicking(true)
    try {
      const result = await api().pick()
      if (result.error) setError(result.error)
      else if (result.selector) {
        setPicked(result.selector)
        setMessage('')
      } else setMessage('No element was picked.')
      if (!result.selector) refocusHide.current = true
    } catch {
      setError('The element could not be picked on this page.')
      refocusHide.current = true
    } finally {
      setPicking(false)
    }
  }

  const keepPicked = async (): Promise<void> => {
    if (!picked) return
    if (await save({ hidden: [...(state?.tweak?.hidden ?? []), picked] }, 'Element hidden on this site.')) setPicked(null)
  }

  const dropPicked = (): void => {
    setPicked(null)
    setError('')
    void api().clearPreview()
  }

  const setEnabled = async (enabled: boolean): Promise<void> => {
    const next = await api().setEnabled(enabled)
    setState(next)
    setMessage(enabled ? 'Tweaks are on for this site.' : 'Tweaks are off for this site. Your choices are kept.')
  }

  const removeAll = async (): Promise<void> => {
    await api().remove()
    setPicked(null)
    setCss('')
    setState((previous) => (previous ? { ...previous, tweak: null } : previous))
    setMessage('All tweaks for this site are removed.')
    setError('')
  }

  if (!state) return <section id="site-tweaks-panel" className="site-tweaks" aria-busy="true" aria-label="Customize site"><p>Loading…</p></section>
  if (!state.site) {
    return (
      <section id="site-tweaks-panel" className="site-tweaks" aria-label="Customize site">
        <p className="site-tweaks-note">Site tweaks work on web pages.</p>
      </section>
    )
  }

  const { tweak, site } = state
  const hidden = tweak?.hidden ?? []

  return (
    <section id="site-tweaks-panel" className="site-tweaks" aria-labelledby="site-tweaks-title">
      <h3 id="site-tweaks-title">Customize {site}</h3>
      <p className="site-tweaks-note">
        {state.isPrivate
          ? 'This is a private tab: changes last only until private browsing ends, and nothing is saved.'
          : 'Tweaks apply on every visit to this site, stay on this Mac, and never run a script.'}
      </p>

      <div className="site-tweaks-row">
        <button ref={hideButton} type="button" onClick={() => void pick()} disabled={picking || picked !== null}>
          <Crosshair size={13} aria-hidden="true" /> {picking ? 'Click an element on the page…' : 'Hide an element…'}
        </button>
        {picking && <button type="button" onClick={() => void api().cancelPick()}>Cancel</button>}
      </div>

      {picked && (
        <div className="site-tweaks-picked" role="group" aria-label="Element to hide">
          <span>Hide <code>{picked}</code> on {site}?</span>
          <button ref={saveButton} type="button" className="is-primary" onClick={() => void keepPicked()}>Save</button>
          <button type="button" onClick={dropPicked}>Cancel</button>
        </div>
      )}

      {hidden.length > 0 && (
        <ul className="site-tweaks-hidden" aria-label="Hidden elements">
          {hidden.map((selector) => (
            <li key={selector}>
              <code>{selector}</code>
              <button type="button" aria-label={`Show ${selector} again`} onClick={() => void save({ hidden: hidden.filter((item) => item !== selector) }, 'Shown again.')}>
                Show again
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="site-tweaks-choices">
        <Choice legend="Width" options={WIDTHS} value={tweak?.width} onPick={(value) => void save({ width: value }, 'Width saved.')} />
        <Choice legend="Font" options={FONTS} value={tweak?.font} onPick={(value) => void save({ font: value }, 'Font saved.')} />
        <Choice legend="Colours" options={COLOURS} value={tweak?.colors} onPick={(value) => void save({ colors: value }, 'Colours saved.')} />
      </div>

      <label className="site-tweaks-switch">
        <input type="checkbox" checked={tweak?.enabled === true} disabled={!tweak} onChange={(event) => void setEnabled(event.target.checked)} />
        Tweaks on for this site
      </label>

      <label className="site-tweaks-css">
        <span>Your styles</span>
        <textarea value={css} onChange={(event) => setCss(event.target.value)} rows={4} spellCheck={false} placeholder="p { line-height: 1.7 }" />
      </label>
      <div className="site-tweaks-row">
        <button type="button" onClick={() => void save({ css }, 'Styles saved.')}>Save styles</button>
        <button type="button" onClick={() => void removeAll()} disabled={!tweak}>Remove all</button>
      </div>

      <p className="site-tweaks-status" role="status">{message}</p>
      {error && <p className="site-tweaks-error" role="alert">{error}</p>}
    </section>
  )
}

function Choice<T extends string | undefined>({ legend, options, value, onPick }: {
  legend: string
  options: Array<[T, string]>
  value: T | undefined
  onPick: (value: T) => void
}) {
  return (
    <fieldset className="site-tweaks-choice">
      <legend>{legend}</legend>
      {options.map(([option, label]) => (
        <button key={label} type="button" aria-pressed={(value ?? undefined) === option} onClick={() => onPick(option as T)}>
          {label}
        </button>
      ))}
    </fieldset>
  )
}

/** The Settings list: every site with tweaks, with Turn off or on, and Remove. */
export function SiteTweaksList() {
  const [items, setItems] = useState<SiteTweakListItem[] | null>(null)
  const [error, setError] = useState('')

  const load = (): Promise<void> => api().list().then(setItems, () => setItems([]))
  useEffect(() => {
    void load()
  }, [])

  const change = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
      setError('')
      await load()
    } catch {
      setError('That could not be changed. Try again.')
    }
  }

  return (
    <div className="site-tweaks-list">
      <h3>Site tweaks</h3>
      <p>Changes you made to how sites look. They stay on this Mac and never run a script.</p>
      {items !== null && items.length === 0 && <p className="site-tweaks-note">No site tweaks yet. Open a site and choose Customize site in its protection bar.</p>}
      {items !== null && items.length > 0 && (
        <ul className="site-tweaks-items">
          {items.map((item) => (
            <li key={item.site}>
              <div>
                <strong>{item.site}</strong>
                <span className="site-tweaks-note"> {describeTweaks(item)}{item.enabled ? '' : ' · off'}</span>
              </div>
              <div className="site-tweaks-row">
                <button type="button" aria-label={`${item.enabled ? 'Turn off' : 'Turn on'} site tweaks for ${item.site}`} onClick={() => void change(() => api().setEnabled(!item.enabled, item.site))}>
                  {item.enabled ? 'Turn off' : 'Turn on'}
                </button>
                <button type="button" aria-label={`Remove site tweaks for ${item.site}`} onClick={() => void change(() => api().remove(item.site))}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="site-tweaks-error" role="alert">{error}</p>}
    </div>
  )
}
