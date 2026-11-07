import { describe, expect, it } from 'vitest'
import {
  focusLinkScript,
  isLinkPreviewRequest,
  parsePreviewMessage,
  PREVIEW_FOCUS_LOOP_SCRIPT,
  PREVIEW_HEADER_HEIGHT,
  PREVIEW_INSET,
  PREVIEW_MESSAGE_PREFIX,
  previewFrameHtml,
  previewHeading,
  previewLayout,
} from './linkPreview'

describe('the ⇧-click gesture', () => {
  it('is a new window without features, to a web address', () => {
    expect(isLinkPreviewRequest({ url: 'https://example.org/a', disposition: 'new-window', features: '' })).toBe(true)
    expect(isLinkPreviewRequest({ url: 'http://127.0.0.1:8080/a', disposition: 'new-window', features: ' ' })).toBe(true)
  })

  it('leaves popups, ⌘-click tabs and other addresses alone', () => {
    expect(isLinkPreviewRequest({ url: 'https://accounts.example/', disposition: 'new-window', features: 'width=480,height=600' })).toBe(false)
    expect(isLinkPreviewRequest({ url: 'https://example.org/', disposition: 'new-window', features: 'popup' })).toBe(false)
    expect(isLinkPreviewRequest({ url: 'https://example.org/', disposition: 'background-tab', features: '' })).toBe(false)
    expect(isLinkPreviewRequest({ url: 'https://example.org/', disposition: 'foreground-tab', features: '' })).toBe(false)
    expect(isLinkPreviewRequest({ url: 'about:blank', disposition: 'new-window', features: '' })).toBe(false)
    expect(isLinkPreviewRequest({ url: 'mailto:someone@example.com', disposition: 'new-window', features: '' })).toBe(false)
    expect(isLinkPreviewRequest({ url: 'not a url', disposition: 'new-window', features: '' })).toBe(false)
  })
})

describe('the card layout', () => {
  it('takes about 80% of the page area, centred, with the page under the title bar', () => {
    const area = { x: 100, y: 80, width: 1000, height: 700 }
    const { card, page } = previewLayout(area)
    // The page itself is 80% × 80% of the area; the card adds its title bar and edge.
    expect(page.width).toBe(800)
    expect(page.height).toBe(560)
    expect(card.width).toBe(800 + 2 * PREVIEW_INSET)
    expect(card.height).toBe(560 + PREVIEW_HEADER_HEIGHT + PREVIEW_INSET)
    expect(page.x).toBe(card.x + PREVIEW_INSET)
    expect(page.y).toBe(card.y + PREVIEW_HEADER_HEIGHT)
    // Centred.
    expect(card.x - area.x).toBe(area.x + area.width - (card.x + card.width))
    expect(Math.abs((card.y - area.y) - (area.y + area.height - (card.y + card.height)))).toBeLessThanOrEqual(1)
    // Inside the area on every side.
    expect(page.x + page.width).toBeLessThanOrEqual(area.x + area.width)
    expect(page.y + page.height).toBeLessThanOrEqual(area.y + area.height)
  })

  it('never grows beyond a small area', () => {
    const { card } = previewLayout({ x: 0, y: 0, width: 300, height: 200 })
    expect(card.width).toBe(300)
    expect(card.height).toBe(200)
  })
})

describe('the frame page', () => {
  it('escapes the page title and says when the preview is private', () => {
    const html = previewFrameHtml({ card: { x: 1, y: 2, width: 300, height: 200 }, title: '<img src=x onerror=alert(1)>', url: 'https://www.example.org/a', isPrivate: true })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&#60;img src=x')
    expect(html).toContain('example.org')
    expect(html).toContain('class="private"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Open as Tab')
    expect(html).toContain('aria-label="Close preview"')
    expect(html).toContain('left:1px;top:2px;width:300px;height:200px')
    expect(previewFrameHtml({ card: { x: 0, y: 0, width: 1, height: 1 }, title: '', url: 'https://a.example/', isPrivate: false })).not.toContain('class="private"')
  })

  it('heads the card with the title, or the site while it loads', () => {
    expect(previewHeading('  A   story \n', 'https://news.example/x')).toBe('A story')
    expect(previewHeading('', 'https://www.news.example/x')).toBe('news.example')
    expect(previewHeading('', 'bad')).toBe('Link preview')
  })

  it('reads only its own messages', () => {
    expect(parsePreviewMessage(`${PREVIEW_MESSAGE_PREFIX}close`)).toBe('close')
    expect(parsePreviewMessage(`${PREVIEW_MESSAGE_PREFIX}open-as-tab`)).toBe('open-as-tab')
    expect(parsePreviewMessage(`${PREVIEW_MESSAGE_PREFIX}focus-page-end`)).toBe('focus-page-end')
    expect(parsePreviewMessage(`${PREVIEW_MESSAGE_PREFIX}navigate`)).toBeNull()
    expect(parsePreviewMessage('close')).toBeNull()
    expect(parsePreviewMessage(42)).toBeNull()
  })
})

describe('the preview command from the app window', () => {
  it('takes only web addresses', async () => {
    const { parseBrowserHostCommand } = await import('@intoponet/browser-api')
    expect(parseBrowserHostCommand({ type: 'preview-link', url: 'https://news.example/a' })).toEqual({ type: 'preview-link', url: 'https://news.example/a' })
    expect(() => parseBrowserHostCommand({ type: 'preview-link', url: 'file:///etc/hosts' })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'preview-link', url: 'javascript:alert(1)' })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'preview-link' })).toThrow()
    expect(() => parseBrowserHostCommand({ type: 'preview-link', url: `https://a.example/${'x'.repeat(9000)}` })).toThrow()
  })
})

describe('page scripts', () => {
  it('are valid scripts', () => {
    expect(() => new Function(`return ${PREVIEW_FOCUS_LOOP_SCRIPT}`)).not.toThrow()
    expect(() => new Function(`return ${focusLinkScript('https://example.org/"quoted"')}`)).not.toThrow()
    expect(focusLinkScript('https://example.org/"x"')).toContain(JSON.stringify('https://example.org/"x"'))
  })
})
