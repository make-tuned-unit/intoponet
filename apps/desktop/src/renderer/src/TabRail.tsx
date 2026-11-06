import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { PanelLeftClose, PanelLeftDashed, PanelLeftOpen, Plus, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { TAB_SIDEBAR_WIDTH, type PageTabSnapshot } from '@intoponet/browser-api'
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
}

/**
 * Vertical favicon rail beside the browser panel (visionOS-ornament style).
 * Hover expands it to show titles; native page views draw above the UI, so
 * the panel glides right to make room rather than being overlapped. Pin
 * keeps it expanded as vertical tabs. Pinned tabs sit first as icons; tabs
 * can be dragged (or moved with ⌥⇧↑ / ⌥⇧↓) into a new order.
 */
export function TabRail({ tabs, visible, expanded, pinned, width, onWidthChange, onHide, onExpandedChange, onPinnedChange, onNewTab, archivedCount = 0, onUndoArchive }: TabRailProps) {
  const reduceMotion = useReducedMotion()
  const surface = useGlassSheen<HTMLDivElement>()
  const list = useRef<HTMLDivElement>(null)
  const intent = useRef<number | null>(null)
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, tabs.findIndex((tab) => tab.active)))
  const open = expanded || pinned
  const dragHandlers = useTabDrag('y')
  /** A tab moved from the keyboard keeps focus once the rail shows the new order. */
  const refocus = useRef<string | null>(null)

  const focusTab = (index: number): void => {
    const next = Math.max(0, Math.min(tabs.length - 1, index))
    setFocusIndex(next)
    requestAnimationFrame(() => list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus())
  }

  useEffect(() => {
    const moved = refocus.current ? tabs.findIndex((tab) => tab.id === refocus.current) : -1
    refocus.current = null
    if (moved >= 0) {
      focusTab(moved)
      return
    }
    const active = tabs.findIndex((tab) => tab.active)
    if (active >= 0) setFocusIndex(active)
    // focusTab only reads the latest tabs.
  }, [tabs])

  useEffect(() => () => { if (intent.current) window.clearTimeout(intent.current) }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const tab = tabs[focusIndex]
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
    else if (event.key === 'End') focusTab(tabs.length - 1)
    else if ((event.key === 'Delete' || event.key === 'Backspace') && tab) {
      void window.intoponet.browserHost.closeTab(tab.id)
      focusTab(focusIndex >= tabs.length - 1 ? focusIndex - 1 : focusIndex)
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
  const otherTabs = tabs.filter((tab) => !tab.pinned)

  const renderTab = (tab: PageTabSnapshot, index: number) => {
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
          aria-setsize={tabs.length}
          aria-posinset={index + 1}
          aria-label={label}
          aria-busy={tab.loading || undefined}
          aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
          tabIndex={index === focusIndex ? 0 : -1}
          title={open && !tab.pinned ? undefined : label}
          onFocus={() => setFocusIndex(index)}
          onClick={() => void window.intoponet.browserHost.activateTab(tab.id)}
          onAuxClick={(event) => {
            if (event.button === 1) void window.intoponet.browserHost.closeTab(tab.id)
          }}
          onContextMenu={(event) => openTabMenu(event, tab.id)}
          {...dragHandlers(tab, index)}
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
            <div ref={list} className="tab-rail-list" role="tablist" aria-orientation="vertical" aria-label="Open tabs" onKeyDown={onKeyDown}>
              {pinnedTabs.length > 0 && open && <span className="tab-rail-section" aria-hidden="true">Pinned</span>}
              {pinnedTabs.length > 0 && (
                <div className="tab-rail-pinned" role="none">
                  <AnimatePresence initial={false}>{pinnedTabs.map((tab, index) => renderTab(tab, index))}</AnimatePresence>
                </div>
              )}
              {pinnedTabs.length > 0 && otherTabs.length > 0 && open && <span className="tab-rail-section" aria-hidden="true">Open</span>}
              <div className="tab-rail-group" role="none">
                <AnimatePresence initial={false}>{otherTabs.map((tab, index) => renderTab(tab, pinnedTabs.length + index))}</AnimatePresence>
              </div>
            </div>
            <div className="tab-rail-archived" role="status">
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
