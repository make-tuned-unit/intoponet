import { LockKeyhole, ShieldAlert, Columns2 } from 'lucide-react'
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { BrowserPanelBounds, SplitPanelSnapshot, SplitSide, SplitSideSnapshot } from '@intoponet/browser-api'
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

type SideHeaderProps = {
  side: SplitSide
  tab: SplitSideSnapshot
  focused: boolean
  rect: BrowserPanelBounds
}

/** A side's header strip: where it is (its origin and security, PRD WEB-006), focus, and Unsplit. */
function SideHeader({ side, tab, focused, rect }: SideHeaderProps) {
  const host = sideHost(tab.url) || 'New tab'
  const name = side === 'left' ? 'Left page' : 'Right page'
  return (
    <div
      className={`split-header${focused ? ' is-focused' : ''}`}
      style={rectStyle(rect)}
      role="group"
      aria-label={`${name}: ${host}${tab.secure ? ', secure' : ', not secure'}`}
      data-split-side={side}
    >
      <button
        type="button"
        className="split-header-focus"
        aria-pressed={focused}
        aria-label={`${focused ? 'Focused' : 'Focus'} ${name.toLowerCase()}, ${host}`}
        onClick={() => { if (!focused) void window.intoponet.browserHost.focusSplitSide(side) }}
      >
        {tab.secure ? <LockKeyhole size={12} aria-hidden="true" /> : <ShieldAlert size={12} aria-hidden="true" />}
        <span className="split-header-origin">{host}</span>
        {!tab.secure && <strong className="split-header-insecure">Not secure</strong>}
      </button>
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
}

/**
 * What the shell draws over the page area when two pages are side by side: the two header strips,
 * the divider (drag it, or use the arrow keys) and, while a tab is dragged to an edge, the drop zone.
 * The pages themselves are native views under this layer; the strips and the gap are the shell's.
 */
export function SplitChrome({ split, preview }: SplitChromeProps) {
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
          <SideHeader side="left" tab={split.left} focused={split.focused === 'left'} rect={split.headers.left} />
          <SideHeader side="right" tab={split.right} focused={split.focused === 'right'} rect={split.headers.right} />
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
