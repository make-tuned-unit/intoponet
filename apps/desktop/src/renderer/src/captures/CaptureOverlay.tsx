import { motion, useReducedMotion, type Transition } from 'motion/react'
import { Camera, Circle, Maximize2, Video, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CaptureCrop, PendingCapture } from '@intoponet/browser-api'
import { useGlassSheen } from '../glass/useGlassSheen'
import '../glass/glass.css'
import './captures.css'

export type CaptureMode = 'image' | 'video'
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type Drag =
  | { kind: 'new'; anchorX: number; anchorY: number }
  | { kind: 'move'; startX: number; startY: number; origin: CaptureCrop }
  | { kind: 'resize'; handle: Handle; origin: CaptureCrop }

const spring: Transition = { type: 'spring', stiffness: 460, damping: 36 }
const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const FULL: CaptureCrop = { x: 0, y: 0, width: 1, height: 1 }
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Normalize a crop so width/height are positive and inside the frame. */
export function normalizeCrop(x1: number, y1: number, x2: number, y2: number): CaptureCrop {
  const left = clamp01(Math.min(x1, x2))
  const top = clamp01(Math.min(y1, y2))
  return { x: left, y: top, width: clamp01(Math.max(x1, x2)) - left, height: clamp01(Math.max(y1, y2)) - top }
}

export function resizeCrop(origin: CaptureCrop, handle: Handle, px: number, py: number): CaptureCrop {
  let left = origin.x
  let top = origin.y
  let right = origin.x + origin.width
  let bottom = origin.y + origin.height
  if (handle.includes('w')) left = px
  if (handle.includes('e')) right = px
  if (handle.includes('n')) top = py
  if (handle.includes('s')) bottom = py
  return normalizeCrop(left, top, right, bottom)
}

export type CaptureOverlayProps = {
  pending: PendingCapture
  groups: Array<{ id: string; label: string }>
  initialGroupId: string
  initialMode: CaptureMode
  onCancel: () => void
  onConfirm: (mode: CaptureMode, crop: CaptureCrop, groupId: string) => void
  /** Make a new folder (collection) and return its id. */
  onCreateGroup?: (label: string) => string | null
}

const NEW_GROUP = '__new__'

