import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { Ellipsis, Folder, FolderOpen, FolderPlus, PanelLeftClose, PanelLeftDashed, PanelLeftOpen, Plus, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { TAB_SIDEBAR_WIDTH, type PageTabSnapshot, type TabFolderSnapshot } from '@intoponet/browser-api'
import { folderTree } from './tabFolders'
import { useGlassSheen } from './glass/useGlassSheen'
import { moveTabByKey, openTabMenu, TabAudioButton, TabHomeButton, TabIcon, tabSoundLabel, tabStateLabel, useTabDrag } from './tabControls'
import './glass/glass.css'
import './tabRail.css'

const spring: Transition = { type: 'spring', stiffness: 460, damping: 38 }
/** Hover this long before the rail expands, so a known favicon can be clicked like an app icon. */
const HOVER_INTENT_MS = 1000

export type TabRailProps = {
  tabs: PageTabSnapshot[]
  visible: boolean
  expanded: boolean
  pinned: boolean
  onExpandedChange: (expanded: boolean) => void
  onPinnedChange: (pinned: boolean) => void
  /** Kept-open width in pixels (resizable from the rail's edge). */
  width: number
  onWidthChange: (width: number) => void
  /** Hide the sidebar (⌃⌘S); the window's left edge brings it back. */
  onHide: () => void
  onNewTab: () => void
  /** Tabs tidied away just now (Undo for 10 seconds). */
  archivedCount?: number
  onUndoArchive?: () => void
  /** Folders (unpinned tabs only), and a folder to name now (just made from the tab menu). */
  folders?: TabFolderSnapshot[]
  renameFolderId?: string | null
  onRenameHandled?: () => void
  /** Save a folder (and the folders in it) as private collections. */
  onSaveFolder?: (folderId: string) => void
  /** A short message for the sidebar's status line (e.g. a folder was saved). */
  message?: string
}

/**
 * Vertical favicon rail beside the browser panel (visionOS-ornament style).
 * Hover expands it to show titles; native page views draw above the UI, so
 * the panel glides right to make room rather than being overlapped. Pin
 * keeps it expanded as vertical tabs. Pinned tabs sit first as icons; tabs
 * can be dragged (or moved with ⌥⇧↑ / ⌥⇧↓) into a new order.
 */
export function TabRail({ tabs, visible, expanded, pinned, width, onWidthChange, onHide, onExpandedChange, onPinnedChange, onNewTab, archivedCount = 0, onUndoArchive, folders = [], renameFolderId = null, onRenameHandled, onSaveFolder, message = '' }: TabRailProps) {
  const reduceMotion = useReducedMotion()
  const surface = useGlassSheen<HTMLDivElement>()
  const list = useRef<HTMLDivElement>(null)
  const intent = useRef<number | null>(null)
  const open = expanded || pinned
  // Folders, and the tabs shown: pinned, then each open folder's tabs (depth first), then the rest.
  const tree = folderTree(folders)
  const folderIds = new Set(folders.map((folder) => folder.id))
  const shownFolder = (id: string): boolean => {
    let current = folders.find((folder) => folder.id === id)
    while (current) {
      if (current.collapsed) return false
      current = current.parentId ? folders.find((folder) => folder.id === current!.parentId) : undefined
    }
    return true
  }
  const inFolder = (tab: PageTabSnapshot): string | null => (!tab.pinned && tab.folderId && folderIds.has(tab.folderId) ? tab.folderId : null)
  const visibleTabs = [
    ...tabs.filter((tab) => tab.pinned),
    ...tree.flatMap(({ folder }) => (shownFolder(folder.id) ? tabs.filter((tab) => inFolder(tab) === folder.id) : [])),
    ...tabs.filter((tab) => !tab.pinned && !inFolder(tab)),
  ]
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, visibleTabs.findIndex((tab) => tab.active)))
  const dragHandlers = useTabDrag('y', { indexOf: (id) => tabs.findIndex((tab) => tab.id === id) })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [folderMenu, setFolderMenu] = useState<string | null>(null)
  useEffect(() => {
    if (!renameFolderId) return
    setRenaming(renameFolderId)
    onExpandedChange(true)
    onRenameHandled?.()
  }, [renameFolderId]) // eslint-disable-line react-hooks/exhaustive-deps
  /** A tab moved from the keyboard keeps focus once the rail shows the new order. */
  const refocus = useRef<string | null>(null)

  const focusTab = (index: number): void => {
    const next = Math.max(0, Math.min(visibleTabs.length - 1, index))
    setFocusIndex(next)
    requestAnimationFrame(() => list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus())
  }

  useEffect(() => {
    const moved = refocus.current ? visibleTabs.findIndex((tab) => tab.id === refocus.current) : -1
    refocus.current = null
    if (moved >= 0) {
      focusTab(moved)
      return
    }
    const active = visibleTabs.findIndex((tab) => tab.active)
    if (active >= 0) setFocusIndex(active)
    // focusTab only reads the latest tabs.
  }, [tabs, folders])

  useEffect(() => () => { if (intent.current) window.clearTimeout(intent.current) }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Keys in a folder's name field or menu are theirs.
    if (!(event.target as HTMLElement).closest('[data-tab-id]')) return
    const tab = visibleTabs[focusIndex]
    // The tab that has focus (after a drag it can differ from the remembered one).
    const focusedId = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]')?.dataset['tabId']
    const focusedIndex = tabs.findIndex((item) => item.id === focusedId)
    if (focusedIndex >= 0 && moveTabByKey(event, tabs, focusedIndex, 'y') !== null) {
      refocus.current = focusedId ?? null
      return
    }
    if (event.key === 'ArrowDown') focusTab(focusIndex + 1)
    else if (event.key === 'ArrowUp') focusTab(focusIndex - 1)
    else if (event.key === 'Home') focusTab(0)
    else if (event.key === 'End') focusTab(visibleTabs.length - 1)
    else if ((event.key === 'Delete' || event.key === 'Backspace') && tab) {
      void window.intoponet.browserHost.closeTab(tab.id)
      focusTab(focusIndex >= visibleTabs.length - 1 ? focusIndex - 1 : focusIndex)
    } else return
    event.preventDefault()
  }

  /** Dragging the edge resizes the kept-open sidebar; saved when the drag ends. */
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const clampWidth = (value: number): number => Math.round(Math.min(TAB_SIDEBAR_WIDTH.max, Math.max(TAB_SIDEBAR_WIDTH.min, value)))
  useEffect(() => {
    if (dragWidth === null) return
    document.documentElement.style.setProperty('--rail-drag-width', `${dragWidth}px`)
    return () => { document.documentElement.style.removeProperty('--rail-drag-width') }
  }, [dragWidth])

  const pinnedTabs = tabs.filter((tab) => tab.pinned)
  const otherTabs = tabs.filter((tab) => !tab.pinned && !inFolder(tab))

  const newFolder = (parentId: string | null = null): void => {
    void window.intoponet.browserHost.createTabFolder(parentId ? 'New folder' : 'New folder', parentId).then((folder) => {
      setRenaming(folder.id)
      onExpandedChange(true)
    }, () => undefined)
  }

  const renderFolder = (folder: TabFolderSnapshot, depth: number) => {
    const folderTabs = tabs.filter((tab) => inFolder(tab) === folder.id)
    const children = tree.filter(({ folder: child }) => child.parentId === folder.id)
    const listId = `tab-folder-${folder.id}`
    const count = folderTabs.length
    return (
      <div key={folder.id} className={`tab-rail-folder${folder.collapsed ? ' is-collapsed' : ''}`} role="group" aria-label={`Folder ${folder.name}`} style={{ '--folder-depth': depth - 1 } as CSSProperties}>
        <div className="tab-rail-folder-head" data-folder-drop={folder.id}>
          {renaming === folder.id ? (
            <input
              className="tab-rail-folder-name"
              aria-label="Folder name"
              defaultValue={folder.name}
              autoFocus
              maxLength={80}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                else if (event.key === 'Escape') {
                  event.preventDefault()
                  event.currentTarget.value = folder.name
                  event.currentTarget.blur()
                }
                event.stopPropagation()
              }}
              onBlur={(event) => {
                const name = event.currentTarget.value.trim()
                if (name && name !== folder.name) void window.intoponet.browserHost.updateTabFolder(folder.id, { name })
                setRenaming(null)
              }}
            />
          ) : (
            <button
              type="button"
              className="tab-rail-folder-toggle"
              aria-expanded={!folder.collapsed}
              aria-controls={count ? listId : undefined}
              title={open ? undefined : `${folder.name} (${count})`}
              onClick={() => void window.intoponet.browserHost.updateTabFolder(folder.id, { collapsed: !folder.collapsed })}
            >
              <span className="tab-rail-icon">{folder.collapsed ? <Folder size={16} aria-hidden="true" /> : <FolderOpen size={16} aria-hidden="true" />}</span>
              <span className="tab-rail-title">{folder.name}</span>
              <span className="tab-rail-folder-count" aria-label={`${count} ${count === 1 ? 'tab' : 'tabs'}`}>{count}</span>
            </button>
          )}
          {open && renaming !== folder.id && (
            <button
              type="button"
              className="tab-rail-folder-more"
              aria-label={`Actions for folder ${folder.name}`}
              aria-haspopup="menu"
              aria-expanded={folderMenu === folder.id}
              onClick={() => setFolderMenu(folderMenu === folder.id ? null : folder.id)}
            >
              <Ellipsis size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {folderMenu === folder.id && (
          <FolderMenu
            onClose={() => setFolderMenu(null)}
            items={[
              { label: 'Rename', run: () => setRenaming(folder.id) },
              { label: 'New folder inside', run: () => newFolder(folder.id) },
              { label: 'Save as collection', run: () => onSaveFolder?.(folder.id) },
              { label: 'Delete folder (keeps its tabs)', run: () => void window.intoponet.browserHost.deleteTabFolder(folder.id) },
            ]}
          />
        )}
        {!folder.collapsed && (
          <>
            {count > 0 && (
              <div id={listId} className="tab-rail-folder-tabs" role="tablist" aria-orientation="vertical" aria-label={`Tabs in ${folder.name}`}>
                <AnimatePresence initial={false}>{folderTabs.map((tab, index) => renderTab(tab, index, count))}</AnimatePresence>
              </div>
            )}
            {children.map(({ folder: child, depth: childDepth }) => renderFolder(child, childDepth))}
          </>
        )}
      </div>
    )
  }

  const renderTab = (tab: PageTabSnapshot, index: number, setSize: number) => {
    const title = tab.title || tab.url || 'Untitled page'
    const label = `${title}${tab.pinned ? ', pinned' : ''}${tabStateLabel(tab)}${tabSoundLabel(tab)}${tab.loading ? ', loading' : ''}`
    return (
      <motion.div
        key={tab.id}
        data-tab-id={tab.id}
        layout="position"
        className={`tab-rail-item${tab.active ? ' is-active' : ''}${tab.pinned ? ' is-pinned-tab' : ''}${tab.asleep ? ' is-asleep' : ''}`}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.14 } }}
        transition={spring}
      >
        {tab.active && <motion.span layoutId="tab-rail-active" className="tab-rail-indicator" transition={spring} aria-hidden="true" />}
        <button
          type="button"
          role="tab"
          className="tab-rail-tab"
          aria-selected={tab.active}
          aria-setsize={setSize}
          aria-posinset={index + 1}
          aria-label={label}
          aria-busy={tab.loading || undefined}
          aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
          tabIndex={visibleTabs.indexOf(tab) === focusIndex ? 0 : -1}
          title={open && !tab.pinned ? undefined : label}
          onFocus={() => setFocusIndex(Math.max(0, visibleTabs.indexOf(tab)))}
          onClick={() => void window.intoponet.browserHost.activateTab(tab.id)}
          onAuxClick={(event) => {
            if (event.button === 1) void window.intoponet.browserHost.closeTab(tab.id)
          }}
          onContextMenu={(event) => openTabMenu(event, tab.id)}
          {...dragHandlers(tab, Math.max(0, visibleTabs.indexOf(tab)))}
        >
          <span className="tab-rail-icon">
            <TabIcon tab={tab} size={18} />
          </span>
          <span className="tab-rail-title" aria-hidden={!open}>{title}</span>
        </button>
        <TabHomeButton tab={tab} className="tab-rail-home" />
        <TabAudioButton tab={tab} className="tab-rail-audio" focusable={false} />
        <button
          type="button"
          className="tab-rail-close"
          aria-label={`Close ${title}`}
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => void window.intoponet.browserHost.closeTab(tab.id)}
        >
          <X size={12} />
        </button>
      </motion.div>
    )
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          key="tab-rail"
          className={`tab-rail${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}
          aria-label="Open tabs"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -18, filter: 'blur(8px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -14, filter: 'blur(6px)' }}
          transition={reduceMotion ? { duration: 0.12 } : spring}
          onPointerEnter={() => {
            if (pinned || expanded) return
            intent.current = window.setTimeout(() => onExpandedChange(true), HOVER_INTENT_MS)
          }}
          onPointerLeave={(event) => {
            if (intent.current) window.clearTimeout(intent.current)
            intent.current = null
            if (!pinned && !event.currentTarget.contains(document.activeElement)) onExpandedChange(false)
          }}
          onPointerDownCapture={() => {
            // A click means the favicon was enough: don't expand after it.
            if (intent.current) window.clearTimeout(intent.current)
            intent.current = null
          }}
          onFocusCapture={(event) => {
            // Keyboard focus expands at once; focus from a click does not.
            if (!pinned && (event.target as HTMLElement).matches(':focus-visible')) onExpandedChange(true)
          }}
          onBlurCapture={(event) => {
            if (!pinned && !event.currentTarget.contains(event.relatedTarget as Node | null)) onExpandedChange(false)
          }}
        >
          <div ref={surface} className="tab-rail-surface lg-surface lg-sheen">
            <div ref={list} className="tab-rail-list" data-tab-container onKeyDown={onKeyDown}>
              {pinnedTabs.length > 0 && open && <span className="tab-rail-section" aria-hidden="true">Pinned</span>}
              {pinnedTabs.length > 0 && (
                <div className="tab-rail-pinned" role="tablist" aria-orientation="vertical" aria-label="Pinned tabs">
                  <AnimatePresence initial={false}>{pinnedTabs.map((tab, index) => renderTab(tab, index, pinnedTabs.length))}</AnimatePresence>
                </div>
              )}
              {pinnedTabs.length > 0 && (otherTabs.length > 0 || tree.length > 0) && open && <span className="tab-rail-section" aria-hidden="true">Open</span>}
              {tree.filter(({ depth }) => depth === 1).map(({ folder, depth }) => renderFolder(folder, depth))}
              {otherTabs.length > 0 && (
                <div className="tab-rail-group" role="tablist" aria-orientation="vertical" aria-label="Open tabs">
                  <AnimatePresence initial={false}>{otherTabs.map((tab, index) => renderTab(tab, index, otherTabs.length))}</AnimatePresence>
                </div>
              )}
            </div>
            <div className="tab-rail-archived" role="status">
              {archivedCount === 0 && message && <span className="tab-rail-title" aria-hidden={false}>{message}</span>}
              {archivedCount > 0 && (
                <>
                  <span className="tab-rail-title" aria-hidden={!open}>{archivedCount} {archivedCount === 1 ? 'tab' : 'tabs'} archived</span>
                  <button type="button" className="tab-rail-undo" onClick={onUndoArchive} aria-label={`Undo: reopen ${archivedCount} archived ${archivedCount === 1 ? 'tab' : 'tabs'}`} title="Reopen them">
                    <Undo2 size={14} aria-hidden="true" />
                    <span className="tab-rail-title" aria-hidden={!open}>Undo</span>
                  </button>
                </>
              )}
            </div>
            <div className="tab-rail-footer">
              <button type="button" className="tab-rail-action" aria-label="New tab" title="New tab (⌘T)" onClick={onNewTab}>
                <Plus size={15} />
                <span className="tab-rail-title" aria-hidden={!open}>New tab</span>
              </button>
              <button type="button" className="tab-rail-action" aria-label="New folder" title="New folder: drag tabs onto it, or use a tab’s menu › Move to Folder" onClick={() => newFolder()}>
                <FolderPlus size={15} />
                <span className="tab-rail-title" aria-hidden={!open}>New folder</span>
              </button>
              <button
                type="button"
                className={`tab-rail-action${pinned ? ' is-active' : ''}`}
                aria-pressed={pinned}
                aria-label={pinned ? 'Unpin tabs: collapse to icons' : 'Pin tabs open'}
                title={pinned ? 'Collapse to icons' : 'Keep tabs open'}
                onClick={() => onPinnedChange(!pinned)}
              >
                {pinned ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
                <span className="tab-rail-title" aria-hidden={!open}>{pinned ? 'Collapse' : 'Keep open'}</span>
              </button>
              <button type="button" className="tab-rail-action" aria-label="Hide tab sidebar" title="Hide (⌃⌘S). Rest the pointer at the window’s left edge to bring it back." onClick={onHide}>
                <PanelLeftDashed size={15} />
                <span className="tab-rail-title" aria-hidden={!open}>Hide</span>
              </button>
            </div>
          </div>
          {pinned && (
            <div
              className="tab-rail-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Tab sidebar width"
              aria-valuemin={TAB_SIDEBAR_WIDTH.min}
              aria-valuemax={TAB_SIDEBAR_WIDTH.max}
              aria-valuenow={dragWidth ?? width}
              tabIndex={0}
              onPointerDown={(event) => {
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0
                setDragWidth(clampWidth(event.clientX - left))
              }}
              onPointerMove={(event) => {
                if (dragWidth === null) return
                const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0
                setDragWidth(clampWidth(event.clientX - left))
              }}
              onPointerUp={() => {
                if (dragWidth !== null) onWidthChange(dragWidth)
                setDragWidth(null)
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 48 : 16
                if (event.key === 'ArrowLeft') onWidthChange(clampWidth(width - step))
                else if (event.key === 'ArrowRight') onWidthChange(clampWidth(width + step))
                else return
                event.preventDefault()
              }}
            />
          )}
        </motion.nav>
      )}
    </AnimatePresence>
  )
}

/** A folder's actions: a small menu in the sidebar (↑ ↓ to move, Enter to choose, Escape to close). */
function FolderMenu({ items, onClose }: { items: Array<{ label: string; run: () => void }>; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => opener?.focus?.()
  }, [])
  return (
    <div
      ref={root}
      className="tab-rail-folder-menu"
      role="menu"
      onKeyDown={(event) => {
        const entries = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
        const at = entries.indexOf(document.activeElement as HTMLButtonElement)
        if (event.key === 'ArrowDown') entries[(at + 1) % entries.length]?.focus()
        else if (event.key === 'ArrowUp') entries[(at - 1 + entries.length) % entries.length]?.focus()
        else if (event.key === 'Escape') onClose()
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose() }}
    >
      {items.map((item) => (
        <button key={item.label} type="button" role="menuitem" tabIndex={-1} onClick={() => { onClose(); item.run() }}>{item.label}</button>
      ))}
    </div>
  )
}
