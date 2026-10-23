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
  const report = useRef({ onDistanceChange, onPoseChange })
  report.current = { onDistanceChange, onPoseChange }

  useEffect(() => {
    desired.current.radius = distance
    desired.current.theta = theta
    desired.current.phi = phi
    if (reducedMotion) {
      spherical.current.radius = distance
      spherical.current.theta = theta
      spherical.current.phi = phi
    }
  }, [distance, phi, reducedMotion, theta])

  useEffect(() => {
    const element = gl.domElement
    const onDown = (event: PointerEvent): void => {
      if (!enabled) return
      dragging.current = true
      last.current = { x: event.clientX, y: event.clientY }
      element.setPointerCapture(event.pointerId)
    }
    const onMove = (event: PointerEvent): void => {
      if (!dragging.current) return
      const dx = event.clientX - last.current.x
      const dy = event.clientY - last.current.y
      last.current = { x: event.clientX, y: event.clientY }
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
      report.current.onPoseChange?.({ ...spherical.current })
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
  }, [enabled, gl])

  useEffect(() => {
    let frame = 0
    const tick = (): void => {
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