export function CaptureOverlay({ pending, groups, initialGroupId, initialMode, onCancel, onConfirm, onCreateGroup }: CaptureOverlayProps) {
  const reduceMotion = useReducedMotion()
  const frame = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const toolbar = useGlassSheen<HTMLDivElement>()
  const drag = useRef<Drag | null>(null)
  const [selection, setSelection] = useState<CaptureCrop | null>(null)
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<CaptureMode>(initialMode)
  const [groupId, setGroupId] = useState(initialGroupId)
  const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState<string | null>(null)
  const createGroup = (): void => {
    const label = (naming ?? '').trim()
    const id = label && onCreateGroup ? onCreateGroup(label) : null
    if (id) setGroupId(id)
    setNaming(null)
  }

  const crop = selection ?? FULL
  const pixelWidth = Math.round(crop.width * pending.width)
  const pixelHeight = Math.round(crop.height * pending.height)

  useEffect(() => primary.current?.focus(), [])

  const confirm = (): void => {
    if (busy) return
    setBusy(true)
    onConfirm(mode, crop, groupId)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const typing = event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement
      if (event.target instanceof HTMLInputElement) return // the folder name field handles its own keys
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (selection) setSelection(null)
        else onCancel()
      } else if (event.key === 'Enter' && !typing) {
        event.preventDefault()
        event.stopImmediatePropagation()
        confirm()
      } else if (!typing && !event.metaKey && !event.ctrlKey && (event.key === 's' || event.key === 'S')) {
        setMode('image')
      } else if (!typing && !event.metaKey && !event.ctrlKey && (event.key === 'r' || event.key === 'R')) {
        setMode('video')
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  })

  const point = (event: ReactPointerEvent): { x: number; y: number } => {
    const rect = frame.current!.getBoundingClientRect()
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || busy) return
    const target = event.target as HTMLElement
    const handle = target.dataset['handle'] as Handle | undefined
    const { x, y } = point(event)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* pointer already released */ }
    setDragging(true)
    if (handle && selection) drag.current = { kind: 'resize', handle, origin: selection }
    else if (selection && target.closest('.cap-selection')) drag.current = { kind: 'move', startX: x, startY: y, origin: selection }
    else {
      drag.current = { kind: 'new', anchorX: x, anchorY: y }
      setSelection({ x, y, width: 0, height: 0 })
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (!active) return
    const { x, y } = point(event)
    if (active.kind === 'new') setSelection(normalizeCrop(active.anchorX, active.anchorY, x, y))
    else if (active.kind === 'resize') setSelection(resizeCrop(active.origin, active.handle, x, y))
    else {
      const dx = Math.min(1 - active.origin.x - active.origin.width, Math.max(-active.origin.x, x - active.startX))
      const dy = Math.min(1 - active.origin.y - active.origin.height, Math.max(-active.origin.y, y - active.startY))
      setSelection({ ...active.origin, x: active.origin.x + dx, y: active.origin.y + dy })
    }
  }

  const onPointerUp = (): void => {
    drag.current = null
    setDragging(false)
    const rect = frame.current?.getBoundingClientRect()
    // A click (or a sliver) means "whole view", not an empty selection.
    if (selection && rect && (selection.width * rect.width < 10 || selection.height * rect.height < 10)) setSelection(null)
  }

  const { viewBounds } = pending
  return (
    <motion.div
      className="cap-overlay"
      style={{ left: viewBounds.x, top: viewBounds.y, width: viewBounds.width, height: viewBounds.height }}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      role="dialog"
      aria-modal="true"
      aria-label="Capture the visible page. Drag to select an area."
    >
      <div
        ref={frame}
        className={`cap-frame${dragging ? ' is-dragging' : ''}${selection ? ' has-selection' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <motion.img
          className="cap-still"
          src={pending.previewUrl}
          alt=""
          draggable={false}
          initial={reduceMotion ? false : { filter: 'brightness(1.35) saturate(0.9)', scale: 1.006 }}
          animate={{ filter: 'brightness(1) saturate(1)', scale: 1 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        />
        {!reduceMotion && (
          <motion.div className="cap-shutter" initial={{ opacity: 0.55 }} animate={{ opacity: 0 }} transition={{ duration: 0.38, ease: 'easeOut' }} aria-hidden="true" />
        )}
        {selection ? (
          <div
            className="cap-selection"
            style={{
              left: `${selection.x * 100}%`,
              top: `${selection.y * 100}%`,
              width: `${selection.width * 100}%`,
              height: `${selection.height * 100}%`,
            }}
          >
            <span className={`cap-dims${selection.y < 0.06 ? ' is-inside' : ''}`}>{pixelWidth} × {pixelHeight}</span>
            {!dragging && handles.map((handle) => <span key={handle} className={`cap-handle cap-handle--${handle}`} data-handle={handle} aria-hidden="true" />)}
          </div>
        ) : (
          <motion.div className="cap-whole" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.3 }} aria-hidden="true">
            <span>Drag to select an area · or capture the whole view</span>
          </motion.div>
        )}
      </div>

      <motion.div
        ref={toolbar}
        className="cap-toolbar lg-surface lg-sheen"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        transition={reduceMotion ? { duration: 0.1 } : { ...spring, delay: 0.06 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="cap-modes" role="radiogroup" aria-label="Capture type">
          {(['image', 'video'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              className={`cap-mode${mode === value ? ' is-active' : ''}`}
              onClick={() => setMode(value)}
              title={value === 'image' ? 'Screenshot (S)' : 'Record (R)'}
            >
              {mode === value && <motion.span layoutId="cap-mode-pill" className="cap-mode-pill" transition={spring} aria-hidden="true" />}
              {value === 'image' ? <Camera size={14} aria-hidden="true" /> : <Video size={14} aria-hidden="true" />}
              <span>{value === 'image' ? 'Screenshot' : 'Record'}</span>
            </button>
          ))}
        </div>
        <span className="cap-divider" aria-hidden="true" />
        <label className="cap-group">
          <span>Save to</span>
          {naming !== null ? (
            <input
              className="cap-new-group"
              value={naming}
              autoFocus
              maxLength={80}
              placeholder="Folder name"
              aria-label="New folder name"
              onChange={(event) => setNaming(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); createGroup() }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNaming(null) }
              }}
              onBlur={createGroup}
            />
          ) : (
            <select
              value={groupId}
              onChange={(event) => (event.target.value === NEW_GROUP ? setNaming('') : setGroupId(event.target.value))}
              aria-label="Folder"
            >
              {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
              {onCreateGroup && <option value={NEW_GROUP}>New folder…</option>}
            </select>
          )}
        </label>
        {selection && (
          <button type="button" className="lg-icon-button" title="Use the whole view" aria-label="Use the whole view" onClick={() => setSelection(null)}>
            <Maximize2 size={14} />
          </button>
        )}
        <button type="button" className="lg-icon-button" aria-label="Cancel capture" title="Cancel (Esc)" onClick={onCancel}>
          <X size={15} />
        </button>
        <motion.button
          ref={primary}
          type="button"
          className={`cap-primary cap-primary--${mode}`}
          disabled={busy}
          whileTap={{ scale: 0.94 }}
          onClick={confirm}
          title={mode === 'image' ? 'Save screenshot (Enter)' : 'Start recording (Enter)'}
        >
          {mode === 'image' ? <Camera size={15} aria-hidden="true" /> : <Circle size={11} fill="currentColor" aria-hidden="true" />}
          <span>{mode === 'image' ? 'Save' : 'Record'}</span>
        </motion.button>
      </motion.div>
    </motion.div>
  )
}
