import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { Globe2, PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PageTabSnapshot } from '@intoponet/browser-api'
import { useGlassSheen } from './glass/useGlassSheen'
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
  onNewTab: () => void
}

/**
 * Vertical favicon rail beside the browser panel (visionOS-ornament style).
 * Hover expands it to show titles; native page views draw above the UI, so
 * the panel glides right to make room rather than being overlapped. Pin
 * keeps it expanded as vertical tabs.
 */
export function TabRail({ tabs, visible, expanded, pinned, onExpandedChange, onPinnedChange, onNewTab }: TabRailProps) {
  const reduceMotion = useReducedMotion()
  const surface = useGlassSheen<HTMLDivElement>()
  const list = useRef<HTMLDivElement>(null)
  const intent = useRef<number | null>(null)
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, tabs.findIndex((tab) => tab.active)))
  const open = expanded || pinned

  useEffect(() => {
    const active = tabs.findIndex((tab) => tab.active)
    if (active >= 0) setFocusIndex(active)
  }, [tabs])

  useEffect(() => () => { if (intent.current) window.clearTimeout(intent.current) }, [])

  const focusTab = (index: number): void => {
    const next = Math.max(0, Math.min(tabs.length - 1, index))
    setFocusIndex(next)
    requestAnimationFrame(() => list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus())
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const tab = tabs[focusIndex]
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
              <AnimatePresence initial={false}>
                {tabs.map((tab, index) => {
                  const title = tab.title || tab.url || 'Untitled page'
                  return (
                    <motion.div
                      key={tab.id}
                      layout="position"
                      className={`tab-rail-item${tab.active ? ' is-active' : ''}`}
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
                        aria-label={title}
                        tabIndex={index === focusIndex ? 0 : -1}
                        title={open ? undefined : title}
                        onFocus={() => setFocusIndex(index)}
                        onClick={() => void window.intoponet.browserHost.activateTab(tab.id)}
                        onAuxClick={(event) => {
                          if (event.button === 1) void window.intoponet.browserHost.closeTab(tab.id)
                        }}
                      >
                        <span className="tab-rail-icon">
                          {tab.favicon ? <img src={tab.favicon} alt="" /> : <Globe2 size={15} aria-hidden="true" />}
                        </span>
                        <span className="tab-rail-title" aria-hidden={!open}>{title}</span>
                      </button>
                      <button
                        type="button"
                        className="tab-rail-close"
                        aria-label={`Close ${title}`}
                        tabIndex={-1}
                        onClick={() => void window.intoponet.browserHost.closeTab(tab.id)}
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
            <div className="tab-rail-footer">
              <button type="button" className="tab-rail-action" aria-label="New tab: search or enter an address" title="New tab (⌘L)" onClick={onNewTab}>
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
            </div>
          </div>
        </motion.nav>
      )}
    </AnimatePresence>
  )
}
