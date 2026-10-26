import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import type { CaptureRecord } from '@intoponet/browser-api'
import { Bookmark, BookmarkPlus, Check, ChevronRight, FolderOpen, FolderPlus, Pencil, Play, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import type { SavedBookmark, SavedCollection } from './localLibrary'
import { attachCaptures, bookmarkHost, formatDuration, groupBookmarks, groupOf, hostHue, siteLabel, UNSORTED_GROUP_ID } from './bookmarkGroups'
import { useGlassSheen } from './glass/useGlassSheen'
import './glass/glass.css'
import './bookmarkPane.css'
import './captures/captures.css'

// Groups are open unless collapsed, so new and freshly loaded groups start open.
const collapsedKey = 'intoponet.bookmark-pane.collapsed.v2'
const filterKey = 'intoponet.bookmark-pane.filter.v1'
type PaneFilter = 'all' | 'pages' | 'captures'
const filters: Array<[PaneFilter, string]> = [['all', 'All'], ['pages', 'Pages'], ['captures', 'Captures']]
const dragType = 'application/x-intoponet-bookmark'
export const BOOKMARK_PANE_WIDTH_PX = 328

const spring: Transition = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
const softSpring: Transition = { type: 'spring', stiffness: 300, damping: 34 }

function readCollapsed(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(collapsedKey) ?? '[]') as unknown
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeCollapsed(collapsed: Set<string>): void {
  try {
    localStorage.setItem(collapsedKey, JSON.stringify([...collapsed]))
  } catch {
    // Pane state is a convenience; storage failure must not break navigation.
  }
}

export type BookmarkPaneProps = {
  open: boolean
  /** `attached`: flush with the full-width browser edge. `floating`: a glass card. */
  placement: 'attached' | 'floating'
  bookmarks: SavedBookmark[]
  collections: SavedCollection[]
  currentPage: { url: string; title: string } | null
  onOpen: (bookmark: SavedBookmark) => void
  onSaveCurrent: (groupId: string) => void
  onRemove: (url: string) => void
  onCreateGroup: (label: string) => string | null
  onRenameGroup: (id: string, label: string) => void
  onDeleteGroup: (id: string) => void
  onMove: (url: string, fromGroupId: string, toGroupId: string) => void
  onClose: () => void
  captures: CaptureRecord[]
  /** Briefly highlighted after it is saved. */
  freshCaptureId: string | null
  onOpenCapture: (id: string) => void
  onMoveCapture: (id: string, groupId: string | null) => void
  /** Open the group's capture folder in Finder. */
  onOpenFolder: (groupId: string | null) => void
}

function Monogram({ url }: { url: string }) {
  const site = siteLabel(url)
  const hue = hostHue(site)
  return (
    <span className="bm-monogram" style={{ '--bm-hue': hue } as CSSProperties} aria-hidden="true">
      {(site.replace(/[^a-z0-9]/gi, '')[0] ?? '•').toUpperCase()}
    </span>
  )
}

export function BookmarkPane(props: BookmarkPaneProps) {
  const reduceMotion = useReducedMotion()
  return (
    <AnimatePresence>
      {props.open && (
        <motion.aside
          key="bookmark-pane"
          className={`bookmark-pane bookmark-pane--${props.placement}`}
          aria-label="Bookmarks"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 28, scale: 0.985, filter: 'blur(10px)' }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 22, scale: 0.99, filter: 'blur(8px)' }}
          transition={reduceMotion ? { duration: 0.12 } : spring}
        >
          <PaneBody {...props} />
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function PaneBody({
  bookmarks,
  collections,
  currentPage,
  onOpen,
  onSaveCurrent,
  onRemove,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMove,
  onClose,
  captures,
  freshCaptureId,
  onOpenCapture,
  onMoveCapture,
  onOpenFolder,
}: BookmarkPaneProps) {
  const reduceMotion = useReducedMotion()
  const [filter, setFilterState] = useState<PaneFilter>(() => {
    try {
      const stored = localStorage.getItem(filterKey)
      return stored === 'pages' || stored === 'captures' ? stored : 'all'
    } catch { return 'all' }
  })
  const setFilter = (next: PaneFilter): void => {
    setFilterState(next)
    try { localStorage.setItem(filterKey, next) } catch { /* convenience only */ }
  }
  const surface = useGlassSheen<HTMLDivElement>()
  const searchInput = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed)
  const reveal = (id: string): void => setCollapsed((current) => {
    if (!current.has(id)) return current
    const next = new Set(current)
    next.delete(id)
    return next
  })
  const [hovered, setHovered] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null)
  const [creating, setCreating] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [saveGroup, setSaveGroup] = useState<string>(UNSORTED_GROUP_ID)

  const groups = useMemo(() => attachCaptures(groupBookmarks(bookmarks, collections, query), captures, query), [bookmarks, captures, collections, query])
  const showPages = filter !== 'captures'
  const showCaptures = filter !== 'pages'
  const searching = query.trim().length > 0
  const currentSaved = currentPage ? bookmarks.some((bookmark) => bookmark.url === currentPage.url) : false
  const currentGroupId = currentPage && currentSaved ? groupOf(collections, currentPage.url) : null
  const currentGroupLabel = currentGroupId === UNSORTED_GROUP_ID
    ? 'Unsorted'
    : collections.find((collection) => collection.id === currentGroupId)?.label

  useEffect(() => writeCollapsed(collapsed), [collapsed])
  useEffect(() => {
    if (saveGroup !== UNSORTED_GROUP_ID && !collections.some((collection) => collection.id === saveGroup)) setSaveGroup(UNSORTED_GROUP_ID)
  }, [collections, saveGroup])

  const toggle = (id: string): void => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const isExpanded = (id: string, count: number) => (searching ? count > 0 : !collapsed.has(id))

  const commitCreate = (): void => {
    const label = creating?.trim()
    setCreating(null)
    if (!label) return
    const id = onCreateGroup(label)
    if (id) reveal(id)
  }

  const commitRename = (): void => {
    if (renaming?.draft.trim()) onRenameGroup(renaming.id, renaming.draft)
    setRenaming(null)
  }

  const onDrop = (event: DragEvent, toGroupId: string): void => {
    event.preventDefault()
    setDragOver(null)
    try {
      const payload = JSON.parse(event.dataTransfer.getData(dragType)) as { kind?: unknown; url?: unknown; id?: unknown; from?: unknown }
      if (payload.kind === 'capture' && typeof payload.id === 'string') {
        onMoveCapture(payload.id, toGroupId === UNSORTED_GROUP_ID ? null : toGroupId)
        reveal(toGroupId)
      } else if (typeof payload.url === 'string' && typeof payload.from === 'string') {
        onMove(payload.url, payload.from, toGroupId)
        reveal(toGroupId)
      }
    } catch {
      // Ignore drops that did not start from a bookmark row.
    }
  }

  const onPaneKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (renaming) return setRenaming(null)
    if (creating !== null) return setCreating(null)
    if (query) return setQuery('')
    onClose()
  }

  return (
    <div ref={surface} className="bm-surface lg-surface lg-sheen" onKeyDown={onPaneKeyDown}>
      <header className="bm-header">
        <div className="bm-title">
          <Bookmark size={15} aria-hidden="true" />
          <h2>Bookmarks</h2>
          {bookmarks.length > 0 && <span className="bm-count">{bookmarks.length}</span>}
        </div>
        <button type="button" className="lg-icon-button" aria-label="Close bookmarks" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <label className="bm-search lg-inset">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">Search bookmarks</span>
        <input
          ref={searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search bookmarks"
          autoComplete="off"
          spellCheck={false}
        />
        <AnimatePresence>
          {query && (
            <motion.button
              type="button"
              className="bm-search-clear"
              aria-label="Clear search"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={softSpring}
              onClick={() => {
                setQuery('')
                searchInput.current?.focus()
              }}
            >
              <X size={12} />
            </motion.button>
          )}
        </AnimatePresence>
      </label>

      <div className="bm-filter" role="radiogroup" aria-label="Show">
        {filters.map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={filter === value} onClick={() => setFilter(value)}>
            {filter === value && <motion.span layoutId="bm-filter-pill" className="bm-filter-pill" transition={spring} aria-hidden="true" />}
            <span>{label}</span>
          </button>
        ))}
      </div>

      {currentPage && (
        <motion.section layout="position" className="bm-current lg-inset" aria-label="Current page" transition={spring}>
          <Monogram url={currentPage.url} />
          <div className="bm-current-text">
            <strong title={currentPage.title}>{currentPage.title || bookmarkHost(currentPage.url)}</strong>
            <AnimatePresence mode="wait" initial={false}>
              {currentSaved ? (
                <motion.span key="saved" className="bm-saved" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={softSpring}>
                  <Check size={11} aria-hidden="true" /> Saved in {currentGroupLabel}
                </motion.span>
              ) : (
                <motion.label key="unsaved" className="bm-save-target" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={softSpring}>
                  <span>Save to</span>
                  <select value={saveGroup} onChange={(event) => setSaveGroup(event.target.value)} aria-label="Group for this page">
                    {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.label}</option>)}
                    <option value={UNSORTED_GROUP_ID}>Unsorted</option>
                  </select>
                </motion.label>
              )}
            </AnimatePresence>
          </div>
          <motion.button
            type="button"
            className={`bm-save-button${currentSaved ? ' is-saved' : ''}`}
            aria-label={currentSaved ? 'Remove this page from bookmarks' : 'Save this page'}
            whileTap={{ scale: 0.9 }}
            transition={softSpring}
            onClick={() => {
              if (currentSaved) onRemove(currentPage.url)
              else {
                onSaveCurrent(saveGroup)
                reveal(saveGroup)
              }
            }}
          >
            {currentSaved ? <Check size={15} /> : <BookmarkPlus size={15} />}
          </motion.button>
        </motion.section>
      )}

      <div className="bm-groups-wrap">
        <div className="bm-groups" aria-label="Bookmark groups" onPointerLeave={() => setHovered(null)}>
          {groups.map((group) => {
            const shownBookmarks = showPages ? group.bookmarks : []
            const shownCaptures = showCaptures ? group.captures : []
            const itemCount = shownBookmarks.length + shownCaptures.length
            const open = isExpanded(group.id, itemCount)
            const bodyId = `bm-group-${group.id}`
            return (
              <motion.section
                layout="position"
                transition={spring}
                key={group.id}
                className={`bm-group${dragOver === group.id ? ' is-drop-target' : ''}${open ? ' is-open' : ''}`}
                aria-label={group.label}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(dragType)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  if (dragOver !== group.id) setDragOver(group.id)
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(null)
                }}
                onDrop={(event) => onDrop(event, group.id)}
              >
                <div className="bm-group-header">
                  {renaming?.id === group.id ? (
                    <input
                      className="bm-inline-input lg-inset"
                      autoFocus
                      value={renaming.draft}
                      aria-label={`Rename ${group.label}`}
                      maxLength={80}
                      onChange={(event) => setRenaming({ id: group.id, draft: event.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename()
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="bm-group-toggle"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => !searching && toggle(group.id)}
                      onDoubleClick={() => group.editable && setRenaming({ id: group.id, draft: group.label })}
                    >
                      <motion.span className="bm-chevron" animate={{ rotate: open ? 90 : 0 }} transition={spring} aria-hidden="true">
                        <ChevronRight size={14} />
                      </motion.span>
                      <span className="bm-group-label">{group.label}</span>
                      <motion.span key={itemCount} className="bm-group-count" initial={{ scale: 1.35, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={softSpring}>
                        {itemCount}
                      </motion.span>
                    </button>
                  )}
                  {renaming?.id !== group.id && (
                    <button
                      type="button"
                      className={`lg-icon-button bm-folder${group.captures.length > 0 ? ' has-captures' : ''}`}
                      aria-label={`Show ${group.label} captures in Finder`}
                      title="Show in Finder"
                      onClick={() => onOpenFolder(group.id === UNSORTED_GROUP_ID ? null : group.id)}
                    >
                      <FolderOpen size={13} />
                    </button>
                  )}
                  {group.editable && renaming?.id !== group.id && (
                    <div className="bm-group-actions">
                      <button type="button" className="lg-icon-button" aria-label={`Rename ${group.label}`} onClick={() => setRenaming({ id: group.id, draft: group.label })}>
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className={`lg-icon-button${confirmDelete === group.id ? ' is-danger' : ''}`}
                        aria-label={confirmDelete === group.id ? `Confirm delete ${group.label}. Bookmarks stay saved.` : `Delete group ${group.label}`}
                        onBlur={() => setConfirmDelete(null)}
                        onClick={() => {
                          if (confirmDelete === group.id) {
                            setConfirmDelete(null)
                            onDeleteGroup(group.id)
                          } else setConfirmDelete(group.id)
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      id={bodyId}
                      key="body"
                      className="bm-group-body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={reduceMotion ? { duration: 0 } : { height: spring, opacity: { duration: 0.18 } }}
                    >
                      {itemCount === 0 && (
                        <p className="bm-empty">{searching ? 'No matches' : group.id === UNSORTED_GROUP_ID ? 'Save a page or capture one to start.' : 'Drag bookmarks or captures here.'}</p>
                      )}
                      {shownBookmarks.length > 0 && (
                        <ul>
                          <AnimatePresence initial={false}>
                            {shownBookmarks.map((bookmark, index) => {
                              const rowKey = `${group.id}:${bookmark.url}`
                              return (
                                <motion.li
                                  key={bookmark.url}
                                  layout="position"
                                  className="bm-item"
                                  initial={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
                                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { ...spring, delay: reduceMotion ? 0 : Math.min(index, 8) * 0.018 } }}
                                  exit={{ opacity: 0, x: 18, transition: { duration: 0.16 } }}
                                  onPointerEnter={() => setHovered(rowKey)}
                                  onFocus={() => setHovered(rowKey)}
                                >
                                  {hovered === rowKey && (
                                    <motion.span layoutId="bm-hover" className="bm-hover-pill" transition={spring} aria-hidden="true" />
                                  )}
                                  <button
                                    type="button"
                                    className="bm-item-open"
                                    draggable
                                    title={bookmark.url}
                                    onDragStart={(event) => {
                                      event.dataTransfer.effectAllowed = 'move'
                                      event.dataTransfer.setData(dragType, JSON.stringify({ kind: 'bookmark', url: bookmark.url, from: group.id }))
                                      event.dataTransfer.setData('text/uri-list', bookmark.url)
                                    }}
                                    onDragEnd={() => setDragOver(null)}
                                    onClick={() => onOpen(bookmark)}
                                  >
                                    <Monogram url={bookmark.url} />
                                    <span className="bm-item-text">
                                      <strong>{bookmark.title || bookmarkHost(bookmark.url)}</strong>
                                      <small>{bookmarkHost(bookmark.url)}</small>
                                    </span>
                                  </button>
                                  <button type="button" className="lg-icon-button bm-item-remove" aria-label={`Remove ${bookmark.title || bookmarkHost(bookmark.url)}`} onClick={() => onRemove(bookmark.url)}>
                                    <X size={13} />
                                  </button>
                                </motion.li>
                              )
                            })}
                          </AnimatePresence>
                        </ul>
                      )}
                      {shownCaptures.length > 0 && (
                        <ul className="bm-captures" aria-label={`Captures in ${group.label}`}>
                          {shownCaptures.map((capture, index) => (
                            <motion.li
                              key={capture.id}
                              layout="position"
                              initial={{ opacity: 0, scale: 0.86, filter: 'blur(6px)' }}
                              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: { ...spring, delay: reduceMotion ? 0 : Math.min(index, 9) * 0.02 } }}
                              exit={{ opacity: 0, scale: 0.86, transition: { duration: 0.16 } }}
                            >
                              <button
                                type="button"
                                className={`bm-capture${capture.id === freshCaptureId ? ' is-new' : ''}`}
                                draggable
                                title={`${capture.title}\n${new Date(capture.createdAt).toLocaleString()}`}
                                aria-label={`${capture.kind === 'image' ? 'Screenshot' : 'Recording'}: ${capture.title}`}
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData(dragType, JSON.stringify({ kind: 'capture', id: capture.id, from: group.id }))
                                }}
                                onDragEnd={() => setDragOver(null)}
                                onClick={() => onOpenCapture(capture.id)}
                              >
                                <motion.img layoutId={`capture-${capture.id}`} src={window.intoponet.captures.mediaUrl(capture, 'thumb')} alt="" draggable={false} />
                                {capture.kind === 'video' && (
                                  <span className="bm-capture-badge">
                                    <Play size={8} fill="currentColor" aria-hidden="true" />
                                    {formatDuration(capture.durationMs ?? 0)}
                                  </span>
                                )}
                              </button>
                            </motion.li>
                          ))}
                        </ul>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            )
          })}
        </div>
      </div>

      <footer className="bm-footer">
        <AnimatePresence mode="wait" initial={false}>
          {creating === null ? (
            <motion.button key="new" type="button" className="bm-new-group" onClick={() => setCreating('')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={softSpring}>
              <FolderPlus size={14} aria-hidden="true" /> New group
            </motion.button>
          ) : (
            <motion.form
              key="create"
              className="bm-create"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={softSpring}
              onSubmit={(event) => {
                event.preventDefault()
                commitCreate()
              }}
            >
              <input
                className="bm-inline-input lg-inset"
                autoFocus
                value={creating}
                maxLength={80}
                placeholder="Group name, e.g. Banking"
                aria-label="New group name"
                onChange={(event) => setCreating(event.target.value)}
                onBlur={commitCreate}
              />
            </motion.form>
          )}
        </AnimatePresence>
      </footer>
    </div>
  )
}
