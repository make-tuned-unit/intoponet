import { useEffect, useRef, useState } from 'react'
import { Import } from 'lucide-react'
import type { ImportCategory, ImportPreview, ImportProfile, ImportRunResult } from '../../../shared/browserImport'
import type { LibraryImportCounts } from './mergeImport'
import './browserImport.css'

const clean = (caught: unknown): string => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong.')

const CATEGORY_LABELS: Record<ImportCategory, string> = {
  bookmarks: 'Bookmarks',
  pinned: 'Pinned tabs',
  open: 'Open tabs',
  history: 'History',
  passwords: 'Passwords',
}
const SKIP_LABELS: Record<ImportCategory, [string, string]> = {
  bookmarks: ['bookmark', 'bookmarks'],
  pinned: ['pinned tab', 'pinned tabs'],
  open: ['open tab', 'open tabs'],
  history: ['history page', 'history pages'],
  passwords: ['password', 'passwords'],
}
const ORDER: ImportCategory[] = ['bookmarks', 'pinned', 'open', 'history', 'passwords']

const plural = (count: number, one: string, many = `${one}s`): string => `${count.toLocaleString('en')} ${count === 1 ? one : many}`

const profileLabel = (profile: ImportProfile): string => `${profile.browserName} · ${profile.name && profile.name !== profile.folder ? `${profile.name} (${profile.folder})` : profile.folder === 'root' ? 'Profile' : profile.folder}`

/** What a ticked category would bring, in words. */
function countText(category: ImportCategory, preview: ImportPreview): string {
  const { count } = preview.counts[category]
  if (count === null) return 'not available'
  if (category === 'bookmarks') return `${plural(count, 'page')} in ${plural(preview.folders, 'collection')}`
  if (category === 'history') return plural(count, 'page')
  if (category === 'passwords') return plural(count, 'sign-in')
  return plural(count, 'tab')
}

type Summary = { result: ImportRunResult; library: LibraryImportCounts | null; browser: string }

/**
 * Settings › Import from another browser: finds Chromium-based browsers on this Mac, previews
 * what each profile would bring, and imports only what is ticked. History and passwords are off
 * until ticked; passwords make macOS ask for Keychain access to that browser's key first.
 */
