// Favicon tab rail: collapsed, hover-expanded, pinned with pane, full screen.
export default async function ({ evaluate, shot, click, delay }) {
  await delay(2500)
  await evaluate(`localStorage.setItem('intoponet.bookmark-pane.open.v1', '0'); localStorage.setItem('intoponet.tab-rail.pinned.v1', '0'); location.reload(); true`)
  await delay(3000)
  for (const url of ['https://en.wikipedia.org/wiki/Aurora', 'https://en.wikipedia.org/wiki/Moon', 'https://en.wikipedia.org/wiki/Earth']) {
    await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: '${url}' }).then(() => true)`)
    await delay(2200)
  }
  await delay(1500)
  await shot('r1-rail-collapsed')
  await evaluate(`document.querySelector('.tab-rail').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); true`)
  await delay(120)
  await shot('r2-rail-expanding')
  await delay(700)
  await shot('r3-rail-expanded')
  await click('.tab-rail-action[aria-pressed]')
  await delay(300)
  await click('button[title="Bookmarks (⇧⌘B)"]')
  await delay(1000)
  await shot('r4-rail-pinned-with-pane')
  await click('[aria-label="Full width"]')
  await delay(1200)
  await shot('r5-fullscreen-no-rail')
}
