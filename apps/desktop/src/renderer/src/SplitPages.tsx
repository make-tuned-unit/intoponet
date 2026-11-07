import { History, Languages, LockKeyhole, ShieldAlert, Columns2, Lock } from 'lucide-react'
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { BrowserPanelBounds, SplitPanelSnapshot, SplitSide, SplitSideSnapshot } from '@intoponet/browser-api'
import { hostIsPaywalled } from '../../shared/news/paywall'
import { learnedPaywalls } from './access/learnedPaywalls'
import './splitPages.css'

/** A rectangle as inline position styles (window coordinates: the shell covers the window). */
export function rectStyle(rect: BrowserPanelBounds): CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
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

/** A Compare side's actions (COMPARE_COVERAGE): translate that side on its own, or open The Olds for the story. */
export type CompareActions = {
  translate: (side: SplitSide) => void
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
  return (
    <div
      className={`split-header${focused ? ' is-focused' : ''}${compare ? ' is-compare' : ''}`}
      style={rectStyle(rect)}
      role="group"
      aria-label={`${name}: ${compare ? `${compare.outlet}, ${compare.country}, ` : ''}${host}${tab.secure ? ', secure' : ', not secure'}`}
      data-split-side={side}
    >
      <button
        type="button"
        className="split-header-focus"
        aria-pressed={focused}
        aria-label={`${focused ? 'Focused' : 'Focus'} ${name.toLowerCase()}, ${origin}`}
        onClick={() => { if (!focused) void window.intoponet.browserHost.focusSplitSide(side) }}
      >
        {tab.secure ? <LockKeyhole size={12} aria-hidden="true" /> : <ShieldAlert size={12} aria-hidden="true" />}
        <span className="split-header-origin">{origin}</span>
        {compare && <span className="split-header-host">{host}</span>}
        {!tab.secure && <strong className="split-header-insecure">Not secure</strong>}
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
                onClick={() => { if (!focused) void window.intoponet.browserHost.focusSplitSide(side) }}
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
