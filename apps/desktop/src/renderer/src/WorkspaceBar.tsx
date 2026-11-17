import {
  BookOpen, Briefcase, Code, Ellipsis, FlaskConical, Globe, Heart, House, Leaf, Music, Newspaper, Plane, Star, Undo2, type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { MAX_WORKSPACES, WORKSPACE_ACCENTS, WORKSPACE_ICONS, type FavouriteSnapshot, type WorkspaceAccent, type WorkspaceIcon, type WorkspaceSnapshot, type WorkspacesState } from '@intoponet/browser-api'
import { useFavicon } from './favicons'
import { RailMenu } from './RailMenu'
import { AnchorPicker } from './WorkspaceAnchor'
import { useFocusRescue } from './focusRescue'
import './workspaces.css'
const MAIN_WORKSPACE_ID = 'main'

/** Accents from the brand tokens (brand/brand-tokens.css), by the names main keeps. */
export const ACCENT_COLOURS: Record<WorkspaceAccent, string> = {
  teal: '#20f4e4',
  cyan: '#00c7e4',
  mint: '#a2ffe4',
  violet: '#a69be8',
  peach: '#ff9a85',
  coral: '#ff6856',
}
const ACCENT_NAMES: Record<WorkspaceAccent, string> = { teal: 'Teal', cyan: 'Cyan', mint: 'Mint', violet: 'Violet', peach: 'Peach', coral: 'Coral' }
const ICONS: Record<WorkspaceIcon, LucideIcon> = {
  globe: Globe, briefcase: Briefcase, house: House, book: BookOpen, newspaper: Newspaper, flask: FlaskConical,
  code: Code, heart: Heart, star: Star, plane: Plane, music: Music, leaf: Leaf,
}
const ICON_NAMES: Record<WorkspaceIcon, string> = {
  globe: 'Globe', briefcase: 'Briefcase', house: 'House', book: 'Book', newspaper: 'Newspaper', flask: 'Flask',
  code: 'Code', heart: 'Heart', star: 'Star', plane: 'Plane', music: 'Music', leaf: 'Leaf',
}

export function WorkspaceGlyph({ icon, size = 15 }: { icon: WorkspaceIcon; size?: number }) {
  const Icon = ICONS[icon] ?? Globe
  return <Icon size={size} aria-hidden="true" />
}

/** What the command menu asks of the bar: edit the shown workspace, confirm deleting it, or make a new one. */
export type WorkspaceRequest = { kind: 'edit' | 'delete' | 'new'; at: number }

const clean = (caught: unknown): string => (caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.')
const plural = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`
const siteName = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function FavouriteIcon({ url }: { url: string }) {
  const icon = useFavicon(url)
  if (icon) return <img src={icon} alt="" width={16} height={16} />
  return <span className="tab-rail-favourite-letter" aria-hidden="true">{siteName(url).slice(0, 1).toUpperCase()}</span>
}

/**
 * The top of the tab sidebar: the favourites row (shared by every workspace, or owned by one), and,
 * once there is more than one workspace, the workspaces to switch between (⌃1–9, a click, or a
 * two-finger swipe on the sidebar), with the shown one's name and actions. One workspace and no
 * favourites: nothing here at all.
 */
export function WorkspaceBar({ state, open, onExpand, request }: {
  state: WorkspacesState
  /** The sidebar shows titles (expanded or kept open). */
  open: boolean
  onExpand: () => void
  request: WorkspaceRequest | null
}) {
  const api = window.intoponet.workspaces
  const [menu, setMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [anchoring, setAnchoring] = useState<string | null>(null)
  const [identity, setIdentity] = useState<IdentityChange | null>(null)
  const [message, setMessage] = useState('')
  const switcher = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  // Focus on a control that goes away (the actions of a workspace just deleted, an Undo used or expired, a
  // favourite removed): its Undo, else the shown workspace, else a favourite. Otherwise the tab list takes it.
  useFocusRescue(root, () => [
    root.current?.querySelector<HTMLElement>('.tab-rail-workspace-undo button'),
    switcher.current?.querySelector<HTMLElement>('[aria-current="true"]'),
    root.current?.querySelector<HTMLElement>('.tab-rail-favourite'),
  ])
  const active = state.workspaces.find((workspace) => workspace.id === state.activeId) ?? state.workspaces[0]
  const several = state.workspaces.length > 1
  const favourites = state.favourites.filter((favourite) => favourite.workspaceId === null || favourite.workspaceId === state.activeId)
  const fail = (caught: unknown): void => setMessage(clean(caught))

  const createNew = (): void => {
    setMessage('')
    void api.create().then((next) => {
      setEditing(next.activeId)
      onExpand()
    }, fail)
  }

  useEffect(() => {
    if (!request) return
    onExpand()
    if (request.kind === 'edit') setEditing(state.activeId)
    else if (request.kind === 'delete') {
      if (several) setConfirming(state.activeId)
      else setMessage('The last workspace cannot be deleted.')
    } else createNew()
  }, [request?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  // A message about the last action fades after a while.
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(''), 6_000)
    return () => window.clearTimeout(timer)
  }, [message])

  if (!active) return null
  const index = state.workspaces.indexOf(active)
  /** Read out once, from a live region that is always there (one added with its words may be missed). */
  const announcement = message || (state.recentlyDeleted ? `Deleted workspace ${state.recentlyDeleted.name}. Undo is next to it.` : '')

  /** ←/→ move between workspaces; ⌥⇧←/→ move the focused one. */
  const onSwitcherKey = (event: KeyboardEvent<HTMLButtonElement>, workspace: WorkspaceSnapshot, at: number): void => {
    const buttons = [...(switcher.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    if (event.altKey && event.shiftKey) {
      const to = at + delta
      // Focus stays on the moved workspace (its button is put elsewhere in the row). Only while focus is still in the
      // row, or was dropped: this runs a frame after main answers, and someone who has since gone on (opened the
      // actions menu, started renaming) keeps their place.
      if (to >= 0 && to < state.workspaces.length) void api.move(workspace.id, to).then(() => requestAnimationFrame(() => {
        const focused = document.activeElement
        if (focused && focused !== document.body && !switcher.current?.contains(focused)) return
        switcher.current?.querySelector<HTMLButtonElement>(`[data-workspace-id="${workspace.id}"]`)?.focus()
      }), fail)
      return
    }
    buttons[(at + delta + buttons.length) % buttons.length]?.focus()
  }

  const favouriteMenu = (favourite: FavouriteSnapshot) => (
    <RailMenu
      label={`Actions for favourite ${favourite.title || siteName(favourite.url)}`}
      onClose={() => setMenu(null)}
      items={[
        { label: 'Open', run: () => void api.openFavourite(favourite.id).catch(fail) },
        favourite.workspaceId === null
          ? { label: `Keep for ${active.name} only`, run: () => void api.setFavouriteShared(favourite.id, false).catch(fail) }
          : { label: 'Share with every workspace', run: () => void api.setFavouriteShared(favourite.id, true).catch(fail) },
        { label: 'Remove from favourites', run: () => void api.removeFavourite(favourite.id).catch(fail) },
      ]}
    />
  )

  const editingWorkspace = state.workspaces.find((workspace) => workspace.id === editing)
  const confirmingWorkspace = state.workspaces.find((workspace) => workspace.id === confirming)
  const anchoringWorkspace = state.workspaces.find((workspace) => workspace.id === anchoring)

  return (
    <div ref={root} className="tab-rail-workspace-bar">
      <p className="sr-only" aria-live="polite">{several ? `${active.name} workspace` : ''}</p>
      <p className="sr-only" role="status">{announcement}</p>
      {favourites.length > 0 && (
        <div className="tab-rail-favourites" role="group" aria-label="Favourites">
          {favourites.map((favourite) => {
            const name = favourite.title || siteName(favourite.url)
            return (
              <button
                key={favourite.id}
                type="button"
                className={`tab-rail-favourite${favourite.workspaceId ? ' is-own' : ''}`}
                data-favourite-id={favourite.id}
                aria-label={`${name}${favourite.workspaceId ? `, ${active.name} only` : ''}`}
                title={`${name}${favourite.workspaceId ? ` (${active.name} only)` : ' (every workspace)'}`}
                onClick={() => void api.openFavourite(favourite.id).catch(fail)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  onExpand()
                  setMenu(favourite.id)
                }}
                onKeyDown={(event) => {
                  // ⇧F10 (the Mac sends no context-menu event for it): the favourite's actions.
                  if (event.key !== 'F10' || !event.shiftKey) return
                  event.preventDefault()
                  onExpand()
                  setMenu(favourite.id)
                }}
              >
                <FavouriteIcon url={favourite.url} />
              </button>
            )
          })}
        </div>
      )}
      {favourites.map((favourite) => menu === favourite.id && <div key={favourite.id}>{favouriteMenu(favourite)}</div>)}
      {several && (
        <>
          <div ref={switcher} className="tab-rail-workspaces" role="group" aria-label="Workspaces">
            {state.workspaces.map((workspace, at) => {
              const current = workspace.id === state.activeId
              return (
                <button
                  key={workspace.id}
                  type="button"
                  className={`tab-rail-workspace${current ? ' is-active' : ''}`}
                  style={{ '--accent': ACCENT_COLOURS[workspace.accent] } as CSSProperties}
                  data-workspace-id={workspace.id}
                  aria-current={current ? 'true' : undefined}
                  aria-label={`${workspace.name}, ${plural(workspace.tabCount, 'tab')}`}
                  aria-keyshortcuts={`Control+${at + 1}`}
                  title={`${workspace.name} (⌃${at + 1})`}
                  tabIndex={current ? 0 : -1}
                  onClick={() => { if (!current) void api.switchTo({ id: workspace.id }).catch(fail) }}
                  onKeyDown={(event) => onSwitcherKey(event, workspace, at)}
                >
                  <WorkspaceGlyph icon={workspace.icon} size={15} />
                </button>
              )
            })}
          </div>
          <div className="tab-rail-workspace-head">
            <span className="tab-rail-workspace-name tab-rail-title" aria-hidden={!open} title={active.anchor ? `Anchored to ${active.anchor.label}` : undefined}>{active.name}</span>
            {open && (
              <button
                type="button"
                className="tab-rail-folder-more"
                aria-label={`Actions for workspace ${active.name}`}
                aria-haspopup="menu"
                aria-expanded={menu === 'workspace'}
                onClick={() => setMenu(menu === 'workspace' ? null : 'workspace')}
              >
                <Ellipsis size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </>
      )}
      {menu === 'workspace' && (
        <RailMenu
          label={`Actions for workspace ${active.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename, icon and colour…', run: () => setEditing(active.id) },
            { label: 'Anchor to a place…', run: () => setAnchoring(active.id) },
            ...(active.anchor ? [{ label: 'Remove anchor', run: () => void api.update(active.id, { anchor: null }).catch(fail) }] : []),
            ...(state.workspaces.length < MAX_WORKSPACES ? [{ label: 'New workspace', run: createNew }] : []),
            ...(index > 0 ? [{ label: 'Move left', run: () => void api.move(active.id, index - 1).catch(fail) }] : []),
            ...(index < state.workspaces.length - 1 ? [{ label: 'Move right', run: () => void api.move(active.id, index + 1).catch(fail) }] : []),
            ...(active.id !== MAIN_WORKSPACE_ID ? [{
              label: active.separateSignIns ? 'Share sign-ins with the others…' : 'Separate sign-ins…',
              run: () => setIdentity({ workspace: active, action: active.separateSignIns ? 'off' : 'on' }),
            }] : []),
            ...(active.separateSignIns ? [{ label: 'Clear sign-ins and site data…', run: () => setIdentity({ workspace: active, action: 'clear' }) }] : []),
            { label: 'Delete workspace…', run: () => setConfirming(active.id) },
          ]}
        />
      )}
      {editingWorkspace && <WorkspaceEditor key={editingWorkspace.id} workspace={editingWorkspace} onDone={() => setEditing(null)} onError={fail} />}
      {anchoringWorkspace && <AnchorPicker key={anchoringWorkspace.id} workspace={anchoringWorkspace} onDone={() => setAnchoring(null)} onError={fail} />}
      {identity && (
        <IdentityConfirm
          change={identity}
          onConfirm={() => {
            const { workspace, action } = identity
            setIdentity(null)
            void (action === 'clear' ? api.clearSignIns(workspace.id) : api.update(workspace.id, { separateSignIns: action === 'on' })).catch(fail)
          }}
          onCancel={() => setIdentity(null)}
        />
      )}
      {confirmingWorkspace && (
        <DeleteConfirm
          workspace={confirmingWorkspace}
          onDelete={() => { setConfirming(null); void api.delete(confirmingWorkspace.id).catch(fail) }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {state.recentlyDeleted && (
        <div className="tab-rail-archived tab-rail-workspace-undo">
          <span className="tab-rail-title" aria-hidden={!open}>Deleted “{state.recentlyDeleted.name}”</span>
          <button type="button" className="tab-rail-undo" onClick={() => void api.undoDelete().catch(fail)} aria-label={`Undo: bring back workspace ${state.recentlyDeleted.name} and its ${plural(state.recentlyDeleted.tabCount, 'tab')}`}>
            <Undo2 size={14} aria-hidden="true" />
            <span className="tab-rail-title" aria-hidden={!open}>Undo</span>
          </button>
        </div>
      )}
      {message && <p className="tab-rail-workspace-message" aria-hidden="true">{message}</p>}
    </div>
  )
}

/** A sign-in change the person asked for, waiting for confirmation. */
type IdentityChange = { workspace: WorkspaceSnapshot; action: 'on' | 'off' | 'clear' }

/**
 * "Separate sign-ins" on, off, or cleared, confirmed first. Focus starts on Cancel, so Enter alone never confirms.
 * The words say what happens to the workspace's own sign-ins and site data.
 */
function IdentityConfirm({ change, onConfirm, onCancel }: { change: IdentityChange; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // When the question closes, focus goes back to where it was (the workspace's actions button), not to the page body.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => cancel.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  const name = change.workspace.name
  const copy = change.action === 'on'
    ? { title: `Separate sign-ins for “${name}”?`, detail: `Tabs in ${name} will reload signed out. Sites you are signed in to elsewhere will not know you here.`, button: 'Separate sign-ins', danger: false }
    : change.action === 'off'
      ? { title: `Share sign-ins with the others in “${name}”?`, detail: `${name} will use your shared sign-ins. Its own sign-ins and site data will be deleted.`, button: 'Share sign-ins', danger: true }
      : { title: `Clear sign-ins and site data in “${name}”?`, detail: `Its tabs reload signed out. The other workspaces are not touched.`, button: 'Clear sign-ins', danger: true }
  return (
    <div
      className="tab-rail-workspace-confirm"
      role="alertdialog"
      aria-labelledby="workspace-identity-title"
      aria-describedby="workspace-identity-detail"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
    >
      <p id="workspace-identity-title">{copy.title}</p>
      <p id="workspace-identity-detail">{copy.detail}</p>
      <div className="tab-rail-workspace-buttons">
        <button type="button" className={copy.danger ? 'is-danger' : undefined} onClick={onConfirm}>{copy.button}</button>
        <button ref={cancel} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** "Delete this workspace?" in the sidebar. Focus starts on Cancel, so Enter alone never deletes. */
function DeleteConfirm({ workspace, onDelete, onCancel }: { workspace: WorkspaceSnapshot; onDelete: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // When the question closes, focus goes back to where it was (the workspace's actions button), not to the page body.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => cancel.current?.focus())
    return () => {
      cancelAnimationFrame(frame)
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  return (
    <div
      className="tab-rail-workspace-confirm"
      role="alertdialog"
      aria-labelledby="workspace-delete-title"
      aria-describedby="workspace-delete-detail"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
    >
      <p id="workspace-delete-title">Delete “{workspace.name}”?</p>
      <p id="workspace-delete-detail">{workspace.tabCount ? `Its ${plural(workspace.tabCount, 'tab')} will close.` : 'It has no tabs.'} You can undo this for a few seconds.</p>
      <div className="tab-rail-workspace-buttons">
        <button type="button" className="is-danger" onClick={onDelete}>Delete workspace</button>
        <button ref={cancel} type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** Name, icon and colour of a workspace (named at once when it is new). */
function WorkspaceEditor({ workspace, onDone, onError }: { workspace: WorkspaceSnapshot; onDone: () => void; onError: (caught: unknown) => void }) {
  const [name, setName] = useState(workspace.name)
  const [icon, setIcon] = useState<WorkspaceIcon>(workspace.icon)
  const [accent, setAccent] = useState<WorkspaceAccent>(workspace.accent)
  const nameField = useRef<HTMLInputElement>(null)
  // After a frame: a menu that opened this gives focus back to its button as it closes. A new
  // workspace's new tab then puts focus in the address bar: the name is asked for first, once more.
  // Done or Cancel (or Escape): focus goes back to what opened it (the actions button, New workspace…).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const frame = requestAnimationFrame(() => nameField.current?.focus())
    const again = window.setTimeout(() => {
      const field = nameField.current
      if (field && !field.form?.contains(document.activeElement)) field.focus()
    }, 300)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(again)
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus()
    }
  }, [])
  const save = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = name.trim()
    void window.intoponet.workspaces.update(workspace.id, { ...(trimmed ? { name: trimmed } : {}), icon, accent }).then(onDone, onError)
  }
  return (
    <form
      className="tab-rail-workspace-editor"
      aria-label={`Workspace ${workspace.name}`}
      onSubmit={save}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onDone()
      }}
    >
      <label className="tab-rail-workspace-field">
        <span>Name</span>
        <input ref={nameField} className="tab-rail-workspace-name-input" value={name} maxLength={40} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset className="tab-rail-swatches">
        <legend>Icon</legend>
        {WORKSPACE_ICONS.map((choice) => (
          <label key={choice} className="tab-rail-swatch" title={ICON_NAMES[choice]}>
            <input type="radio" name={`workspace-icon-${workspace.id}`} value={choice} checked={icon === choice} onChange={() => setIcon(choice)} aria-label={ICON_NAMES[choice]} />
            <WorkspaceGlyph icon={choice} size={14} />
          </label>
        ))}
      </fieldset>
      <fieldset className="tab-rail-swatches">
        <legend>Colour</legend>
        {WORKSPACE_ACCENTS.map((choice) => (
          <label key={choice} className="tab-rail-swatch" title={ACCENT_NAMES[choice]}>
            <input type="radio" name={`workspace-accent-${workspace.id}`} value={choice} checked={accent === choice} onChange={() => setAccent(choice)} aria-label={ACCENT_NAMES[choice]} />
            <span className="tab-rail-swatch-colour" style={{ background: ACCENT_COLOURS[choice] }} aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      <div className="tab-rail-workspace-buttons">
        <button type="submit">Done</button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
