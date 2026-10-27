// Fly to "Charlottetown PEI"; close tabs (used to crash main); drag then zoom keeps the globe where it was left.
export default async function ({ evaluate, shotApp, delay, send }) {
  await delay(4000)
  // Tabs open and close: the 'destroyed' handler used to throw in main.
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://example.com/' }); true`)
  await delay(3000)
  const tabs = await evaluate(`window.intoponet.browserHost.getTabs().then((t) => JSON.stringify(t.map((x) => x.id)))`)
  for (const id of JSON.parse(tabs)) await evaluate(`window.intoponet.browserHost.closeTab(${JSON.stringify(id)}).then(() => true)`)
  await delay(1500)
  console.log('main alive after closing tabs:', await evaluate(`window.intoponet.browserHost.getTabs().then((t) => 'yes, ' + t.length + ' tabs')`))
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Charlottetown PEI' })
  await delay(600)
  console.log('suggestions:', await evaluate(`[...document.querySelectorAll('[role=option], .launcher-suggestion, .command-suggestions li')].slice(0, 3).map((el) => el.innerText.replace(/\\n/g, ' ')).join(' | ') || 'none'`))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(3500)
  console.log('place:', await evaluate(`[...document.querySelectorAll('.place-title h1, .globe-place-title, h1')].map((h) => h.innerText).join(' | ')`), '| error:', await evaluate(`document.querySelector('.notice.is-error, [role=alert]')?.innerText ?? 'none'`))
  await shotApp('flyto-charlottetown')
  // Drag right, release, then zoom: the view must not swing back.
  const centre = () => evaluate(`document.querySelector('.place-breadcrumb, .globe-breadcrumb')?.innerText ?? ''`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 500, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 12; i += 1) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900 - i * 30, y: 500, button: 'left', buttons: 1 }); await delay(16) }
  await delay(200)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 540, y: 500, button: 'left', clickCount: 1 })
  await delay(1500)
  await shotApp('after-drag')
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 500, deltaX: 0, deltaY: -240 })
  await delay(2500)
  await shotApp('after-drag-zoom')
}
