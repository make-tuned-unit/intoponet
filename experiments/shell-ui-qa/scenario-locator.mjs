// Fly to Dar es Salaam: a pulsing locator marks the exact spot.
export default async function ({ evaluate, shotApp, delay, send }) {
  await delay(4500)
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Dar es Salaam' })
  await delay(600)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(1200)
  await shotApp('locator-1-landing')
  await delay(2500)
  const state = await evaluate(`(() => { const el = document.querySelector('.globe-locator'); if (!el) return 'none'; const r = el.getBoundingClientRect(); return 'opacity ' + getComputedStyle(el).opacity + ' at ' + Math.round(r.left) + ',' + Math.round(r.top) + ' of ' + innerWidth + 'x' + innerHeight + ' label ' + el.innerText })()`)
  console.log('locator:', state, '| title:', await evaluate(`document.querySelector('h1')?.innerText`))
  await shotApp('locator-2-settled')
  // Spin it away: the locator hides behind the globe.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 600 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 600, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 20; i += 1) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700 + i * 40, y: 600, button: 'left', buttons: 1 }); await delay(16) }
  await delay(200)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1500, y: 600, button: 'left', clickCount: 1 })
  await delay(1500)
  console.log('after spinning away, opacity:', await evaluate(`getComputedStyle(document.querySelector('.globe-locator')).opacity`))
}
