// Mid-transition frames: pane opening in full screen, then dock opening.
export default async function ({ evaluate, shot, click, delay }) {
  await delay(2500)
  await evaluate(`localStorage.setItem('intoponet.bookmark-pane.open.v1', '0'); true`)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/Aurora' }).then(() => true)`)
  await delay(4000)
  await click('[aria-label="Full width"]')
  await delay(1000)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, shiftKey: true, bubbles: true })); true`)
  await delay(90)
  await shot('m1-pane-mid')
  await delay(900)
  await shot('m2-pane-done')
  await click('.tab-dock-grabber')
  await delay(70)
  await shot('m3-dock-mid')
}
