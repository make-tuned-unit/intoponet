import { useState } from 'react'
import { BookmarkPlus, FolderPlus } from 'lucide-react'

export const ACCOUNTS_GROUP = 'Accounts'

export type BookmarkSiteOffer = { url: string; title: string; site: string }

/** Group choices: an "Accounts" group first (made on first use), then the rest, up to six. */
export function bookmarkSiteGroups(groups: Array<{ id: string; label: string }>): Array<{ id: string | null; label: string }> {
  const accounts = groups.find((group) => group.label.trim().toLowerCase() === ACCOUNTS_GROUP.toLowerCase())
  const rest = groups.filter((group) => group !== accounts).slice(0, 5)
  return [{ id: accounts?.id ?? null, label: accounts?.label ?? ACCOUNTS_GROUP }, ...rest]
}

/**
 * After a password is saved: bookmark the site into a group in one tap, so every account is easy to reach.
 * `onSave` takes an existing group id, or a label for a group to create.
 */
export function BookmarkSiteBar({ offer, groups, onSave, onDismiss }: {
  offer: BookmarkSiteOffer
  groups: Array<{ id: string; label: string }>
  onSave: (group: { id: string } | { label: string }) => void
  onDismiss: () => void
}) {
  const [naming, setNaming] = useState(false)
  const [label, setLabel] = useState('')
  const choices = bookmarkSiteGroups(groups)
  return (
    <div className="permission-bar password-bar bookmark-site-bar" role="region" aria-label={`Bookmark ${offer.site}`}>
      <span className="permission-bar-ask">
        <BookmarkPlus size={15} aria-hidden="true" />
        <span>
          <strong>Password saved.</strong> Bookmark <strong>{offer.site}</strong> to find this account again?
        </span>
      </span>
      {naming ? (
        <form
          className="permission-bar-actions"
          onSubmit={(event) => {
            event.preventDefault()
            if (label.trim()) onSave({ label: label.trim().slice(0, 60) })
          }}
        >
          <input
            className="bookmark-site-name"
            autoFocus
            value={label}
            maxLength={60}
            placeholder="New group name"
            aria-label="New group name"
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setNaming(false) }}
          />
          <button type="button" onClick={() => setNaming(false)}>Back</button>
          <button type="submit" className="is-primary" disabled={!label.trim()}>Add</button>
        </form>
      ) : (
        <span className="permission-bar-actions password-accounts">
          {choices.map((choice, index) => (
            <button
              key={choice.id ?? 'new-accounts'}
              type="button"
              className={index === 0 ? 'is-primary' : ''}
              onClick={() => onSave(choice.id ? { id: choice.id } : { label: choice.label })}
              title={`Bookmark in ${choice.label}`}
            >
              {choice.label}
            </button>
          ))}
          <button type="button" onClick={() => setNaming(true)} title="Bookmark in a new group">
            <FolderPlus size={12} aria-hidden="true" /> New group
          </button>
          <button type="button" onClick={onDismiss}>Not now</button>
        </span>
      )}
    </div>
  )
}
