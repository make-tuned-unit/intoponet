import { History, Languages, LockKeyhole, ShieldAlert, Columns2, Lock } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { BrowserPanelBounds, SplitPanelSnapshot, SplitSide, SplitSideSnapshot } from '@intoponet/browser-api'
import { hostIsPaywalled } from '../../shared/news/paywall'
import { learnedPaywalls } from './access/learnedPaywalls'
import './splitPages.css'

/** A rectangle as inline position styles (window coordinates: the shell covers the window). */
export function rectStyle(rect: BrowserPanelBounds): CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
}

/**
 * Where a fixed element's left/top of 0 lands on screen, from where it is (`box`) and where it was
 * placed (`placed`). That is the window's corner, unless an ancestor has a transform: the browser
 * panel is centred with one, so a fixed element inside it is placed from the panel's corner.
 */
export function fixedOrigin(box: { x: number; y: number }, placed: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(box.x - placed.x), y: Math.round(box.y - placed.y) }
}

/**
 * A start or error page: over its side's rect (window coordinates, as the native page views are
 * placed) when it is beside another page, else as it is. Beside another page it measures the box
 * it is placed in and keeps to that rect.
 */
export function SplitStartFrame({ rect, className, children }: { rect: BrowserPanelBounds | undefined; className?: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    const element = frame.current
    if (!element || !rect) return
    const measure = (): void => {
      const box = element.getBoundingClientRect()
      const next = fixedOrigin(box, { x: parseFloat(element.style.left) || 0, y: parseFloat(element.style.top) || 0 })
      setOrigin((current) => (current.x === next.x && current.y === next.y ? current : next))
    }
    measure()
    // The panel slides in when it opens, and the window can change size: measure again after either.
    window.addEventListener('resize', measure)
    window.addEventListener('animationend', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('animationend', measure, true)
    }
  }, [rect?.x, rect?.y, rect?.width, rect?.height])
  return (
    <div
      ref={frame}
      className={`${rect ? 'split-start-frame' : 'split-start-plain'}${className ? ` ${className}` : ''}`}
      style={rect ? rectStyle({ ...rect, x: rect.x - origin.x, y: rect.y - origin.y }) : undefined}
    >
      {children}
    </div>
  )
}

/** The side not in focus when the shell draws it (its error or start page, its view hidden), else null. */
export function shellDrawnSide(split: SplitPanelSnapshot | undefined): { side: SplitSide; tab: SplitSideSnapshot } | null {
  if (!split) return null
  const side: SplitSide = split.focused === 'left' ? 'right' : 'left'
  const tab = split[side]
  return tab.loadError || tab.isStartPage ? { side, tab } : null
}

/**
 * The side not in focus, drawn by the shell in its own half (an error card or the start page) so
 * that half is never empty. A click anywhere in it gives that side the focus.
 */
export function OtherSideFrame({ split, side, children }: { split: SplitPanelSnapshot; side: SplitSide; children: ReactNode }) {
  return (
    <SplitStartFrame rect={split.sides[side]} className="split-other-frame">
      <div className="split-other-side" data-split-side={side} onClick={() => void window.intoponet.browserHost.focusSplitSide(side)}>
        {children}
      </div>
    </SplitStartFrame>
  )
}

/** What a side's header says about its connection: only a plain http page is not secure (a new tab's start page is neither). */
export function sideSecurity(tab: Pick<SplitSideSnapshot, 'url' | 'secure'>): 'secure' | 'not-secure' | 'none' {
  if (tab.secure) return 'secure'
  return /^http:/i.test(tab.url) ? 'not-secure' : 'none'
}

/** The site a side shows: its host without "www.", or the address as it is. */
export function sideHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

const RATIO_STEP = 0.05

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** A Compare side's actions (COMPARE_COVERAGE): translate that side on its own, its free coverage, or The Olds for the story. */
export type CompareActions = {
  translate: (side: SplitSide) => void
  /** Focuses that side (if it is not) and opens its free-coverage choices, even where that bar was closed. */
  freeCoverage: (side: SplitSide) => void
  olds: (storyId: string) => void
}

/** Whether a side's language differs from the reader's, so Translate is offered (the reader's Mac language). */
export function differsFromReader(lang: string | undefined, reader: string = typeof navigator === 'undefined' ? 'en' : navigator.language): boolean {
  if (!lang) return false
  const base = (value: string): string => (value.split('-')[0] ?? '').toLowerCase()
  return base(lang) !== base(reader)
}

type SideHeaderProps = {
  side: SplitSide
  tab: SplitSideSnapshot
  focused: boolean
  rect: BrowserPanelBounds
  actions?: CompareActions | undefined
}

