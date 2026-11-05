import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: class {} }))
const { fullscreenNoticeHtml, fullscreenSiteName, noticeBounds } = await import('./fullscreenNotice')

describe('fullscreen notice', () => {
  it('names the site and how to leave, escaping the name', () => {
    expect(fullscreenSiteName('https://video.example.com/watch?v=1')).toBe('video.example.com')
    expect(fullscreenSiteName('about:blank')).toBe('')
    const html = fullscreenNoticeHtml('video.example.com')
    expect(html).toContain('<b>video.example.com</b> is full screen')
    expect(html).toContain('Esc')
    expect(fullscreenNoticeHtml('<img src=x>')).not.toContain('<img')
    expect(fullscreenNoticeHtml('')).toContain('This page is full screen')
  })

  it('sits centred near the top, within narrow windows too', () => {
    expect(noticeBounds(1440)).toEqual({ x: 490, y: 28, width: 460, height: 44 })
    expect(noticeBounds(300).width).toBe(268)
  })
})
