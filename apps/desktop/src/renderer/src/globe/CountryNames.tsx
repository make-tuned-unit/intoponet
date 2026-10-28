import { latLonToRender } from '@intoponet/frequency-field'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Raycaster, Sphere, Vector2, Vector3 } from 'three'
import { countryInFocus } from '../../../shared/places/countryAt'
import { COUNTRY_SHAPES, type CountryShape } from '../../../shared/places/countryShapes'

/** Every country with a map label (main parts only), in a fixed order shared by the projector and the names. */
export const LABELLED: CountryShape[] = COUNTRY_SHAPES.filter((shape) => shape.name)

/**
 * Where each country's name sits on screen, written every frame by the scene
 * and read by the name layer without React re-renders.
 */
export type CountryView = {
  x: Float32Array
  y: Float32Array
  /** > 0 when the label point faces the camera. */
  facing: Float32Array
  /** Camera distance from Earth's centre (Earth radius 1). */
  distance: number
  /** Degrees of Earth's surface per screen pixel near the centre of the view. */
  degPerPx: number
  centerLat: number
  centerLon: number
  width: number
  height: number
  /** The country under the cursor. */
  hovered: string | null
}

export function createCountryView(): CountryView {
  const n = LABELLED.length
  return { x: new Float32Array(n), y: new Float32Array(n), facing: new Float32Array(n), distance: 4, degPerPx: 0.2, centerLat: 0, centerLon: 0, width: 0, height: 0, hovered: null }
}

const LABEL_RADIUS = 1.004

/** Inside the Canvas: projects every country's label point each frame. */
export function CountryProjector({ view }: { view: CountryView }) {
  const { camera, size } = useThree()
  const points = useMemo(() => LABELLED.map((shape) => {
    const p = latLonToRender(shape.lat, shape.lon)
    return new Vector3(p.x * LABEL_RADIUS, p.y * LABEL_RADIUS, p.z * LABEL_RADIUS)
  }), [])
  const scratch = useMemo(() => new Vector3(), [])
  const pick = useMemo(() => ({ raycaster: new Raycaster(), earth: new Sphere(new Vector3(), 1), centre: new Vector2(0, 0), hit: new Vector3() }), [])
  useFrame(() => {
    const cam = camera.position
    const distance = cam.length()
    view.width = size.width
    view.height = size.height
    view.distance = distance
    const fov = 'fov' in camera ? (camera as { fov: number }).fov : 38
    const pxPerUnit = size.height / (2 * Math.tan((fov * Math.PI) / 360) * Math.max(0.05, distance - 1))
    view.degPerPx = 180 / Math.PI / pxPerUnit
    // What is in the middle of the screen (the camera may not aim exactly at Earth's centre).
    pick.raycaster.setFromCamera(pick.centre, camera)
    if (pick.raycaster.ray.intersectSphere(pick.earth, pick.hit)) {
      view.centerLat = (Math.asin(Math.max(-1, Math.min(1, pick.hit.y))) * 180) / Math.PI
      view.centerLon = (Math.atan2(-pick.hit.z, pick.hit.x) * 180) / Math.PI
    } else if (distance > 0) {
      view.centerLat = (Math.asin(Math.max(-1, Math.min(1, cam.y / distance))) * 180) / Math.PI
      view.centerLon = (Math.atan2(-cam.z, cam.x) * 180) / Math.PI
    }
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i]!
      scratch.copy(p).project(camera)
      view.x[i] = (scratch.x + 1) * 0.5 * size.width
      view.y[i] = (1 - scratch.y) * 0.5 * size.height
      view.facing[i] = (p.dot(cam) / LABEL_RADIUS - LABEL_RADIUS) / Math.max(0.001, distance - LABEL_RADIUS)
    }
  })
  return null
}

/**
 * Natural Earth's label rank that is legible at a camera distance: the
 * largest countries from far away, every country once you are close.
 */
export function rankCutoff(distance: number): number {
  if (distance >= 4.0) return 2.6
  if (distance >= 3.2) return 3.6
  if (distance >= 2.6) return 4.6
  if (distance >= 2.15) return 5.6
  if (distance >= 1.8) return 7
  return 99
}

const GAP = 4

/**
 * Country names on the globe. Names fade in as you zoom and fade out when
 * they would crowd; the country at the centre of the view and the one under
 * the cursor are always named, so every country is named when you spin or
 * zoom to it.
 */
