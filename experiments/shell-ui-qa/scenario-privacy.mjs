// Privacy tab, private browsing, per-pin hiding and collection merge/split (MEM-001/003/004/005/008, §8.4).
export default async function ({ evaluate, shotApp: shot, delay }) {
  await delay(4000)
  const now = new Date().toISOString()
  const bookmarks = [
    { url: 'https://en.wikipedia.org/wiki/Vanuatu', title: 'Vanuatu', topic: 'Pacific', savedAt: now, fieldAnchor: { lat: -15.4, lon: 166.9, label: 'Vanuatu' } },
    { url: 'https://en.wikipedia.org/wiki/Fiji', title: 'Fiji', topic: 'Pacific', savedAt: now, fieldAnchor: { lat: -17.7, lon: 178.1, label: 'Fiji' } },
    { url: 'https://www.rnz.co.nz/pacific/one', title: 'RNZ Pacific story', topic: 'Pacific', savedAt: now },
  ]
  const collections = [
    { id: 'c1', label: 'Pacific reading', createdAt: now, memberUrls: bookmarks.map((b) => b.url) },
    { id: 'c2', label: 'Later', createdAt: now, memberUrls: [] },
  ]
  await evaluate(`window.intoponet.browserHost.writePrivateLibrary(${JSON.stringify(JSON.stringify({ schema: 'intoponet.private-library.v1', bookmarks, collections, recents: [], absorbed: [] }))}).then(() => { location.reload(); return true })`).catch(() => undefined)
  await delay(5000)
  const click = (sel, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.innerText.includes(${JSON.stringify(text)})); el?.click(); return !!el })()`)
  console.log('open my map', await click('.bookmark-library-button', 'My map'))
  await delay(1200)
  console.log('privacy tab', await click('.drawer-tabs button', 'Privacy'))
  await delay(800)
  console.log('privacy state', await evaluate(`window.intoponet.privacy.state().then((s) => JSON.stringify(s))`))
  await shot('privacy-tab')

  console.log('private on', await click('.private-toggle', 'Private'))
  await delay(1500)
  console.log('header', await evaluate(`document.querySelector('.private-toggle')?.innerText`))
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://example.com/' }).catch((e) => String(e)); true`)
  await delay(4000)
  console.log('tabs', await evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => ({ url: x.url, isPrivate: x.isPrivate }))))`))
  console.log('recents after private visit', await evaluate(`localStorage.getItem('intoponet.recents.v1')`))
  await shot('privacy-private-tab')
  await evaluate(`window.intoponet.privacy.setPrivateMode(false).then((s) => JSON.stringify(s))`).then((s) => console.log('private off', s))
  await delay(1500)
  console.log('tabs after off', await evaluate(`window.intoponet.browserHost.getTabs().then((t) => t.length)`))

  await evaluate(`window.intoponet.browserHost.close?.(); true`)
  await delay(800)
  if (!(await evaluate(`!!document.querySelector('.bookmark-drawer')`))) await click('.bookmark-library-button', 'My map')
  await delay(800)
  await click('.drawer-tabs button', 'Locations')
  await delay(600)
  console.log('hide pin', await click('.bookmark-pin-actions button', 'Hide pin'))
  await delay(400)
  console.log('hidden saved', await evaluate(`JSON.parse(localStorage.getItem('intoponet.bookmarks.v1')).filter((b) => b.hiddenOnMap).map((b) => b.title).join(',')`))
  await shot('privacy-hide-pin')

  await click('.drawer-tabs button', 'Collections')
  await delay(600)
  await click('.collection-row .bookmark-destination', 'Pacific reading')
  await delay(600)
  console.log('why', await evaluate(`document.querySelector('.collection-why')?.innerText`))
  await shot('privacy-collection-why')
  console.log('split', await click('.collection-tools button', 'Split by site'))
  await delay(600)
  console.log('collections', await evaluate(`localStorage.getItem('intoponet.collections.v1')`))
}
