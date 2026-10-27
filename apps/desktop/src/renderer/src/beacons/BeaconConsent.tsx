import { useEffect, useState } from 'react'
import { Loader2, Radio, X } from 'lucide-react'
import type { BeaconDraft, BeaconPreview, BeaconState } from '@intoponet/browser-api'
import './beacons.css'

/**
 * Consent screen (PRD BCN-001/002): the exact payload that will leave this
 * Mac, what is never included, and the fact that it becomes public. Nothing
 * is sent until "Publish beacon" is pressed with the box ticked.
 */
export function BeaconConsent({ initial, onClose, onPublished }: { initial: BeaconDraft; onClose: () => void; onPublished: (title: string) => void }) {
  const api = window.intoponet.beacons
  const [draft, setDraft] = useState<BeaconDraft>(initial)
  const [includePlace, setIncludePlace] = useState(!!initial.place)
  const [preview, setPreview] = useState<BeaconPreview | null>(null)
  const [state, setState] = useState<BeaconState | null>(null)
  const [registryDraft, setRegistryDraft] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sent: BeaconDraft = { url: draft.url, title: draft.title, topic: draft.topic, ...(draft.note?.trim() ? { note: draft.note } : {}), ...(includePlace && draft.place ? { place: draft.place } : {}) }

  useEffect(() => { void api.state().then(setState, () => undefined) }, [api])
  useEffect(() => {
    const timer = setTimeout(() => void api.preview(sent).then(setPreview, () => setPreview({ ok: false, reason: 'Could not prepare the beacon.' })), 150)
    return () => clearTimeout(timer)
  }, [draft, includePlace]) // eslint-disable-line react-hooks/exhaustive-deps

  const publish = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await api.publish(sent)
      onPublished(sent.title)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'It could not be published.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="beacon-backdrop" role="dialog" aria-modal="true" aria-labelledby="beacon-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <div className="beacon-sheet">
        <div className="beacon-heading">
          <div>
            <span><Radio size={13} aria-hidden="true" /> Beacon · public</span>
            <h2 id="beacon-title">Recommend this page publicly</h2>
          </div>
          <button type="button" className="beacon-close" aria-label="Cancel" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="beacon-lead">A beacon points others to a page you think is worth finding. It shows on the public field near the place it is about. This is the only way anything you choose leaves this Mac.</p>
        <label><span>Title</span><input value={draft.title} maxLength={180} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label><span>Topic</span><input value={draft.topic} maxLength={80} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} /></label>
        <label><span>Public note <small>optional · visible to everyone</small></span><textarea value={draft.note ?? ''} maxLength={280} rows={2} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="Why it’s worth reading" /></label>
        {initial.place && (
          <label className="beacon-check"><input type="checkbox" checked={includePlace} onChange={(event) => setIncludePlace(event.target.checked)} /> Show it near {initial.place.label} (rounded to about 11 km; this is the place the page is about, not where you are)</label>
        )}
        <div className="beacon-payload">
          <strong>Exactly what will be sent</strong>
          {preview === null ? <p><Loader2 size={12} className="olds-spin" aria-hidden="true" /> Preparing…</p> : preview.ok ? <pre>{preview.json}</pre> : <p className="beacon-error">{preview.reason}</p>}
          <small>Signed with an anonymous key made on this Mac, so only this Mac can withdraw it. The registry never shows that key.</small>
        </div>
        <div className="beacon-never">
          <strong>Never included</strong>
          <span>Your browsing history and footprints · other bookmarks and collections · your private note on this pin · absorbed pages and knowledge · Laya’s index · your location or account</span>
        </div>
        {state && !state.registry && (
          <form className="beacon-registry" onSubmit={(event) => { event.preventDefault(); void api.setRegistry(registryDraft).then(setState, (caught: unknown) => setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Invalid address.')) }}>
            <span>No beacon registry is set up yet. Registry address:</span>
            <input value={registryDraft} onChange={(event) => setRegistryDraft(event.target.value)} placeholder="https://beacons.example.org" />
            <button type="submit">Use it</button>
          </form>
        )}
        <label className="beacon-check"><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /> I understand this is public. I can withdraw it later, but copies other services have already made may not be erasable everywhere.</label>
        {error && <p className="beacon-error" role="alert">{error}</p>}
        <div className="beacon-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="is-primary" disabled={!understood || busy || !preview?.ok || !state?.registry || !state.canSign} onClick={() => void publish()}>
            {busy ? 'Publishing…' : 'Publish beacon'}
          </button>
        </div>
        {state && !state.canSign && <p className="beacon-error">On-device encryption is unavailable, so a beacon key can’t be kept safely.</p>}
      </div>
    </section>
  )
}
