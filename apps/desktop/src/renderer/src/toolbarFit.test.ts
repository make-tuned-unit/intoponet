import { describe, expect, it } from 'vitest'
import { labelsFit } from './toolbarFit'

describe('toolbar labels', () => {
  // Protected, Translate, Capture, PDF + options, Pin, Absorb, more tools, downloads, Bookmarks, full width, close.
  const labelled = [96, 92, 84, 56, 32, 54, 76, 120, 32, 104, 32, 32]

  it('show while every tool fits with its label, gaps included', () => {
    const needed = labelled.reduce((sum, width) => sum + width, 0) + 3 * (labelled.length - 1)
    expect(labelsFit(labelled, 3, needed)).toBe(true)
    expect(labelsFit(labelled, 3, needed + 200)).toBe(true)
  })

  it('go before two tools would touch (the sidebar at 280 px left about 590 px)', () => {
    expect(labelsFit(labelled, 3, 590)).toBe(false)
    const needed = labelled.reduce((sum, width) => sum + width, 0) + 3 * (labelled.length - 1)
    expect(labelsFit(labelled, 3, needed - 1)).toBe(false)
  })

  it('fit trivially with no tools', () => {
    expect(labelsFit([], 3, 0)).toBe(true)
  })
})
