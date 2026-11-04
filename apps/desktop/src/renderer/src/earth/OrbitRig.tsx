import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import { orbitKeepingPointUnderCursor, surfaceUnderCursor, wheelRadius, type Ndc, type Vec3 } from './zoomToCursor'

export function OrbitRig({
  distance,
  theta,
  phi,
  enabled,
  reducedMotion = false,
  onDistanceChange,
  onPoseChange,
}: {
  distance: number
  theta: number
  phi: number
  enabled: boolean
  reducedMotion?: boolean
  onDistanceChange?: ((radius: number) => void) | undefined
  onPoseChange?: ((pose: { theta: number; phi: number; radius: number }) => void) | undefined
}) {
  const { camera, gl } = useThree()
  const spherical = useRef({ theta, phi, radius: distance })
  const desired = useRef({ theta, phi, radius: distance })
  const dragging = useRef(false)
  /** The surface point being zoomed toward and where it sits on screen; it stays under the cursor while the zoom eases in. */
  const zoomAnchor = useRef<{ point: Vec3; ndc: Ndc } | null>(null)
  /** A wheel zoom is easing toward its radius; the pose is reported when it lands. */
  const zooming = useRef(false)
  /** The radius last reported up, so its echo back as the `distance` prop isn't mistaken for a new target. */
  const reportedRadius = useRef<number | null>(null)
  const last = useRef({ x: 0, y: 0 })
  const look = useRef(new Vector3(0, 0, 0))
  /** Spin velocity (radians per frame) after a drag is released: the globe keeps the direction you threw it. */
  const velocity = useRef({ theta: 0, phi: 0 })
  const lastMoveAt = useRef(0)
  const props = useRef({ theta, phi, distance })
  const report = useRef({ onDistanceChange, onPoseChange })
  report.current = { onDistanceChange, onPoseChange }

  // Apply only the props that actually changed. Re-applying a stale theta on an unrelated
  // change (e.g. zoom) is what made the globe swing back after a drag.
  useEffect(() => {
    const before = props.current
    props.current = { theta, phi, distance }
    if (distance !== before.distance && distance !== reportedRadius.current) {
      desired.current.radius = distance
      zoomAnchor.current = null
    }
    if (theta !== before.theta || phi !== before.phi) {
      velocity.current = { theta: 0, phi: 0 }
      zoomAnchor.current = null
      // Shortest way round: aim for the equivalent angle nearest where the globe is now.
      const turn = Math.PI * 2
      const delta = ((((theta - spherical.current.theta) % turn) + turn * 1.5) % turn) - Math.PI
      desired.current.theta = spherical.current.theta + delta
      desired.current.phi = phi
    }
    if (reducedMotion) {
      spherical.current.radius = desired.current.radius
      spherical.current.theta = desired.current.theta
      spherical.current.phi = desired.current.phi
    }
  }, [distance, phi, reducedMotion, theta])

  useEffect(() => {
    const element = gl.domElement
    const onDown = (event: PointerEvent): void => {
      if (!enabled) return
      dragging.current = true
      zoomAnchor.current = null
      velocity.current = { theta: 0, phi: 0 }
      last.current = { x: event.clientX, y: event.clientY }
      lastMoveAt.current = performance.now()
      element.setPointerCapture(event.pointerId)
    }
    const onMove = (event: PointerEvent): void => {
      if (!dragging.current) return
      const dx = event.clientX - last.current.x
      const dy = event.clientY - last.current.y
      last.current = { x: event.clientX, y: event.clientY }
      const now = performance.now()
      const frames = Math.max(1, (now - lastMoveAt.current) / 16.7)
      lastMoveAt.current = now
      // Smoothed per-frame velocity for the throw.
      velocity.current = {
        theta: velocity.current.theta * 0.5 + (-dx * 0.005 / frames) * 0.5,
        phi: velocity.current.phi * 0.5 + (-dy * 0.005 / frames) * 0.5,
      }
      spherical.current.theta -= dx * 0.005
      spherical.current.phi = Math.min(
        Math.PI - 0.18,
        Math.max(0.18, spherical.current.phi - dy * 0.005),
      )
      desired.current.theta = spherical.current.theta
      desired.current.phi = spherical.current.phi
    }
    const onUp = (event: PointerEvent): void => {
      dragging.current = false
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId)
      }
      // A pause before letting go means no throw.
      if (performance.now() - lastMoveAt.current > 90 || reducedMotion) velocity.current = { theta: 0, phi: 0 }
      if (Math.abs(velocity.current.theta) + Math.abs(velocity.current.phi) < 0.0004) report.current.onPoseChange?.({ ...spherical.current })
    }
    const onWheel = (event: WheelEvent): void => {
      if (!enabled) return
      event.preventDefault()
      // Zooming stops a spin, so the point under the cursor holds still.
      velocity.current = { theta: 0, phi: 0 }
      const rect = element.getBoundingClientRect()
      const ndc = {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        y: 1 - ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2,
      }
      const lens = lensOf(camera)
      // Off the globe, zoom straight toward the centre.
      const point = surfaceUnderCursor(spherical.current, ndc, lens)
      zoomAnchor.current = point ? { point, ndc } : null
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      const next = wheelRadius(desired.current.radius, event.deltaY * lines, { pinch: event.ctrlKey })
      desired.current.radius = next
      zooming.current = true
      if (reducedMotion) {
        spherical.current.radius = next
        if (zoomAnchor.current) {
          const aimed = orbitKeepingPointUnderCursor(spherical.current, next, zoomAnchor.current.point, zoomAnchor.current.ndc, lens)
          spherical.current.theta = aimed.theta
          spherical.current.phi = aimed.phi
        }
        desired.current.theta = spherical.current.theta
        desired.current.phi = spherical.current.phi
      }
      reportedRadius.current = next
      report.current.onDistanceChange?.(next)
    }
    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
      element.removeEventListener('wheel', onWheel)
    }
  }, [camera, enabled, gl, reducedMotion])

  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      // Momentum after a throw, easing out; the pose is reported once the globe settles.
      const spin = velocity.current
      if (!dragging.current && Math.abs(spin.theta) + Math.abs(spin.phi) >= 0.0004) {
        spherical.current.theta += spin.theta
        spherical.current.phi = Math.min(Math.PI - 0.18, Math.max(0.18, spherical.current.phi + spin.phi))
        desired.current.theta = spherical.current.theta
        desired.current.phi = spherical.current.phi
        spin.theta *= 0.94
        spin.phi *= 0.9
        if (Math.abs(spin.theta) + Math.abs(spin.phi) < 0.0004) {
          velocity.current = { theta: 0, phi: 0 }
          report.current.onPoseChange?.({ ...spherical.current })
        }
      }
      const steer = reducedMotion ? 1 : dragging.current ? 0 : 0.055
      spherical.current.radius += (desired.current.radius - spherical.current.radius) * (zooming.current && !reducedMotion ? 0.2 : steer)
      const anchor = zoomAnchor.current
      if (anchor && !dragging.current) {
        // Turn the globe just enough that the zoomed-to point stays under the cursor at this radius.
        const aimed = orbitKeepingPointUnderCursor(spherical.current, spherical.current.radius, anchor.point, anchor.ndc, lensOf(camera))
        spherical.current.theta = aimed.theta
        spherical.current.phi = aimed.phi
        desired.current.theta = aimed.theta
        desired.current.phi = aimed.phi
      }
      if (zooming.current && Math.abs(desired.current.radius - spherical.current.radius) < 1e-3) {
        spherical.current.radius = desired.current.radius
        zooming.current = false
        zoomAnchor.current = null
        report.current.onPoseChange?.({ ...spherical.current })
      }
      spherical.current.theta += (desired.current.theta - spherical.current.theta) * steer
      spherical.current.phi += (desired.current.phi - spherical.current.phi) * steer
      const { theta: currentTheta, phi: currentPhi, radius } = spherical.current
      camera.position.set(
        radius * Math.sin(currentPhi) * Math.sin(currentTheta),
        radius * Math.cos(currentPhi),
        radius * Math.sin(currentPhi) * Math.cos(currentTheta),
      )
      camera.lookAt(look.current)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [camera, reducedMotion])

  return null
}

function lensOf(camera: unknown): { fovDeg: number; aspect: number } {
  return camera instanceof PerspectiveCamera
    ? { fovDeg: camera.fov, aspect: camera.aspect }
    : { fovDeg: 38, aspect: 1 }
}
