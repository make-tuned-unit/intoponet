// Full screen: overlay + toast alignment, Captures filter, video viewer.
const now = '2026-10-26T12:00:00.000Z'
const collections = [
  { id: 'banking', label: 'Banking', createdAt: now, memberUrls: [] },
  { id: 'research', label: 'Research', createdAt: now, memberUrls: [] },
]
export default async function ({ evaluate, shot, click, delay }) {
  await delay(2500)
  await evaluate(`localStorage.setItem('intoponet.bookmark-pane.open.v1', '1');
    localStorage.setItem('intoponet.bookmark-pane.filter.v1', 'captures');
    localStorage.setItem('intoponet.capture-group.v1', 'research');
    window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks: [], collections, recents: [], absorbed: [] }))}).then(() => { location.reload(); return true })`)
  await delay(3500)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/Aurora' }).then(() => true)`)
  await delay(4500)
  await click('[aria-label="Full width"]')
  await delay(1200)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, shiftKey: true, bubbles: true })); true`)
  await delay(900)
  await evaluate(`(() => { const f = document.querySelector('.cap-frame'); const r = f.getBoundingClientRect()
    const at = (t, x, y) => f.dispatchEvent(new PointerEvent(t, { bubbles: true, button: 0, pointerId: 3, clientX: r.left + r.width * x, clientY: r.top + r.height * y }))
    at('pointerdown', 0.45, 0.38); at('pointermove', 0.7, 0.6); at('pointermove', 0.98, 0.98); at('pointerup', 0.98, 0.98); return true })()`)
  await delay(400)
  await shot('f1-fullscreen-crop')
  await click('.cap-primary')
  await delay(800)
  await shot('f2-fullscreen-saved')
  await delay(4500)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, shiftKey: true, bubbles: true })); true`)
  await delay(800)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })); true`)
  await delay(300)
  await click('.cap-primary')
  await delay(2600)
  await click('.rec-stop')
  await delay(3500)
  await shot('f3-captures-filter')
  await click('.bm-capture')
  await delay(2600)
  await shot('f4-viewer-video')
}
