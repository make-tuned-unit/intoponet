import { EyeOff, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { PageTabSnapshot } from '@intoponet/browser-api'
import { moveTabByKey, openTabMenu, tabMenuKey, TabAudioButton, TabHomeButton, TabIcon, tabSoundLabel, tabStateLabel, useTabDrag } from './tabControls'

export type PageTabStripProps = {
  tabs: PageTabSnapshot[]
  stripRef: RefObject<HTMLDivElement | null>
  /** Short text shown on the tab. */
  caption: (tab: PageTabSnapshot) => string
  /** The tab's full name (title or site). */
  label: (tab: PageTabSnapshot) => string
}

/**
 * The horizontal tab strip under the page. Pinned tabs come first and show only their icon;
 * tabs can be dragged (or moved with ⌥⇧← / ⌥⇧→) into a new order; right-click opens the tab menu.
 */
export function PageTabStrip({ tabs, stripRef, caption, label }: PageTabStripProps) {
  // The page a dragged tab would be split in beside: the shown one (not a new tab's start page).
  const dragHandlers = useTabDrag('x', { indexOf: (id) => tabs.findIndex((tab) => tab.id === id), shownId: tabs.find((tab) => tab.active && !tab.isStartPage)?.id })
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  /** A tab moved from the keyboard keeps focus once the strip shows the new order. */
  const refocus = useRef<string | null>(null)
  /** The tab that holds the strip's single Tab stop: the last focused one while it exists, else the active one. */
  const [focusId, setFocusId] = useState<string | null>(null)
  const focusedIndex = tabs.findIndex((tab) => tab.id === focusId)
  const rovingIndex = focusedIndex >= 0 ? focusedIndex : Math.max(0, tabs.findIndex((tab) => tab.active))
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    buttons.current.get(id)?.focus()
  }, [tabs])

  /** Keys on a focused tab (either side of a pair too): ⌥⇧←/→ move it, arrows move between tabs, Delete closes it, ⇧F10 opens its menu. */
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: PageTabSnapshot, index: number): void => {
    if (tabMenuKey(event, tab.id)) return
    if (moveTabByKey(event, tabs, index, 'x') !== null) {
      refocus.current = tab.id
      return
    }
    // One stop in the Tab order; arrows move between tabs, Delete closes one.
    const focusAt = (at: number): void => {
      const next = tabs[Math.max(0, Math.min(tabs.length - 1, at))]
      if (next) buttons.current.get(next.id)?.focus()
    }
    if (event.key === 'ArrowRight') focusAt(index + 1)
    else if (event.key === 'ArrowLeft') focusAt(index - 1)
    else if (event.key === 'Home') focusAt(0)
    else if (event.key === 'End') focusAt(tabs.length - 1)
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      const neighbour = tabs[index + 1] ?? tabs[index - 1]
      refocus.current = neighbour?.id ?? null
      void window.intoponet.browserHost.closeTab(tab.id)
    } else return
    event.preventDefault()
  }

  return (
    <div className="page-tabs" ref={stripRef} role="tablist" aria-label="Open screens">
      {tabs.map((tab, index) => {
        const name = label(tab)
        // Side by side, a pair is one tab: drawn once, from its left side.
        const partner = tab.split ? tabs.find((other) => other.id === tab.split!.partnerId) : undefined
        if (partner && partner.split?.partnerId === tab.id) {
          if (tab.split!.side === 'right') return null
          const halves = [tab, partner]
          return (
            <div key={tab.id} data-tab-id={tab.id} className={`page-tab page-tab-pair${halves.some((half) => half.active) ? ' selected' : ''}${halves.some((half) => half.isPrivate) ? ' is-private' : ''}`}>
              {halves.map((half, at) => (
                <button
                  key={half.id}
                  ref={(element) => { if (element) buttons.current.set(half.id, element); else buttons.current.delete(half.id) }}
                  type="button"
                  role="tab"
                  className={`page-tab-main is-split-half${half.active ? ' is-focused' : ''}`}
                  aria-selected={half.active}
                  aria-label={`${label(half)}${half.isPrivate ? ', private tab' : ''}, ${at === 0 ? 'left' : 'right'} side by side${half.active ? ', focused' : ''}`}
                  tabIndex={half.active || (!halves.some((other) => other.active) && at === 0) ? 0 : -1}
                  title={`${half.isPrivate ? 'Private tab · ' : ''}${label(half)}`}
                  onFocus={() => setFocusId(half.id)}
                  onClick={() => void window.intoponet.browserHost.activateTab(half.id)}
                  onContextMenu={(event) => openTabMenu(event, half.id)}
                  onKeyDown={(event) => onTabKeyDown(event, half, tabs.indexOf(half))}
                  {...dragHandlers(half, index)}
                >
                  <TabIcon tab={half} size={14} />
                  {half.isPrivate && <EyeOff size={11} className="tab-private-mark" aria-hidden="true" />}
                  <span>{caption(half)}</span>
                </button>
              ))}
              <button
                type="button"
                className="page-tab-close"
                tabIndex={-1}
                aria-hidden="true"
                aria-label="Unsplit these two pages"
                onClick={() => void window.intoponet.browserHost.unsplitTab(tab.id)}
              >
                <X size={12} />
              </button>
            </div>
          )
        }
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={`page-tab${tab.active ? ' selected' : ''}${tab.isPrivate ? ' is-private' : ''}${tab.pinned ? ' is-pinned' : ''}${tab.asleep ? ' is-asleep' : ''}`}
          >
            <button
              ref={(element) => { if (element) buttons.current.set(tab.id, element); else buttons.current.delete(tab.id) }}
              type="button"
              role="tab"
              className="page-tab-main"
              aria-selected={tab.active}
              aria-busy={tab.loading || undefined}
              aria-label={tab.pinned ? `${name}${tab.isPrivate ? ', private tab' : ''}, pinned${tabStateLabel(tab)}${tabSoundLabel(tab)}` : undefined}
              aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Delete"
              tabIndex={index === rovingIndex ? 0 : -1}
              title={`${tab.isPrivate ? 'Private tab · ' : ''}${tab.pinned ? 'Pinned · ' : ''}${name}${tab.loading ? ' · Loading' : ''}`}
              onFocus={() => setFocusId(tab.id)}
              onClick={() => void window.intoponet.browserHost.activateTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) void window.intoponet.browserHost.closeTab(tab.id)
              }}
              onContextMenu={(event) => openTabMenu(event, tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, tab, index)}
              {...dragHandlers(tab, index)}
            >
              <TabIcon tab={tab} size={14} />
              {tab.isPrivate && <EyeOff size={11} className="tab-private-mark" role="img" aria-label="Private tab" />}
              {!tab.pinned && <span>{caption(tab)}</span>}
              {!tab.pinned && (tabSoundLabel(tab) || tabStateLabel(tab)) && <span className="sr-only">{tabStateLabel(tab)}{tabSoundLabel(tab)}</span>}
            </button>
            {/* Out of the Tab order (only tabs belong in a tab list): Delete and the tab menu reach them. */}
            <TabHomeButton tab={tab} className="page-tab-audio page-tab-home" />
            <TabAudioButton tab={tab} className="page-tab-audio" focusable={false} />
            {!tab.pinned && (
              <button
                type="button"
                className="page-tab-close"
                tabIndex={-1}
                aria-hidden="true"
                aria-label={`Close ${name}`}
                onClick={() => void window.intoponet.browserHost.closeTab(tab.id)}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
