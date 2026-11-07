import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { Columns2, Ellipsis, Folder, FolderOpen, FolderPlus, Layers, Mountain, PanelLeftClose, PanelLeftDashed, PanelLeftOpen, Plus, Undo2, Wand2, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type WheelEvent } from 'react'
import { MAX_WORKSPACES, TAB_SIDEBAR_WIDTH, type NowPlayingSnapshot, type PageTabSnapshot, type TabFolderSnapshot, type WorkspacesState } from '@intoponet/browser-api'
import { folderTree } from './tabFolders'
import { storyGroupRequests } from './storyGroups'
import { TidySheet } from './TidySheet'
import type { StoryMatch } from '../../shared/news/storyTabs'
import { NowPlayingControl } from './nowPlaying/NowPlayingControl'
import { useGlassSheen } from './glass/useGlassSheen'
import { RailMenu } from './RailMenu'
import { ACCENT_COLOURS, WorkspaceBar, type WorkspaceRequest } from './WorkspaceBar'
import { moveTabByKey, openTabMenu, TabAudioButton, TabHomeButton, TabIcon, tabSoundLabel, tabStateLabel, useTabDrag } from './tabControls'
import './glass/glass.css'
import './tabRail.css'

const spring: Transition = { type: 'spring', stiffness: 460, damping: 38 }
const EMPTY_MATCHES: ReadonlyMap<string, StoryMatch> = new Map()
/** How long the grouping notice (and its Undo) stays: the same two minutes main keeps the grouping for. */
const NOTICE_MS = 120_000
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
  /** Workspaces and favourites (null until main has said). */
  workspaces?: WorkspacesState | null
  /** The command menu asked to edit, delete or make a workspace. */
  workspaceRequest?: WorkspaceRequest | null
  /** What plays in a tab (the now-playing control at the foot of the rail); null hides it. */
  nowPlaying?: NowPlayingSnapshot | null
  /** Open tabs that are articles of a world story (storyTabs.ts), by tab id. */
  storyMatches?: ReadonlyMap<string, StoryMatch>
  /** A story folder's hover or focus: the globe highlights that story's summit (null when it ends). */
  onStoryHighlight?: ((storyId: string | null) => void) | undefined
  /** Command menu requests (a changing number): Group by story, and Tidy. */
  groupRequest?: number | undefined
  tidyRequest?: number | undefined
}

/** A sideways two-finger swipe on the sidebar this far (in wheel pixels) shows the next or previous workspace. */
const SWIPE_DISTANCE = 60
/** Wheel events further apart than this start a new swipe. */
const SWIPE_GAP_MS = 220

/**
 * Vertical favicon rail beside the browser panel (visionOS-ornament style).
 * Hover expands it to show titles; native page views draw above the UI, so
 * the panel glides right to make room rather than being overlapped. Pin
 * keeps it expanded as vertical tabs. Pinned tabs sit first as icons; tabs
 * can be dragged (or moved with ⌥⇧↑ / ⌥⇧↓) into a new order.
 */