export function CountryNames({ view, hidden }: { view: CountryView; hidden: boolean }) {
  const els = useRef<Array<HTMLDivElement | null>>([])
  const root = useRef<HTMLDivElement>(null)
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden

  useEffect(() => {
    let frame = 0
    const sizes = new Map<number, [number, number]>()
    let blockers: Array<[number, number, number, number]> = []
    let blockersAt = 0
    let center: { lat: number; lon: number; code: string | null } = { lat: NaN, lon: NaN, code: null }
    const on = new Uint8Array(LABELLED.length)
    const order = LABELLED.map((_, i) => i).sort((a, b) => LABELLED[a]!.rank - LABELLED[b]!.rank)
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      if (now - blockersAt > 300) {
        blockersAt = now
        // Panels, and the labels of news markers, keep their space.
        blockers = [...document.querySelectorAll<HTMLElement>('.globe-panel, .globe-layers, .globe-about, .command-dock, .globe-header h1, .globe-header p, .globe-trail, .bookmark-pane, .olds-sheet, .notice-message, .globe-label, .globe-hover-card, .globe-locator-label, .globe-locator-ring, .globe-locator-dot')]
          .filter((el) => el.style.opacity !== '0')
          .map((el) => el.getBoundingClientRect())
          .filter((rect) => rect.width > 0)
          .map((rect) => [rect.left, rect.top, rect.right, rect.bottom] as [number, number, number, number])
      }
      // The country at the centre of the view (recomputed only when the view moves).
      if (!(Math.abs(view.centerLat - center.lat) <= 0.05 && Math.abs(view.centerLon - center.lon) <= 0.05)) {
        center = { lat: view.centerLat, lon: view.centerLon, code: countryInFocus(view.centerLat, view.centerLon, view.degPerPx * 60)?.code ?? null }
        if (root.current) root.current.dataset.focus = `${center.code ?? ''} ${center.lat.toFixed(2)},${center.lon.toFixed(2)} ${view.degPerPx.toFixed(4)}`
      }
      const cutoff = rankCutoff(view.distance)
      const placed: Array<[number, number, number, number]> = [...blockers]
      const show = new Uint8Array(LABELLED.length)
      const place = (i: number, force: boolean): void => {
        const el = els.current[i]
        if (!el || view.facing[i]! <= 0.12) return
        let size = sizes.get(i)
        if (!size) {
          size = [el.offsetWidth, el.offsetHeight]
          if (size[0] > 0) sizes.set(i, size)
        }
        const [w, h] = size
        const left = view.x[i]! - w / 2
        const clashes = (box: [number, number, number, number]): boolean => placed.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])
        // On the point; a name that must show (the focused or hovered country) moves just below or above it rather than overlap.
        const tops = force ? [view.y[i]! - h / 2, ...[16, 30, 44].flatMap((d) => [view.y[i]! + d, view.y[i]! - h - d])] : [view.y[i]! - h / 2]
        let chosen: { top: number; box: [number, number, number, number] } | null = null
        for (const top of tops) {
          if (left < 4 || top < 4 || left + w > view.width - 4 || top + h > view.height - 4) continue
          const box: [number, number, number, number] = [left - GAP, top - GAP, left + w + GAP, top + h + GAP]
          chosen ??= { top, box }
          if (!clashes(box)) { chosen = { top, box }; break }
        }
        if (!chosen || (!force && clashes(chosen.box))) return
        placed.push(chosen.box)
        show[i] = 1
        el.style.transform = `translate3d(${left}px, ${chosen.top}px, 0)`
      }
      if (!hiddenRef.current) {
        // The focused and hovered countries first, always; then by Natural Earth's label priority.
        LABELLED.forEach((shape, i) => { if (shape.code === center.code || shape.code === view.hovered) place(i, true) })
        for (const i of order) {
          if (show[i] || LABELLED[i]!.rank > cutoff) continue
          place(i, false)
        }
      }
      for (let i = 0; i < LABELLED.length; i += 1) {
        const el = els.current[i]
        if (!el) continue
        if (show[i] !== on[i]) {
          on[i] = show[i]!
          el.classList.toggle('is-on', show[i] === 1)
        }
        const code = LABELLED[i]!.code
        el.classList.toggle('is-focus', code === center.code)
        el.classList.toggle('is-hover', code === view.hovered)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [view])

  return (
    <div ref={root} className="country-names" aria-hidden="true">
      {LABELLED.map((shape, i) => (
        <div key={`${shape.code}:${i}`} className="country-name" data-code={shape.code} ref={(el) => { els.current[i] = el }}>
          {shape.name}
        </div>
      ))}
    </div>
  )
}
