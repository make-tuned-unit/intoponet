import { describe, expect, it } from 'vitest'
import { shellOverlayNeeded, shellOverlayPick } from './shellOverlay'

describe('the suggestions floated above a page', () => {
  const list = { x: 470, y: 765, width: 500, height: 95 }

  it('are floated only while a shown page is under the list', () => {
    // The page in a panel reaches down behind the list (the case that painted the list behind the page).
    expect(shellOverlayNeeded(list, [{ x: 107, y: 133, width: 1291, height: 680 }])).toBe(true)
    // One side of a pair is enough.
    expect(shellOverlayNeeded(list, [{ x: 0, y: 100, width: 300, height: 800 }, { x: 900, y: 100, width: 500, height: 800 }])).toBe(true)
    // No page, a page that ends above the list, or one beside it: the list shows as it is.
    expect(shellOverlayNeeded(list, [])).toBe(false)
    expect(shellOverlayNeeded(list, [{ x: 107, y: 133, width: 1291, height: 600 }])).toBe(false)
    expect(shellOverlayNeeded(list, [{ x: 1000, y: 133, width: 400, height: 800 }])).toBe(false)
    expect(shellOverlayNeeded({ ...list, height: 0 }, [{ x: 107, y: 133, width: 1291, height: 680 }])).toBe(false)
  })

  it('understand only a row chosen in the copy', () => {
    expect(shellOverlayPick('intoponet-overlay:pick/0')).toEqual({ index: 0, meta: false, alt: false })
    expect(shellOverlayPick('intoponet-overlay:pick/7?meta=1')).toEqual({ index: 7, meta: true, alt: false })
    expect(shellOverlayPick('intoponet-overlay:pick/3?alt=1&meta=1')).toEqual({ index: 3, meta: true, alt: true })
    for (const other of ['https://example.com/pick/1', 'intoponet-overlay:pick/-1', 'intoponet-overlay:pick/1000', 'intoponet-overlay:other/1', 'intoponet-overlay:pick/1/2', 'javascript:alert(1)', 'not a url']) {
      expect(shellOverlayPick(other)).toBeNull()
    }
  })
})