export function TabRail({ tabs, visible, expanded, pinned, width, onWidthChange, onHide, onExpandedChange, onPinnedChange, onNewTab, archivedCount = 0, onUndoArchive, folders = [], renameFolderId = null, onRenameHandled, onSaveFolder, message = '', workspaces = null, workspaceRequest = null, nowPlaying = null, storyMatches = EMPTY_MATCHES, onStoryHighlight, groupRequest, tidyRequest }: TabRailProps) {
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
  // The footer's New workspace and the command menu's requests reach the workspace bar the same way.
  const [barRequest, setBarRequest] = useState<WorkspaceRequest | null>(null)
  useEffect(() => { if (workspaceRequest) setBarRequest(workspaceRequest) }, [workspaceRequest?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeWorkspace = workspaces?.workspaces.find((workspace) => workspace.id === workspaces.activeId)
  /** A sideways swipe in progress: how far it has gone, and whether it already switched. */
  const swipe = useRef({ distance: 0, at: 0, done: false })
  const onWheel = (event: WheelEvent<HTMLElement>): void => {
    if (!workspaces || workspaces.workspaces.length < 2) return
    // Mostly sideways only: scrolling the tab list up and down is left alone.
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return
    const now = performance.now()
    const state = swipe.current
    if (now - state.at > SWIPE_GAP_MS) {
      state.distance = 0
      state.done = false
    }
    state.at = now
    state.distance += event.deltaX
    if (state.done || Math.abs(state.distance) < SWIPE_DISTANCE) return
    // One switch per swipe (the trackpad keeps sending events as it coasts).
    state.done = true
    void window.intoponet.workspaces.switchTo({ step: state.distance > 0 ? 1 : -1 }).catch(() => undefined)
  }
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, visibleTabs.findIndex((tab) => tab.active)))
  // The page a tab would be split in beside: the shown one (not a new tab's start page).
  const shownTabId = tabs.find((tab) => tab.active && !tab.isStartPage)?.id
  const dragHandlers = useTabDrag('y', { indexOf: (id) => tabs.findIndex((tab) => tab.id === id), shownId: shownTabId })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [folderMenu, setFolderMenu] = useState<string | null>(null)
  /** The last grouping (Group by story, or accepted Tidy folders), with Undo while main still keeps it. */
  const [notice, setNotice] = useState<{ text: string; undoId?: string } | null>(null)
  const [tidyOpen, setTidyOpen] = useState(false)
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

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  /** Group the loose matched tabs by their story (folders for stories that have one, or two or more tabs). */
  const groupByStory = (): void => {
    const groups = storyGroupRequests(tabs, storyMatches, folders)
    if (!groups.length) {
      setNotice({ text: 'No loose tabs are from a story yet.' })
      return
    }
    const count = groups.reduce((total, group) => total + group.tabIds.length, 0)
    void window.intoponet.browserHost.groupTabs(groups).then(
      ({ undoId }) => setNotice({ text: `Grouped ${count} ${count === 1 ? 'tab' : 'tabs'} by story`, undoId }),
      () => setNotice({ text: 'Those tabs could not be grouped.' }),
    )
  }

  /** Accepted Tidy folders: the same grouping, so Undo is the same. */
  const acceptTidy = (groups: Array<{ name: string; tabIds: string[] }>): void => {
    setTidyOpen(false)
    const count = groups.reduce((total, group) => total + group.tabIds.length, 0)
    void window.intoponet.browserHost.groupTabs(groups).then(
      ({ undoId }) => setNotice({ text: `Made ${groups.length} ${groups.length === 1 ? 'folder' : 'folders'} (${count} ${count === 1 ? 'tab' : 'tabs'})`, undoId }),
      () => setNotice({ text: 'Those tabs could not be grouped.' }),
    )
  }

  const undoNotice = (): void => {
    const undoId = notice?.undoId
    setNotice(null)
    if (undoId) void window.intoponet.browserHost.undoGroupTabs(undoId).catch(() => setNotice({ text: 'Nothing to undo any more.' }))
  }

  // The command menu's Group by story and Tidy (App's request numbers).
  useEffect(() => {
    if (groupRequest !== undefined) { onExpandedChange(true); groupByStory() }
  }, [groupRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tidyRequest !== undefined) { setTidyOpen(true) }
  }, [tidyRequest]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <div
        key={folder.id}
        className={`tab-rail-folder${folder.collapsed ? ' is-collapsed' : ''}`}
        role="group"
        aria-label={`Folder ${folder.name}`}
        data-story-id={folder.storyId}
        style={{ '--folder-depth': depth - 1 } as CSSProperties}
        onPointerEnter={() => { if (folder.storyId) onStoryHighlight?.(folder.storyId) }}
        onPointerLeave={() => { if (folder.storyId) onStoryHighlight?.(null) }}
        onFocus={() => { if (folder.storyId) onStoryHighlight?.(folder.storyId) }}
        onBlur={(event) => { if (folder.storyId && !event.currentTarget.contains(event.relatedTarget as Node | null)) onStoryHighlight?.(null) }}
      >
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
          <RailMenu
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

  /** A pair of tabs side by side is one row: drawn once, from its left side (the right side is in it). */
  const pairPartner = (tab: PageTabSnapshot): PageTabSnapshot | null => {
    if (!tab.split) return null
    const partner = tabs.find((other) => other.id === tab.split!.partnerId)
    return partner && partner.split?.partnerId === tab.id ? partner : null
  }

  const renderPair = (left: PageTabSnapshot, right: PageTabSnapshot, index: number, setSize: number) => {
    const halves = [left, right]
    const focused = halves.some((half) => half.active)
    return (
      <motion.div
        key={left.id}
        data-tab-id={left.id}
        layout="position"
        className={`tab-rail-item tab-rail-pair-item${focused ? ' is-active' : ''}`}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.14 } }}
        transition={spring}
      >
        {focused && <motion.span layoutId="tab-rail-active" className="tab-rail-indicator" transition={spring} aria-hidden="true" />}
        <div className="tab-rail-pair">
          {halves.map((half, at) => {
            const title = half.title || half.url || 'Untitled page'
            return (
              <button
                key={half.id}
                type="button"
                role="tab"
                className={`tab-rail-tab tab-rail-half${half.active ? ' is-focused' : ''}`}
                aria-selected={half.active}
                aria-setsize={setSize}
                aria-posinset={index + 1}
                aria-label={`${title}, ${at === 0 ? 'left' : 'right'} side by side${half.active ? ', focused' : ''}`}
                tabIndex={half.active || (!focused && at === 0) ? 0 : -1}
                title={title}
                onFocus={() => setFocusIndex(Math.max(0, visibleTabs.indexOf(left)))}
                onClick={() => void window.intoponet.browserHost.activateTab(half.id)}
                onContextMenu={(event) => openTabMenu(event, half.id)}
                {...dragHandlers(half, Math.max(0, visibleTabs.indexOf(half)))}
              >
                <span className="tab-rail-icon">
                  <TabIcon tab={half} size={18} />
                </span>
                <span className="tab-rail-title" aria-hidden={!open}>{title}</span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="tab-rail-close tab-rail-unsplit"
          aria-label="Unsplit these two pages"
          title="Unsplit (⌃⇧-)"
          tabIndex={-1}
          onClick={() => void window.intoponet.browserHost.unsplitTab(left.id)}
        >
          <Columns2 size={12} />
        </button>
      </motion.div>
    )
  }

  const renderTab = (tab: PageTabSnapshot, index: number, setSize: number) => {
    const partner = pairPartner(tab)
    if (partner) return tab.split?.side === 'left' ? renderPair(tab, partner, index, setSize) : null
    const title = tab.title || tab.url || 'Untitled page'
    const story = storyMatches.get(tab.id)
    const label = `${title}${tab.pinned ? ', pinned' : ''}${tabStateLabel(tab)}${tabSoundLabel(tab)}${tab.loading ? ', loading' : ''}${story ? `, part of the story ${story.label}` : ''}`
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
          {story && <span className="tab-rail-story" title={`Part of the story: ${story.label}`} aria-hidden="true"><Mountain size={11} /></span>}
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
          aria-label={activeWorkspace && workspaces && workspaces.workspaces.length > 1 ? `Open tabs in ${activeWorkspace.name}` : 'Open tabs'}
          data-workspace={workspaces?.activeId}
          onWheel={onWheel}
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
            if (!pinned && !tidyOpen && !event.currentTarget.contains(document.activeElement)) onExpandedChange(false)
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
            if (!pinned && !tidyOpen && !event.currentTarget.contains(event.relatedTarget as Node | null)) onExpandedChange(false)
          }}
        >
          <div ref={surface} className="tab-rail-surface lg-surface lg-sheen" style={activeWorkspace ? { "--workspace-accent": ACCENT_COLOURS[activeWorkspace.accent] } as CSSProperties : {}}>
            {workspaces && <WorkspaceBar state={workspaces} open={open} onExpand={() => onExpandedChange(true)} request={barRequest} />}
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
              {archivedCount === 0 && notice && (
                <>
                  <span className="tab-rail-title" aria-hidden={false}>{notice.text}</span>
                  {notice.undoId && (
                    <button type="button" className="tab-rail-undo" onClick={undoNotice} aria-label={`Undo: ${notice.text}`} title="Put the tabs back where they were">
                      <Undo2 size={14} aria-hidden="true" />
                      <span className="tab-rail-title" aria-hidden={!open}>Undo</span>
                    </button>
                  )}
                </>
              )}
              {archivedCount === 0 && !notice && message && <span className="tab-rail-title" aria-hidden={false}>{message}</span>}
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
            <NowPlayingControl nowPlaying={nowPlaying} tabs={tabs} open={open} />
            <div className="tab-rail-footer">
              <button type="button" className="tab-rail-action" aria-label="New tab" title="New tab (⌘T)" onClick={onNewTab}>
                <Plus size={15} />
                <span className="tab-rail-title" aria-hidden={!open}>New tab</span>
              </button>
              {workspaces && workspaces.workspaces.length < MAX_WORKSPACES && (
                <button type="button" className="tab-rail-action" aria-label="New workspace" title="New workspace: its own pinned tabs, folders and open tabs (⌃1–9 switch)" onClick={() => setBarRequest({ kind: 'new', at: Date.now() })}>
                  <Layers size={15} />
                  <span className="tab-rail-title" aria-hidden={!open}>New workspace</span>
                </button>
              )}
              <button type="button" className="tab-rail-action" aria-label="New folder" title="New folder: drag tabs onto it, or use a tab’s menu › Move to Folder" onClick={() => newFolder()}>
                <FolderPlus size={15} />
                <span className="tab-rail-title" aria-hidden={!open}>New folder</span>
              </button>
              {storyMatches.size > 0 && (
                <button type="button" className="tab-rail-action" aria-label="Group by story" title="Put loose tabs about the same world story into a folder for it" onClick={groupByStory}>
                  <Mountain size={15} />
                  <span className="tab-rail-title" aria-hidden={!open}>Group by story</span>
                </button>
              )}
              <button type="button" className="tab-rail-action" aria-label="Tidy tabs" title="Tidy: suggest folders for loose tabs, computed on this Mac with Laya" onClick={() => setTidyOpen(true)}>
                <Wand2 size={15} />
                <span className="tab-rail-title" aria-hidden={!open}>Tidy</span>
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
          {tidyOpen && (
            <TidySheet
              tabs={tabs}
              onAccept={acceptTidy}
              onGroupByStory={() => { setTidyOpen(false); groupByStory() }}
              onClose={() => setTidyOpen(false)}
            />
          )}
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