export function BrowserImportSettings({ libraryReady, onImportLibrary }: {
  libraryReady: boolean
  /** Merge a library document into the open library; null when it could not be merged. */
  onImportLibrary?: (payload: string) => LibraryImportCounts | null
}) {
  const api = window.intoponet.browserImport
  const [profiles, setProfiles] = useState<ImportProfile[] | null>(null)
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [ticked, setTicked] = useState<Set<ImportCategory>>(new Set())
  const [phase, setPhase] = useState<'idle' | 'finding' | 'previewing' | 'importing'>('idle')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')
  // The merge runs after the import returns; use the library as it is then, not as it was at the click.
  const merge = useRef(onImportLibrary)
  merge.current = onImportLibrary
  const resultRef = useRef<HTMLDivElement>(null)
  // The summary may land below the fold of the drawer: bring it into view.
  useEffect(() => {
    if (summary) resultRef.current?.scrollIntoView({ block: 'nearest' })
  }, [summary])

  const find = (): void => {
    setPhase('finding')
    setError('')
    void api.detect().then((list) => {
      setProfiles(list)
      setPhase('idle')
      if (list.length === 1) choose(list[0]!.id)
    }, (caught: unknown) => {
      setError(clean(caught))
      setPhase('idle')
    })
  }

  const choose = (id: string): void => {
    setSelected(id)
    setPreview(null)
    setSummary(null)
    setError('')
    setPhase('previewing')
    void api.preview(id).then((next) => {
      setPreview(next)
      // Bookmarks and tabs are ticked when there are some; history and passwords only by you.
      setTicked(new Set(ORDER.filter((category) => (category === 'bookmarks' || category === 'pinned' || category === 'open') && (next.counts[category].count ?? 0) > 0)))
      setPhase('idle')
    }, (caught: unknown) => {
      setError(clean(caught))
      setPhase('idle')
    })
  }

  const toggle = (category: ImportCategory, on: boolean): void => {
    setTicked((current) => {
      const next = new Set(current)
      if (on) next.add(category)
      else next.delete(category)
      return next
    })
  }

  const needsLibrary = ticked.has('bookmarks') || ticked.has('pinned')
  const browser = profiles?.find((profile) => profile.id === selected)
  const run = (): void => {
    if (!preview || !browser) return
    if (needsLibrary && !libraryReady) {
      setError('The private library is not open, so nothing was imported.')
      return
    }
    setPhase('importing')
    setError('')
    setSummary(null)
    const categories = ORDER.filter((category) => ticked.has(category))
    void api.run(preview.profileId, categories).then((result) => {
      const library = result.library ? merge.current?.(result.library) ?? null : null
      if (result.library && !library) setError('The bookmarks could not be added to your library.')
      setSummary({ result, library, browser: browser.browserName })
      setPhase('idle')
    }, (caught: unknown) => {
      setError(clean(caught))
      setPhase('idle')
    })
  }

  const busy = phase !== 'idle'
  const added = summary ? [
    summary.library && summary.library.bookmarks > 0 && `${plural(summary.library.bookmarks, 'page')} into your library`,
    summary.library && summary.library.collections > 0 && plural(summary.library.collections, 'new collection'),
    summary.library && summary.library.filed > 0 && !summary.library.collections && `${plural(summary.library.filed, 'page')} filed in collections`,
    summary.result.added.pinned > 0 && plural(summary.result.added.pinned, 'pinned tab'),
    summary.result.added.open > 0 && plural(summary.result.added.open, 'open tab'),
    summary.result.added.history > 0 && plural(summary.result.added.history, 'history page'),
    summary.result.added.passwords > 0 && plural(summary.result.added.passwords, 'password'),
  ].filter((part): part is string => !!part) : []

  return (
    <section className="browser-import" aria-labelledby="browser-import-heading" aria-busy={busy}>
      <h3 id="browser-import-heading"><Import size={13} aria-hidden="true" /> Import from another browser</h3>
      <p>Bring bookmarks, pinned and open tabs, and if you choose, history and passwords from Arc, Chrome, Brave, Edge, Vivaldi and other Chromium browsers on this Mac. It is all read here; nothing is uploaded. Importing again adds nothing twice.</p>
      {profiles === null ? (
        <button type="button" className="settings-primary" onClick={find} disabled={busy}>Find browsers on this Mac</button>
      ) : profiles.length === 0 ? (
        <p>No Chromium-based browsers were found on this Mac.</p>
      ) : (
        <fieldset className="browser-import-group">
          <legend>Browser and profile</legend>
          {profiles.map((profile) => (
            <label key={profile.id} className="privacy-switch">
              <input type="radio" name="browser-import-profile" value={profile.id} checked={selected === profile.id} disabled={busy} onChange={() => choose(profile.id)} />
              <span>{profileLabel(profile)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {phase === 'previewing' && <p role="status">Looking at what this profile holds…</p>}
      {preview && (
        <fieldset className="browser-import-group">
          <legend>What to bring</legend>
          {ORDER.map((category) => {
            const { count, note } = preview.counts[category]
            const id = `browser-import-${category}`
            // One note for both kinds of tab when they say the same thing.
            const repeated = category === 'open' && note === preview.counts.pinned.note
            const showNote = note && !repeated && (category !== 'passwords' || ticked.has('passwords') || count === null)
            return (
              <div key={category} className="browser-import-choice">
                <label className="privacy-switch">
                  <input type="checkbox" checked={ticked.has(category)} disabled={busy || !count} onChange={(event) => toggle(category, event.target.checked)} {...(showNote ? { 'aria-describedby': `${id}-note` } : {})} />
                  <span>{CATEGORY_LABELS[category]} <small>{countText(category, preview)}</small></span>
                </label>
                {showNote && <p id={`${id}-note`} className="browser-import-note">{note}</p>}
              </div>
            )
          })}
          <button type="button" className="settings-primary" disabled={busy || ticked.size === 0} onClick={run}>Import</button>
        </fieldset>
      )}
      {phase === 'importing' && (
        <p className="browser-import-progress" role="status">
          <progress aria-label="Importing" />
          <span>Importing from {browser?.browserName ?? 'the browser'}…{ticked.has('passwords') ? ' macOS may ask for Keychain access.' : ''}</span>
        </p>
      )}
      {summary && (
        <div ref={resultRef} className="browser-import-result" role="status">
          <p>{added.length ? `Brought over from ${summary.browser}: ${added.join(', ')}.` : `Nothing new from ${summary.browser}: everything was already here.`}</p>
          {summary.result.skipped.length > 0 && (
            <>
              <p>Left out:</p>
              <ul>
                {summary.result.skipped.map((item, index) => (
                  <li key={`${item.category}-${index}`}>{plural(item.count, ...SKIP_LABELS[item.category])}: {item.reason.replace(/\.$/, '')}.</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </section>
  )
}
