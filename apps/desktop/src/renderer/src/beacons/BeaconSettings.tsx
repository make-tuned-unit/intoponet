import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'
import type { BeaconState } from '@intoponet/browser-api'

/** Settings › Beacons: the registry address and your published beacons, each withdrawable (BCN-005). */
export function BeaconSettings() {
  const api = window.intoponet.beacons
  const [state, setState] = useState<BeaconState | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const clean = (caught: unknown): string => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong.')
  useEffect(() => { void api.state().then((value) => { setState(value); setDraft(value.registry) }, () => undefined) }, [api])
  if (!state) return null
  return (
    <section>
      <h3><Radio size={13} aria-hidden="true" /> Beacons</h3>
      <p>Beacons are public recommendations you choose to publish from a pin in My map. Only what the consent screen shows is sent.</p>
      <form className="privacy-site-form" onSubmit={(event) => { event.preventDefault(); void api.setRegistry(draft).then((value) => { setState(value); setMessage(value.registry ? 'Registry saved.' : 'Registry removed.') }, (caught: unknown) => setMessage(clean(caught))) }}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="https://beacons.example.org" aria-label="Beacon registry address" />
        <button type="submit">Save</button>
      </form>
      {state.published.length === 0 ? (
        <p>You haven’t published any beacons.</p>
      ) : (
        <ul className="settings-languages">
          {state.published.map((item) => (
            <li key={item.id}>
              <span>{item.title} <small>{new Date(item.publishedAt).toLocaleDateString()}</small></span>
              <button type="button" title="Withdraw: removes it from the registry. Copies others already made may remain." onClick={() => void api.withdraw(item.id).then((value) => { setState(value); setMessage(`Withdrew “${item.title}”.`) }, (caught: unknown) => setMessage(clean(caught)))}>Withdraw</button>
            </li>
          ))}
        </ul>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
