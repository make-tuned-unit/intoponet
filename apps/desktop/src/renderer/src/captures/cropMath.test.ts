import { describe, expect, it } from 'vitest'
import { normalizeCrop, resizeCrop } from './CaptureOverlay'

describe('crop selection math', () => {
  it('normalizes drags in any direction and clamps to the frame', () => {
    const crop = normalizeCrop(0.8, 0.9, 0.2, 0.1)
    expect(crop.x).toBeCloseTo(0.2)
    expect(crop.y).toBeCloseTo(0.1)
    expect(crop.width).toBeCloseTo(0.6)
    expect(crop.height).toBeCloseTo(0.8)
    expect(normalizeCrop(-0.5, 0.5, 1.5, 0.6)).toMatchObject({ x: 0, width: 1 })
  })

  it('resizes from any handle and flips through the opposite edge', () => {
    const origin = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }
    const grown = resizeCrop(origin, 'se', 0.9, 0.7)
    expect(grown.x).toBeCloseTo(0.2)
    expect(grown.width).toBeCloseTo(0.7)
    expect(grown.height).toBeCloseTo(0.5)
    expect(resizeCrop(origin, 'n', 0.5, 0.1).y).toBeCloseTo(0.1)
    const flipped = resizeCrop(origin, 'w', 0.9, 0.5)
    expect(flipped.x).toBeCloseTo(0.6)
    expect(flipped.width).toBeCloseTo(0.3)
  })
})
