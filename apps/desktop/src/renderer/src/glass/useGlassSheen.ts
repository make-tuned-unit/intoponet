import { useEffect, useRef } from 'react'

/**
 * Track the pointer as CSS variables so `.lg-sheen` can place a soft
 * specular highlight under it. Writes styles directly (no React renders).
 */
export function useGlassSheen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    const move = (event: PointerEvent): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        element.style.setProperty('--sheen-x', `${event.clientX - rect.left}px`)
        element.style.setProperty('--sheen-y', `${event.clientY - rect.top}px`)
      })
    }
    element.addEventListener('pointermove', move)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('pointermove', move)
    }
  }, [])
  return ref
}
