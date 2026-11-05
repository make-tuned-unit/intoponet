import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'

/**
 * The globe renders on demand. Anything that moves (the camera, a throw, a
 * zoom, fades and data transitions) asks for the next frame itself, so motion
 * runs at the display's full rate; when the scene is still, the only frames
 * are the gentle ambient ones, paced here instead of at the display rate:
 * the membrane's slow shimmer (its contours drift well under a pixel per
 * frame at this rate) and, faster, the selected marker's pulse ring.
 */
export const AMBIENT_FPS = { shimmer: 15, pulse: 30 } as const

/** Ask for a frame after every React render of the calling component (props or state changed). */
export function useInvalidateOnRender(): void {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => { invalidate() })
}

/**
 * While `fps` is set, make sure a frame is drawn at least that often. The
 * timer is re-armed by every drawn frame, so it adds nothing while something
 * else is already animating, and it stops by itself while the window is hidden
 * (no frames are drawn, so it is never re-armed).
 */
export function useAmbientFrames(fps: number | null): void {
  const invalidate = useThree((state) => state.invalidate)
  const timer = useRef(0)
  const interval = fps ? 1000 / fps : 0
  useFrame(() => {
    window.clearTimeout(timer.current)
    // Wake a few ms early so the frame lands on the vsync the interval ends at.
    if (interval) timer.current = window.setTimeout(() => invalidate(), Math.max(0, interval - 4))
  })
  useEffect(() => {
    if (interval) invalidate()
    return () => window.clearTimeout(timer.current)
  }, [interval, invalidate])
}

/**
 * Whether the camera or viewport changed since the last call with this
 * `memory` (a `Float64Array(34)` kept by the caller). Screen projections only
 * need recomputing, and the DOM layers that follow them only need waking, when
 * this is true.
 */
export function viewChanged(
  camera: { matrixWorldInverse: { elements: ArrayLike<number> }; projectionMatrix: { elements: ArrayLike<number> } },
  size: { width: number; height: number },
  memory: Float64Array,
): boolean {
  let changed = false
  const write = (index: number, value: number): void => {
    if (memory[index] !== value) {
      memory[index] = value
      changed = true
    }
  }
  for (let i = 0; i < 16; i += 1) write(i, camera.matrixWorldInverse.elements[i]!)
  for (let i = 0; i < 16; i += 1) write(16 + i, camera.projectionMatrix.elements[i]!)
  write(32, size.width)
  write(33, size.height)
  return changed
}

/**
 * A requestAnimationFrame pass that runs only when woken, for DOM layers that
 * follow the globe (names, labels). `wake()` schedules one pass on the next
 * frame; `now()` runs it immediately (e.g. from inside the scene's frame).
 */
export function wakeLoop(pass: () => void): { wake: () => void; now: () => void; stop: () => void } {
  let frame = 0
  const run = (): void => {
    frame = 0
    pass()
  }
  return {
    wake: () => { if (!frame) frame = requestAnimationFrame(run) },
    now: () => {
      if (frame) cancelAnimationFrame(frame)
      run()
    },
    stop: () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
