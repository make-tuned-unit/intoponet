// Living globe: live layers, hover, select, place search, filters, Mine view.
export default async function ({ evaluate, shotApp: shot, click, delay, send }) {
  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
  // Wait for live public data (fresh profile, no cache).
  for (let i = 0; i < 60; i += 1) {
    const n = await evaluate(`document.querySelectorAll('.globe-list .globe-row').length`)
    if (n > 5) break
    await delay(1000)
  }
  await delay(2500)
  await shot('g1-globe-live')
  const target = await evaluate(`(() => {
    const labels = [...document.querySelectorAll('.globe-label')].filter((el) => Number(el.style.opacity) > 0.9)
    const el = labels[1] ?? labels[0]
    if (!el) return null
    const m = el.style.transform.match(/translate3d\\(([-\\d.]+)px, ([-\\d.]+)px/)
    return { x: Number(m[1]) - 10, y: Number(m[2]) + el.offsetHeight / 2, text: el.textContent }
  })()`)
  console.log('target', JSON.stringify(target))
  if (target) {
    await mouse('mouseMoved', target.x - 30, target.y - 30)
    await delay(100)
    await mouse('mouseMoved', target.x, target.y)
    await delay(600)
    await shot('g2-hover')
    await mouse('mousePressed', target.x, target.y)
    await mouse('mouseReleased', target.x, target.y)
    await delay(2600)
    await shot('g3-selected')
  }
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Tokyo' })
  await delay(700)
  await shot('g4-place-suggestions')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(3200)
  await shot('g5-fly-tokyo')
  await click('.globe-layer-list li:nth-child(1) button')
  await click('.globe-window button:nth-child(3)')
  await click('.globe-about-toggle')
  await delay(1500)
  await shot('g6-filters-about')
  await click('.globe-trail button')
  await click('.globe-segment button:nth-child(2)')
  await delay(1500)
  await shot('g7-mine')
  const errors = await evaluate(`window.__errors ?? []`)
  console.log('errors', JSON.stringify(errors))
}
