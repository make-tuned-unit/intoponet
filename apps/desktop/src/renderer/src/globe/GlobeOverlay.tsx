import { useEffect, useRef, type ReactNode } from 'react'
import type { GlobeProjection } from './GlobeMarkers'
import { wakeLoop } from '../earth/frameDemand'

export type GlobeLabel = { id: string; text: string; color: string }

const LABEL_GAP = 6

/**
 * Labels for the most prominent visible markers. Positions are written
 * straight to the DOM whenever the view, the labels or the panels change
 * (not every frame); greedy placement in priority order drops
 * labels that would overlap one already placed, so the globe never clutters.
 */
export function GlobeOverlay({
  projection,
  labels,
  hoverId,
  hoverCard,
  hidden,
  locator,
  onLocatorSelect,
  onLabelSelect,
}: {
  projection: GlobeProjection
  /** In priority order. */
  labels: GlobeLabel[]
  hoverId: string | null
  hoverCard: ReactNode
  hidden: boolean
  /** The place you flew to: a pulsing locator at its marker (id in the projection). */
  locator?: { id: string; label: string } | null
  /** Clicking the locator opens that place's own view instead of the country's. */
  onLocatorSelect?: () => void
  /** Clicking a label opens what it names, like clicking its marker. */
  onLabelSelect?: (id: string) => void
}) {
  const locatorEl = useRef<HTMLDivElement>(null)
  const labelEls = useRef(new Map<string, HTMLDivElement>())
  const cardEl = useRef<HTMLDivElement>(null)
  const state = useRef({ labels, hoverId, hidden, locator })
  state.current = { labels, hoverId, hidden, locator }
  const wake = useRef<() => void>(() => {})

  useEffect(() => {
    const placed: Array<[number, number, number, number]> = []
    // Glass panels over the globe; labels never slide underneath them.
    let blockers: Array<[number, number, number, number]> = []
    let blockersAt = 0
    let blockersKey = ''
    /** True when the glass panels moved. */
    const refreshBlockers = (): boolean => {
      const next = [...document.querySelectorAll<HTMLElement>('.globe-panel, .globe-layers, .globe-about, .command-dock, .globe-header h1, .globe-header p, .globe-trail, .bookmark-pane, .olds-sheet, .notice-message')]
        .map((el) => el.getBoundingClientRect())
        .filter((rect) => rect.width > 0)
        .map((rect) => [rect.left, rect.top, rect.right, rect.bottom] as [number, number, number, number])
      const key = next.join(';')
      if (key === blockersKey) return false
      blockersKey = key
      blockers = next
      return true
    }
    const tick = (): void => {
      const { labels: list, hoverId: hovered, hidden: off, locator: spot } = state.current
      // The locator sits exactly on the place and fades out as it turns away.
      const pin = locatorEl.current
      if (pin) {
        const i = spot ? projection.index.get(spot.id) : undefined
        const facing = i === undefined ? 0 : projection.facing[i]!
        if (off || i === undefined || facing <= 0.02) {
          pin.style.opacity = '0'
        } else {
          pin.style.transform = `translate3d(${projection.x[i]!}px, ${projection.y[i]!}px, 0)`
          pin.style.opacity = String(Math.min(1, facing * 3))
        }
      }
      const now = performance.now()
      if (now - blockersAt > 400) {
        blockersAt = now
        refreshBlockers()
      }
      placed.length = 0
      placed.push(...blockers)
      // The hovered marker owns its own space; labels avoid the card.
      const card = cardEl.current
      if (card) {
        const i = hovered ? projection.index.get(hovered) : undefined
        if (!off && i !== undefined && projection.facing[i]! > 0.02) {
          const x = projection.x[i]!
          const y = projection.y[i]!
          const w = card.offsetWidth
          const h = card.offsetHeight
          const left = Math.min(projection.width - w - 12, Math.max(12, x + 16))
          const top = Math.min(projection.height - h - 12, Math.max(12, y - h / 2))
          card.style.transform = `translate3d(${left}px, ${top}px, 0)`
          card.style.opacity = '1'
          placed.push([left, top, left + w, top + h])
        } else {
          card.style.opacity = '0'
        }
      }
      for (const label of list) {
        const el = labelEls.current.get(label.id)
        if (!el) continue
        const i = projection.index.get(label.id)
        const facing = i === undefined ? 0 : projection.facing[i]!
        if (off || i === undefined || facing <= 0.08 || label.id === hovered) {
          el.style.opacity = '0'
          el.style.pointerEvents = 'none'
          continue
        }
        const w = el.offsetWidth
        const h = el.offsetHeight
        const left = projection.x[i]! + 10
        const top = projection.y[i]! - h / 2
        const box: [number, number, number, number] = [left - LABEL_GAP, top - LABEL_GAP, left + w + LABEL_GAP, top + h + LABEL_GAP]
        const clash = placed.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])
        if (clash) {
          el.style.opacity = '0'
          el.style.pointerEvents = 'none'
          continue
        }
        placed.push(box)
        el.style.transform = `translate3d(${left}px, ${top}px, 0)`
        el.style.opacity = String(Math.min(1, (facing - 0.08) * 4))
        el.style.pointerEvents = 'auto'
      }
    }
    const loop = wakeLoop(tick)
    wake.current = loop.wake
    // In the scene's frame, so labels move with the globe in the same frame.
    projection.listeners.add(loop.now)
    const timer = window.setInterval(() => {
      if (document.hidden) return
      blockersAt = performance.now()
      if (refreshBlockers()) loop.wake()
    }, 400)
    loop.wake()
    return () => {
      loop.stop()
      wake.current = () => {}
      projection.listeners.delete(loop.now)
      window.clearInterval(timer)
    }
  }, [projection])
  // Labels, hover and the locator come from props: place again after every render.
  useEffect(() => wake.current())

  return (
    <div className="globe-overlay" aria-hidden="true">
      {labels.map((label) => (
        <div
          key={label.id}
          className="globe-label"
          style={{ ['--label-color' as string]: label.color }}
          onClick={onLabelSelect ? () => onLabelSelect(label.id) : undefined}
          ref={(el) => {
            if (el) labelEls.current.set(label.id, el)
            else labelEls.current.delete(label.id)
          }}
        >
          {label.text}
        </div>
      ))}
      <div ref={cardEl} className="globe-hover-card lg-surface">{hoverCard}</div>
      {locator && (
        // Keyed by place so the landing animation replays on every new fly-to.
        <div key={locator.id} ref={locatorEl} className="globe-locator">
          <span className="globe-locator-landing" />
          <span className="globe-locator-ring" />
          <span className="globe-locator-ring is-late" />
          <span className="globe-locator-dot" />
          <button type="button" className="globe-locator-hit" onClick={onLocatorSelect} aria-label={`Show ${locator.label}: news, peaks, rising and fading`} />
          <button type="button" className="globe-locator-label" onClick={onLocatorSelect}>{locator.label}</button>
        </div>
      )}
    </div>
  )
}
