import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type Transition } from 'motion/react'
import { ArrowRight, Bookmark, Globe2, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PageTabSnapshot } from '@intoponet/browser-api'
import { useGlassSheen } from './glass/useGlassSheen'
import './glass/glass.css'
import './tabDock.css'

/** Matches the main-process page-edge tween (TAB_DOCK_TWEEN_MS, ease-out cubic). */
const dockEnter: Transition = { duration: 0.24, ease: [0.33, 1, 0.68, 1] }
const spring: Transition = { type: 'spring', stiffness: 460, damping: 38 }

export type TabDockProps = {
  tabs: PageTabSnapshot[]
  fullWidth: boolean
  visible: boolean
  currentUrl: string
  bookmarksOpen: boolean
  /** Increments to open the dock with its search focused (⌘L in full screen). */
  focusRequest: number
  onNavigate: (value: string) => Promise<void>
  onToggleBookmarks: () => void
}

export function TabDock({ tabs, fullWidth, visible, currentUrl, bookmarksOpen, focusRequest, onNavigate, onToggleBookmarks }: TabDockProps) {
  const reduceMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [held, setHeld] = useState(false)
  const [draft, setDraft] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const slab = useGlassSheen<HTMLDivElement>()
  const pointerInside = useRef(false)
  const handledFocusRequest = useRef(focusRequest)
  const enabled = fullWidth && visible && tabs.length > 0

  useEffect(() => {
    void window.intoponet.browserHost.setFullWidth(fullWidth && visible)
    if (!enabled) {
      setOpen(false)
      setHeld(false)
      void window.intoponet.browserHost.setTabDockOpen(false)
    }
  }, [enabled, fullWidth, visible])

  useEffect(() => {
    void window.intoponet.browserHost.setTabDockOpen(open, open && held)
  }, [open, held])

  useEffect(() => window.intoponet.browserHost.subscribe((event) => {
    if (event.type !== 'tab-dock-state' || event.open) return
    pointerInside.current = false
    setHeld(false)
    setOpen(false)
  }), [])

  useEffect(() => {
    if (focusRequest === handledFocusRequest.current) return
    handledFocusRequest.current = focusRequest
    if (!enabled) return
    setOpen(true)
    setDraft(currentUrl)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      search.current?.focus()
      search.current?.select()
    }))
  }, [currentUrl, enabled, focusRequest])

  if (!enabled) return null

  const close = (): void => {
    pointerInside.current = false
    setHeld(false)
    setOpen(false)
    const active = document.activeElement
    if (active instanceof HTMLElement && root.current?.contains(active)) active.blur()
  }

  const closeUnlessFocused = (): void => {
    pointerInside.current = false
    if (!root.current?.contains(document.activeElement)) setOpen(false)
  }

  return (
    <div
      ref={root}
      className={`tab-dock${open ? ' is-open' : ''}`}
      onPointerEnter={() => {
        pointerInside.current = true
        setOpen(true)
      }}
      onPointerMove={() => {
        if (!pointerInside.current) {
          pointerInside.current = true
          setOpen(true)
        }
      }}
      onPointerLeave={closeUnlessFocused}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !pointerInside.current) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        if (draft && document.activeElement === search.current) setDraft('')
        else close()
      }}
    >
      <button
        className="tab-dock-grabber"
        type="button"
        aria-label={open ? 'Browser dock open. Press Escape to close.' : 'Open browser dock: search and tabs'}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="slab"
            ref={slab}
            className="tab-dock-slab lg-surface lg-sheen"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.97, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.98, filter: 'blur(6px)' }}
            transition={reduceMotion ? { duration: 0.1 } : dockEnter}
          >
            <div className="dock-row dock-row--search">
              <form
                className="dock-search lg-inset"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault()
                  const value = draft.trim()
                  if (!value) return
                  void onNavigate(value).then(() => {
                    setDraft('')
                    close()
                  })
                }}
              >
                <Search size={15} aria-hidden="true" />
                <label className="dock-search-field">
                  <span className="sr-only">Search or enter a web address</span>
                  <input
                    ref={search}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onFocus={() => setHeld(true)}
                    onBlur={() => setHeld(false)}
                    placeholder="Search or enter a web address"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <AnimatePresence initial={false} mode="popLayout">
                  {draft.trim() ? (
                    <motion.button
                      key="go"
                      type="submit"
                      className="dock-go"
                      aria-label="Go"
                      initial={{ opacity: 0, scale: 0.5, rotate: -30 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={spring}
                    >
                      <ArrowRight size={15} />
                    </motion.button>
                  ) : (
                    <motion.kbd key="hint" className="dock-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      ⌘L
                    </motion.kbd>
                  )}
                </AnimatePresence>
              </form>
              <motion.button
                type="button"
                className={`dock-bookmarks${bookmarksOpen ? ' is-active' : ''}`}
                aria-label={bookmarksOpen ? 'Hide bookmarks' : 'Show bookmarks'}
                aria-pressed={bookmarksOpen}
                whileTap={{ scale: 0.9 }}
                transition={spring}
                onClick={onToggleBookmarks}
              >
                <Bookmark size={15} fill={bookmarksOpen ? 'currentColor' : 'none'} />
              </motion.button>
            </div>

            <LayoutGroup id="dock-tabs">
              <div className="dock-row dock-tabs" role="group" aria-label="Open browser tabs">
                {tabs.map((tab, index) => {
                  const title = tab.title || tab.url || 'Untitled page'
                  return (
                    <motion.div
                      key={tab.id}
                      layout="position"
                      className={`dock-tab${tab.active ? ' is-active' : ''}`}
                      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0, transition: { ...spring, delay: reduceMotion ? 0 : 0.04 + Math.min(index, 10) * 0.022 } }}
                    >
                      {tab.active && <motion.span layoutId="dock-active-tab" className="dock-tab-indicator" transition={spring} aria-hidden="true" />}
                      <button
                        className="dock-tab-activate"
                        type="button"
                        aria-current={tab.active ? 'page' : undefined}
                        title={title}
                        onClick={() => void window.intoponet.browserHost.activateTab(tab.id)}
                      >
                        {tab.favicon?.startsWith('data:image/') ? <img src={tab.favicon} alt="" /> : <Globe2 size={14} aria-hidden="true" />}
                        <span>{title}</span>
                      </button>
                      <button
                        className="dock-tab-close"
                        type="button"
                        aria-label={`Close ${title}`}
                        onClick={() => void window.intoponet.browserHost.closeTab(tab.id)}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </motion.div>
                  )
                })}
              </div>
            </LayoutGroup>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
