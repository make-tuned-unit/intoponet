// Favicons in Bookmarks and My map, and matching glass on both panels.
const now = '2026-10-26T12:00:00.000Z'
const b = (url, title) => ({ url, title, topic: 'News', savedAt: now })
const bookmarks = [b('https://www.cbc.ca/', 'CBC.ca'), b('https://www.bbc.com/news', 'BBC News'), b('https://en.wikipedia.org/wiki/Halifax,_Nova_Scotia', 'Halifax — Wikipedia'), b('https://github.com/', 'GitHub'), b('https://www.lemonde.fr/', 'Le Monde')]
const collections = [{ id: 'news', label: 'News', createdAt: now, memberUrls: [bookmarks[0].url, bookmarks[1].url, bookmarks[4].url] }]

export default async function ({ evaluate, shotApp: shot, click, delay }) {
  await delay(2500)
  await evaluate(`window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks, collections, recents: [], absorbed: [] }))}).then(() => { location.reload(); return true })`)
  await delay(3500)
  await click('button[title="Bookmarks (⇧⌘B)"]')
  await delay(6000)
  console.log('pane icons:', await evaluate(`document.querySelectorAll('.bm-favicon img').length + ' icons, ' + document.querySelectorAll('.bm-monogram').length + ' monograms'`))
  console.log('pane fill:', await evaluate(`getComputedStyle(document.querySelector('.bm-surface')).backgroundImage.slice(0, 80)`))
  await shot('f1-bookmarks')
  await click('button[title="Bookmarks (⇧⌘B)"]')
  await delay(600)
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('My map'))?.click(); true`)
  await delay(2500)
  console.log('my map icons:', await evaluate(`document.querySelectorAll('.bookmark-drawer .site-icon').length`), '| fill:', await evaluate(`getComputedStyle(document.querySelector('.bookmark-drawer')).backgroundImage.slice(0, 80)`))
  await shot('f2-mymap')
}
