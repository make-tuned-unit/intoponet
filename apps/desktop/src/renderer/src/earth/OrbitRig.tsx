import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

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
  const wheeledAt = useRef(0)
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
    if (distance !== before.distance) desired.current.radius = distance
    if (theta !== before.theta || phi !== before.phi) {
      velocity.current = { theta: 0, phi: 0 }
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
      wheeledAt.current = performance.now()
      const next = Math.min(
        5.4,
        Math.max(1.48, spherical.current.radius + event.deltaY * 0.0024),
      )
      spherical.current.radius = next
      desired.current.radius = next
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
  }, [enabled, gl, reducedMotion])

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
      if (performance.now() - wheeledAt.current > 240) {
        spherical.current.radius += (desired.current.radius - spherical.current.radius) * steer
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
