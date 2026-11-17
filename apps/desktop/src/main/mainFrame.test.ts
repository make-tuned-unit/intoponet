import { describe, expect, it } from 'vitest'
import type { WebFrameMain } from 'electron'
import { framesOf, mainFrameOf } from './mainFrame'

const frame = (children: WebFrameMain[] = []): WebFrameMain => {
  const self = { framesInSubtree: [] as WebFrameMain[] } as unknown as WebFrameMain
  ;(self as unknown as { framesInSubtree: WebFrameMain[] }).framesInSubtree = [self, ...children]
  return self
}

/** As Electron answers once a page's renderer has crashed and its contents is not destroyed yet. */
const crashed = {
  isDestroyed: () => false,
  get mainFrame(): WebFrameMain { throw new Error('Render frame was disposed before WebFrameMain could be accessed') },
}

describe('a page\'s frames', () => {
  it('are its main frame and the frames inside it', () => {
    const child = frame()
    const main = frame([child])
    const contents = { isDestroyed: () => false, mainFrame: main }
    expect(mainFrameOf(contents)).toBe(main)
    expect(framesOf(contents)).toEqual([main, child])
  })

  it('are none once the renderer has crashed (reading the frame throws then)', () => {
    expect(mainFrameOf(crashed)).toBeNull()
    expect(framesOf(crashed)).toEqual([])
  })

  it('are none for a destroyed page, without reading its frame', () => {
    const destroyed = { isDestroyed: () => true, get mainFrame(): WebFrameMain { throw new Error('Object has been destroyed') } }
    expect(mainFrameOf(destroyed)).toBeNull()
    expect(framesOf(destroyed)).toEqual([])
  })

  it('are none when the frames inside cannot be listed', () => {
    const main = { get framesInSubtree(): WebFrameMain[] { throw new Error('Render frame was disposed') } } as unknown as WebFrameMain
    expect(framesOf({ isDestroyed: () => false, mainFrame: main })).toEqual([])
  })
})
