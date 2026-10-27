// Toolbar names its features; the tab rail waits 1 s on hover and a click does not expand it.
export default async function ({ evaluate, shot, delay, send }) {
  await delay(3000)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://example.com/' }); true`)
  await delay(4000)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://www.wikipedia.org/' }); true`)
  await delay(4000)
  console.log('labels', await evaluate(`[...document.querySelectorAll('.browser-actions .chrome-label')].filter((el) => getComputedStyle(el).display !== 'none').map((el) => el.textContent).join(', ')`))
  console.log('address width', await evaluate(`Math.round(document.querySelector('.origin-badge').getBoundingClientRect().width)`))
  await shot('toolbar-wide')
  const rail = `document.querySelector('.tab-rail')`
  const box = await evaluate(`(() => { const r = ${rail}?.querySelector('.tab-rail-tab')?.getBoundingClientRect(); return r ? JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) : null })()`)
  console.log('rail tab', box)
  if (box) {
    const { x, y } = JSON.parse(box)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await delay(500)
    console.log('open after 0.5 s', await evaluate(`${rail}.classList.contains('is-open')`))
    await delay(900)
    console.log('open after 1.4 s', await evaluate(`${rail}.classList.contains('is-open')`))
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 400 })
    await delay(800)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await delay(300)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await delay(1500)
    console.log('open 1.5 s after a click', await evaluate(`${rail}.classList.contains('is-open')`))
  }
}
