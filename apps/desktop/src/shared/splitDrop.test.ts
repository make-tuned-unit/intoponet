import { describe, expect, it } from 'vitest'
import { splitDropSide } from './splitDrop'

describe('splitDropSide', () => {
  const page = { x: 40, y: 104, width: 1000, height: 600 }

  it('offers the left side near the left edge and the right side near the right edge', () => {
    expect(splitDropSide({ x: 50, y: 300 }, page)).toBe('left')
    expect(splitDropSide({ x: 1030, y: 300 }, page)).toBe('right')
  })

  it('offers nothing in the middle, outside the page, or above or below it', () => {
    expect(splitDropSide({ x: 540, y: 300 }, page)).toBeNull()
    expect(splitDropSide({ x: 10, y: 300 }, page)).toBeNull()
    expect(splitDropSide({ x: 50, y: 50 }, page)).toBeNull()
    expect(splitDropSide({ x: 50, y: 800 }, page)).toBeNull()
  })

  it('keeps a narrow page from giving the whole of it to one edge', () => {
    const narrow = { x: 0, y: 0, width: 200, height: 300 }
    expect(splitDropSide({ x: 60, y: 100 }, narrow)).toBeNull()
    expect(splitDropSide({ x: 10, y: 100 }, narrow)).toBe('left')
  })
})