/** A side's header strip: where it is (its origin and security, PRD WEB-006), focus, and Unsplit. */
function SideHeader({ side, tab, focused, rect, actions }: SideHeaderProps) {
  const host = sideHost(tab.url) || 'New tab'
  const name = side === 'left' ? 'Left page' : 'Right page'
  const compare = tab.compare
  const origin = compare ? `${compare.outlet} · ${compare.country}` : host
  const security = sideSecurity(tab)
  return (
    <div
      className={`split-header${focused ? ' is-focused' : ''}${compare ? ' is-compare' : ''}`}
      style={rectStyle(rect)}
      role="group"
      aria-label={`${name}: ${compare ? `${compare.outlet}, ${compare.country}, ` : ''}${host}${security === 'secure' ? ', secure' : security === 'not-secure' ? ', not secure' : ''}`}
      data-split-side={side}
    >
      <button
        type="button"
        className="split-header-focus"
        aria-pressed={focused}
        aria-label={`${focused ? 'Focused' : 'Focus'} ${name.toLowerCase()}, ${origin}`}
        onClick={() => void window.intoponet.browserHost.focusSplitSide(side)}
      >
        {security === 'secure' && <LockKeyhole size={12} aria-hidden="true" />}
        {security === 'not-secure' && <ShieldAlert size={12} aria-hidden="true" />}
        <span className="split-header-origin">{origin}</span>
        {compare && <span className="split-header-host">{host}</span>}
        {security === 'not-secure' && <strong className="split-header-insecure">Not secure</strong>}
      </button>
      {compare && actions && (
        <span className="split-compare-tools">
          {differsFromReader(compare.lang) && (
            <button
              type="button"
              className="split-compare-button"
              title="Translate this side on this Mac"
              aria-label={`Translate ${name.toLowerCase()}, ${compare.outlet}`}
              onClick={() => actions.translate(side)}
            >
              <Languages size={11} aria-hidden="true" /> Translate
            </button>
          )}
          {hostIsPaywalled(tab.url, learnedPaywalls()) && (
            <>
              <span className="split-compare-paywall"><Lock size={10} aria-hidden="true" /> Paywalled</span>
              <button
                type="button"
                className="split-compare-button"
                aria-label={`Free coverage of this story, from other outlets (${compare.outlet})`}
                onClick={() => actions.freeCoverage(side)}
              >
                Free coverage
              </button>
            </>
          )}
          {side === 'left' && (
            <button
              type="button"
              className="split-compare-button"
              title="The history of this story"
              onClick={() => actions.olds(compare.storyId)}
            >
              <History size={11} aria-hidden="true" /> The Olds
            </button>
          )}
        </span>
      )}
      <button
        type="button"
        className="split-header-unsplit"
        aria-label={`Unsplit pages (${name.toLowerCase()} and the other)`}
        title="Unsplit (⌃⇧-)"
        onClick={() => void window.intoponet.browserHost.unsplitTab()}
      >
        Unsplit
      </button>
    </div>
  )
}

export type SplitChromeProps = {
  split: SplitPanelSnapshot | undefined
  preview: { side: SplitSide; zone: BrowserPanelBounds } | undefined
  /** Compare's actions, shown on the sides opened by Compare. */
  compare?: CompareActions | undefined
}

/**
 * What the shell draws over the page area when two pages are side by side: the two header strips,
 * the divider (drag it, or use the arrow keys) and, while a tab is dragged to an edge, the drop zone.
 * The pages themselves are native views under this layer; the strips and the gap are the shell's.
 */
export function SplitChrome({ split, preview, compare }: SplitChromeProps) {
  const [dragging, setDragging] = useState(false)
  const frame = useRef<number | null>(null)
  const pending = useRef<number | null>(null)

  // The divider moves at most once a frame: the latest ratio is sent when the frame comes.
  const sendRatio = (ratio: number): void => {
    pending.current = ratio
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (pending.current !== null) void window.intoponet.browserHost.setSplitRatio(pending.current)
      pending.current = null
    })
  }

  if (!split && !preview) return null

  const onDividerPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (!split || !dragging) return
    const available = split.sides.left.width + split.sides.right.width
    // The divider's middle follows the pointer; the layout clamps what it asks for.
    sendRatio(clampRatio((event.clientX - split.sides.left.x - split.divider.width / 2) / available))
  }

  const onDividerKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!split) return
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = split.ratio - RATIO_STEP
    else if (event.key === 'ArrowRight') next = split.ratio + RATIO_STEP
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = 1
    if (next === null) return
    event.preventDefault()
    void window.intoponet.browserHost.setSplitRatio(clampRatio(next))
  }

  return (
    <>
      {split && (
        <>
          <SideHeader side="left" tab={split.left} focused={split.focused === 'left'} rect={split.headers.left} actions={compare} />
          <SideHeader side="right" tab={split.right} focused={split.focused === 'right'} rect={split.headers.right} actions={compare} />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Divider between the two pages. Arrow keys move it"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(split.ratio * 100)}
            tabIndex={0}
            className={`split-divider${dragging ? ' is-dragging' : ''}`}
            style={rectStyle(split.divider)}
            onKeyDown={onDividerKey}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              setDragging(true)
            }}
            onPointerMove={onDividerPointer}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
          >
            <Columns2 size={12} aria-hidden="true" />
          </div>
        </>
      )}
      {preview && (
        <div className="split-drop-zone" style={rectStyle(preview.zone)} aria-hidden="true">
          <span>Drop to split</span>
        </div>
      )}
    </>
  )
}
