// Screenshot (whole + cropped), a short recording, the pane grid and viewer.
const now = '2026-10-26T12:00:00.000Z'
const b = (url, title) => ({ url, title, topic: 'General browsing', savedAt: now })
const bookmarks = [b('https://www.chase.com/', 'Chase — Banking'), b('https://en.wikipedia.org/wiki/Earth', 'Earth — Wikipedia'), b('https://www.nytimes.com/', 'The New York Times')]
const collections = [
  { id: 'banking', label: 'Banking', createdAt: now, memberUrls: [bookmarks[0].url] },
  { id: 'reading', label: 'Reading', createdAt: now, memberUrls: [bookmarks[1].url, bookmarks[2].url] },
]

export default async function ({ evaluate, shot, click, delay }) {
  await delay(2500)
  await evaluate(`localStorage.setItem('intoponet.bookmark-pane.open.v1', '1');
    localStorage.setItem('intoponet.bookmark-pane.filter.v1', 'all');
    window.intoponet.captures.removeAll().then(() => window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks, collections, recents: [], absorbed: [] }))}))
      .then(() => { location.reload(); return true })`)
  await delay(3500)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/Earth' }).then(() => true)`)
  await delay(5000)
  await click('[aria-label="Capture this page: screenshot or recording"]')
  await delay(900)
  await shot('c1-overlay-whole')
  await evaluate(`(() => {
    const frame = document.querySelector('.cap-frame'); const r = frame.getBoundingClientRect()
    const at = (type, fx, fy) => frame.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 7, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }))
    at('pointerdown', 0.62, 0.30); at('pointermove', 0.75, 0.5); at('pointermove', 0.93, 0.78); at('pointerup', 0.93, 0.78); return true })()`)
  await delay(400)
  await shot('c2-overlay-selection')
  await click('.cap-primary')
  await delay(900)
  await shot('c3-saved-toast-and-pane')
  await delay(4500)
  // Recording of the whole view.
  await click('[aria-label="Capture this page: screenshot or recording"]')
  await delay(800)
  await click('.cap-mode[title="Record (R)"]')
  await delay(500)
  await shot('c4-overlay-record-mode')
  await click('.cap-primary')
  await delay(3200)
  await shot('c5-recording-pill')
  await click('.rec-stop')
  await delay(3000)
  await shot('c6-recording-saved')
  await delay(4500)
  await click('.bm-capture')
  await delay(1100)
  await shot('c7-viewer')
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); true`)
  await delay(1600)
  await shot('c8-viewer-video')
  const list = await evaluate(`window.intoponet.captures.list().then((r) => r.map(({ kind, width, height, byteLength, durationMs, groupId }) => ({ kind, width, height, byteLength, durationMs, groupId })))`)
  console.log(JSON.stringify(list))
}
