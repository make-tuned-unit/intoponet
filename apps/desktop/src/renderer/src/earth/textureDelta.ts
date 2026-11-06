/** Below this change in any texel the new data is applied in one frame, not animated (e.g. a minute of decay). */
export const ORGANIC_NOOP_DELTA = 0.004

/** Largest absolute difference between two texture data arrays (Infinity when their sizes differ). */
export function maxTextureDelta(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity
  let max = 0
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i]! - b[i]!)
    if (d > max) max = d
  }
  return max
}
