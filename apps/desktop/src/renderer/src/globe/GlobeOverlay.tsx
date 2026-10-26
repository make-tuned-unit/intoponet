import { useEffect, useRef, type ReactNode } from 'react'
import type { GlobeProjection } from './GlobeMarkers'

export type GlobeLabel = { id: string; text: string; color: string }

const LABEL_GAP = 6

/**
 * Labels for the most prominent visible markers. Positions are written
 * straight to the DOM each frame; greedy placement in priority order drops
 * labels that would overlap one already placed, so the globe never clutters.
 */
export function GlobeOverlay({
  projection,
  labels,
  hoverId,
  hoverCard,
  hidden,
}: {
  projection: GlobeProjection
  /** In priority order. */
  labels: GlobeLabel[]
  hoverId: string | null
  hoverCard: ReactNode
  hidden: boolean
}) {
  const labelEls = useRef(new Map<string, HTMLDivElement>())
  const cardEl = useRef<HTMLDivElement>(null)
  const state = useRef({ labels, hoverId, hidden })
  state.current = { labels, hoverId, hidden }

  useEffect(() => {
    let frame = 0
    const placed: Array<[number, number, number, number]> = []
    // Glass panels over the globe; labels never slide underneath them.
    let blockers: Array<[number, number, number, number]> = []
    let blockersAt = 0
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const { labels: list, hoverId: hovered, hidden: off } = state.current
      const now = performance.now()
      if (now - blockersAt > 400) {
        blockersAt = now
        blockers = [...document.querySelectorAll<HTMLElement>('.globe-panel, .globe-layers, .globe-about, .command-dock, .globe-header h1, .bookmark-pane')]
          .map((el) => el.getBoundingClientRect())
          .filter((rect) => rect.width > 0)
          .map((rect) => [rect.left, rect.top, rect.right, rect.bottom] as [number, number, number, number])
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
          continue
        }
        placed.push(box)
        el.style.transform = `translate3d(${left}px, ${top}px, 0)`
        el.style.opacity = String(Math.min(1, (facing - 0.08) * 4))
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [projection])

  return (
    <div className="globe-overlay" aria-hidden="true">
      {labels.map((label) => (
        <div
          key={label.id}
          className="globe-label"
          style={{ ['--label-color' as string]: label.color }}
          ref={(el) => {
            if (el) labelEls.current.set(label.id, el)
            else labelEls.current.delete(label.id)
          }}
        >
          {label.text}
        </div>
      ))}
      <div ref={cardEl} className="globe-hover-card lg-surface">{hoverCard}</div>
    </div>
  )
}
