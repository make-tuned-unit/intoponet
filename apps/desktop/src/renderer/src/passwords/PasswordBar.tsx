import { KeyRound, UserRound } from 'lucide-react'
import { siteLabel, type PasswordPageState } from '../../../shared/passwords'

export const PASSWORD_PRIVACY = 'Encrypted on this Mac with a key kept in your macOS Keychain. Never sent anywhere.'

/**
 * Saved passwords for the page in front, in a bar under the toolbar (pages are drawn above the shell,
 * so this is where the shell can speak): save or update after a sign-in, or pick which account to fill.
 */
export function PasswordBar({ state, picking, onClosePicker, onError }: {
  state: PasswordPageState
  /** The toolbar key button asked for the account list. */
  picking: boolean
  onClosePicker: () => void
  onError: (message: string) => void
}) {
  const api = window.intoponet.passwords
  const { offer } = state
  if (offer) {
    const site = siteLabel(offer.origin)
    const decide = (decision: 'save' | 'never' | 'dismiss'): void => {
      void api.decide(offer.id, decision).catch(() => onError('The password could not be saved. On-device encryption may be unavailable.'))
    }
    return (
      <div className="permission-bar password-bar" role="alertdialog" aria-label={offer.kind === 'update' ? `Update password for ${site}?` : `Save password for ${site}?`}>
        <span className="permission-bar-ask">
          <KeyRound size={15} aria-hidden="true" />
          <span>
            {offer.kind === 'update'
              ? <><strong>Update password</strong> for {offer.username ? <strong>{offer.username}</strong> : 'your account'} on <strong>{site}</strong>?</>
              : <><strong>Save password</strong> for <strong>{site}</strong>{offer.username ? <> as <strong>{offer.username}</strong></> : null}?</>}
            <small className="password-bar-note">{PASSWORD_PRIVACY}</small>
          </span>
        </span>
        <span className="permission-bar-actions">
          <button type="button" onClick={() => decide('never')} title="Never offer to save passwords for this site">Never for this site</button>
          <button type="button" onClick={() => decide('dismiss')}>Not now</button>
          <button type="button" className="is-primary" onClick={() => decide('save')}>{offer.kind === 'update' ? 'Update' : 'Save'}</button>
        </span>
      </div>
    )
  }
  if (!state.accounts.length || !(state.choose || picking)) return null
  const site = siteLabel(state.origin)
  return (
    <div className="permission-bar password-bar" role="region" aria-label={`Saved sign-ins for ${site}`}>
      <span className="permission-bar-ask">
        <KeyRound size={15} aria-hidden="true" />
        <span>Sign in to <strong>{site}</strong> as</span>
      </span>
      <span className="permission-bar-actions password-accounts">
        {state.accounts.slice(0, 8).map((account) => (
          <button
            key={account.id}
            type="button"
            className={account.id === state.filled ? 'is-primary' : ''}
            onClick={() => {
              void api.fill(account.id).then(onClosePicker, () => onError('That sign-in could not be filled on this page.'))
            }}
          >
            <UserRound size={12} aria-hidden="true" /> {account.username || '(no username)'}
          </button>
        ))}
        <button type="button" onClick={() => { onClosePicker(); void api.dismissChoice() }}>Not now</button>
      </span>
    </div>
  )
}
