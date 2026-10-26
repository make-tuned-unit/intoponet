// Seeds sample bookmarks/groups (local only), then walks the field pane,
// panel pane, full-screen pane and the dock search.
const now = '2026-10-26T12:00:00.000Z'
const b = (url, title, topic = 'General browsing') => ({ url, title, topic, savedAt: now })
const bookmarks = [
  b('https://www.chase.com/', 'Chase — Banking'),
  b('https://www.wellsfargo.com/', 'Wells Fargo'),
  b('https://www.instagram.com/', 'Instagram'),
  b('https://www.linkedin.com/feed/', 'LinkedIn'),
  b('https://x.com/home', 'X'),
  b('https://www.nytimes.com/', 'The New York Times'),
  b('https://en.wikipedia.org/wiki/Earth', 'Earth — Wikipedia'),
  b('https://github.com/', 'GitHub'),
  b('https://www.figma.com/', 'Figma'),
]
const collection = (id, label, memberUrls) => ({ id, label, createdAt: now, memberUrls })
const collections = [
  collection('banking', 'Banking', [bookmarks[0].url, bookmarks[1].url]),
  collection('social', 'Social', [bookmarks[2].url, bookmarks[3].url, bookmarks[4].url]),
  collection('reading', 'Reading', [bookmarks[5].url, bookmarks[6].url]),
]

export default async function ({ evaluate, shot, click, delay }) {
  await delay(2500)
  // Seed through the app's sealed private-library API, then reload.
  await evaluate(`localStorage.setItem('intoponet.bookmark-pane.open.v1', '0');
    localStorage.removeItem('intoponet.bookmark-pane.expanded.v1');
    window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks, collections, recents: [], absorbed: [] }))})
      .then(() => { location.reload(); return true })`)
  await delay(3500)
  await shot('01-field')
  await click('button[title="Bookmarks (⇧⌘B)"]')
  await delay(900)
  await shot('02-pane-over-field')
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/Earth' }).then(() => true)`)
  await delay(4500)
  await shot('03-panel-with-pane')
  await click('[aria-label="Full width"]')
  await delay(1200)
  await shot('04-fullscreen-pane')
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/Moon' }).then(() => true)`)
  await delay(3000)
  await click('.tab-dock-grabber')
  await delay(700)
  await shot('05-dock-open')
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true })); true`)
  await delay(700)
  await shot('06-dock-search-focused')
  await evaluate(`document.querySelector('.bookmark-pane button[aria-controls="bm-group-social"]').click(); true`)
  await delay(800)
  await shot('07-group-collapsed')
  await click('.bookmark-pane [aria-label="Close bookmarks"]')
  await delay(900)
  await shot('08-pane-closed-fullscreen')
}
