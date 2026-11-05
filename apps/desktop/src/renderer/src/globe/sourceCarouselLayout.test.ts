import { describe, expect, it } from 'vitest'
import { carouselSlot, pageRectFrom, stepIndex, VISIBLE_SIDE } from './sourceCarouselLayout'

describe('carouselSlot', () => {
  it('puts the front card flat and centred, neighbours turned toward it', () => {
    expect(carouselSlot(0, 400)).toMatchObject({ x: 0, rotateY: -0, scale: 1, opacity: 1, brightness: 1 })
    expect(carouselSlot(2, 400)).toMatchObject({ opacity: 1 })
    expect(carouselSlot(2, 400).brightness).toBeLessThan(carouselSlot(1, 400).brightness)
    const left = carouselSlot(-1, 400)
    const right = carouselSlot(1, 400)
    expect(left.x).toBeCloseTo(-264)
    expect(right.x).toBeCloseTo(264)
    expect(left.rotateY).toBe(34)
    expect(right.rotateY).toBe(-34)
    expect(right.zIndex).toBeLessThan(carouselSlot(0, 400).zIndex)
  })
  it('tucks far cards in and hides those past the visible side', () => {
    expect(carouselSlot(3, 400).x - carouselSlot(2, 400).x).toBeLessThan(carouselSlot(1, 400).x)
    expect(carouselSlot(VISIBLE_SIDE + 1, 400).opacity).toBe(0)
  })
})

describe('pageRectFrom', () => {
  it('mirrors the page bounds the shell sends to the browser', () => {
    expect(pageRectFrom({ x: 100.4, y: 150.2, right: 900.7, bottom: 700.9 }, false)).toEqual({ left: 113, top: 151, width: 775, height: 537 })
    expect(pageRectFrom({ x: 0, y: 60, right: 1200, bottom: 800 }, true)).toEqual({ left: 0, top: 60, width: 1200, height: 740 })
  })
})

describe('stepIndex', () => {
  it('stops at the ends', () => {
    expect(stepIndex(0, -1, 5)).toBe(0)
    expect(stepIndex(4, 2, 5)).toBe(4)
    expect(stepIndex(2, 1, 5)).toBe(3)
  })
})
