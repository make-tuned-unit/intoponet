import { useEffect, useRef, useState } from 'react'
import { Globe2, X } from 'lucide-react'
import type { PageTabSnapshot } from '@intoponet/browser-api'
import './tabDock.css'

export function TabDock({ tabs, fullWidth, visible }: { tabs: PageTabSnapshot[]; fullWidth: boolean; visible: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const pointerInside = useRef(false)

  useEffect(() => {
    const enabled = fullWidth && visible
    void window.intoponet.browserHost.setFullWidth(enabled)
    if (!enabled) {
      setOpen(false)
      void window.intoponet.browserHost.setTabDockOpen(false)
    }
  }, [fullWidth, visible])

  useEffect(() => {
    void window.intoponet.browserHost.setTabDockOpen(open)
  }, [open])

  useEffect(() => window.intoponet.browserHost.subscribe((event) => {
    if (event.type !== 'tab-dock-state' || event.open) return
    pointerInside.current = false
    setOpen(false)
  }), [])

  if (!fullWidth || !visible || tabs.length === 0) return null

  const closeUnlessFocused = (): void => {
    pointerInside.current = false
    if (!root.current?.contains(document.activeElement)) setOpen(false)
  }

  return (
    <div
      ref={root}
      className={`tab-dock${open ? ' is-open' : ''}`}
      aria-label="Open browser tabs"
      onPointerEnter={() => {
        pointerInside.current = true
        setOpen(true)
      }}
      onPointerMove={() => {
        pointerInside.current = true
        setOpen(true)
      }}
      onPointerLeave={closeUnlessFocused}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !pointerInside.current) {
          setOpen(false)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setOpen(false)
          requestAnimationFrame(() => {
            const active = document.activeElement
            if (active instanceof HTMLElement) active.blur()
          })
        }
      }}
    >
      <button
        className="tab-dock-trigger"
        type="button"
        aria-label={open ? 'Tab dock open. Press Escape to close.' : 'Open tab dock'}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className={open ? '' : 'sr-only'}>{open ? 'Tabs' : 'Open tab dock'}</span>
      </button>
      {open && (
        <div className="tab-dock-content">
          <div className="tab-dock-tabs" role="group" aria-label="Open browser tabs">
            {tabs.map((tab) => {
              const title = tab.title || tab.url || 'Untitled page'
              return (
                <div key={tab.id} className={`tab-dock-item${tab.active ? ' active' : ''}`}>
                  <button
                    className="tab-dock-activate"
                    type="button"
                    aria-current={tab.active ? 'page' : undefined}
                    title={title}
                    onClick={() => void window.intoponet.browserHost.activateTab(tab.id)}
                  >
                    {tab.favicon ? <img src={tab.favicon} alt="" /> : <Globe2 size={14} aria-hidden="true" />}
                    <span>{title}</span>
                  </button>
                  <button
                    className="tab-dock-close"
                    type="button"
                    aria-label={`Close ${title}`}
                    onClick={() => void window.intoponet.browserHost.closeTab(tab.id)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
