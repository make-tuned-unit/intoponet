import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react'
import { siteLabel, type PasswordVaultStatus, type SavedLogin } from '../../../shared/passwords'
import { PASSWORD_PRIVACY } from './PasswordBar'
import { useWorkspaceNames } from '../workspaceNames'

const clean = (caught: unknown): string => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong.')

/** Settings › Passwords: saved sign-ins by site; showing or copying one asks for Touch ID first. */
export function PasswordSettings() {
  const api = window.intoponet.passwords
  const [logins, setLogins] = useState<SavedLogin[] | null>(null)
  const [never, setNever] = useState<string[]>([])
  const [status, setStatus] = useState<PasswordVaultStatus | null>(null)
  const [query, setQuery] = useState('')
  const workspaceNames = useWorkspaceNames()
  const [shown, setShown] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')

  const load = useCallback(() => {
    void Promise.all([api.list(), api.neverList(), api.status()]).then(([list, sites, vault]) => {
      setLogins(list)
      setNever(sites)
      setStatus(vault)
    }, () => setLogins([]))
  }, [api])
  useEffect(() => {
    load()
    return api.subscribe((event) => { if (event.type === 'changed') load() })
  }, [api, load])
  // Shown passwords hide again after a minute.
  useEffect(() => {
    if (!Object.keys(shown).length) return
    const timer = setTimeout(() => setShown({}), 60_000)
    return () => clearTimeout(timer)
  }, [shown])

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase()
    return (logins ?? []).filter((login) => !words || `${siteLabel(login.origin)} ${login.username}`.toLowerCase().includes(words))
  }, [logins, query])

  const reveal = (login: SavedLogin): void => {
    if (shown[login.id] !== undefined) {
      setShown(({ [login.id]: _hidden, ...rest }) => rest)
      return
    }
    void api.reveal(login.id).then((password) => {
      if (password === null) setMessage('Not shown.')
      else setShown((current) => ({ ...current, [login.id]: password }))
    }, (caught: unknown) => setMessage(clean(caught)))
  }
  const copy = (login: SavedLogin): void => {
    void api.copy(login.id).then((copied) => setMessage(copied ? `Copied the password for ${siteLabel(login.origin)}. It is cleared from the clipboard in 30 seconds.` : 'Not copied.'), (caught: unknown) => setMessage(clean(caught)))
  }
  const remove = (login: SavedLogin): void => {
    void api.remove(login.id).then(() => {
      setMessage(`Removed ${login.username || 'the sign-in'} for ${siteLabel(login.origin)}.`)
      load()
    }, (caught: unknown) => setMessage(clean(caught)))
  }

  return (
    <section className="password-settings" aria-labelledby="password-settings-heading">
      <h3 id="password-settings-heading"><KeyRound size={13} aria-hidden="true" /> Passwords</h3>
      <p>Sign in once and Intoponet offers to save it, then fills it in next time. {PASSWORD_PRIVACY} Private tabs are never saved or filled.</p>
      {status && !status.available && <p className="settings-error" role="alert">On-device encryption is unavailable, so passwords cannot be saved right now.</p>}
      {status?.unreadable && <p className="settings-error" role="alert">Saved passwords could not be opened on this Mac. They are left as they are, and nothing new is saved.</p>}
      {logins === null ? null : logins.length === 0 ? (
        <p>No saved passwords yet.</p>
      ) : (
        <>
          {logins.length > 6 && (
            <input className="password-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sites and usernames" aria-label="Search saved passwords" />
          )}
          <ul className="password-list">
            {visible.map((login) => (
              <li key={login.id}>
                <span className="password-entry">
                  <strong>{siteLabel(login.origin)}</strong>
                  <small>{login.username || '(no username)'}</small>
                  {login.workspaceId && <small className="password-workspace">{workspaceNames[login.workspaceId] ?? 'Deleted workspace'}</small>}
                  {shown[login.id] !== undefined && <code className="password-shown">{shown[login.id]}</code>}
                </span>
                <span className="password-actions">
                  <button type="button" aria-label={shown[login.id] !== undefined ? `Hide the password for ${siteLabel(login.origin)}` : `Show the password for ${siteLabel(login.origin)}`} title={shown[login.id] !== undefined ? 'Hide' : 'Show (asks for Touch ID)'} onClick={() => reveal(login)}>
                    {shown[login.id] !== undefined ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button type="button" aria-label={`Copy the password for ${siteLabel(login.origin)}`} title="Copy (asks for Touch ID; cleared after 30 seconds)" onClick={() => copy(login)}>
                    <Copy size={13} />
                  </button>
                  <button type="button" aria-label={`Remove the saved password for ${siteLabel(login.origin)}`} title="Remove" onClick={() => remove(login)}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            ))}
            {visible.length === 0 && <li><small>Nothing matches.</small></li>}
          </ul>
        </>
      )}
      {never.length > 0 && (
        <>
          <p>Never saved for:</p>
          <ul className="privacy-sites">
            {never.map((origin) => (
              <li key={origin}>
                {siteLabel(origin)}
                <button type="button" aria-label={`Offer to save passwords for ${siteLabel(origin)} again`} onClick={() => void api.removeNever(origin).then(load, (caught: unknown) => setMessage(clean(caught)))}>×</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
