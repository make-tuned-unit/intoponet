// Where the sun is: the lit hemisphere and the ocean glint at the subsolar point.
export default async function ({ evaluate, shotApp: shot, delay, send }) {
  const fly = async (place) => {
    await evaluate(`document.querySelector('.command-input input').focus(); true`)
    await send('Input.insertText', { text: place })
    await delay(400)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await delay(4500)
    // Zoom back out to see the whole hemisphere.
    for (let i = 0; i < 12; i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 600, deltaX: 0, deltaY: 200 })
      await delay(60)
    }
    await delay(2500)
  }
  await delay(8000)
  const sun = await evaluate(`(() => { const d = new Date(); return d.toISOString() })()`)
  console.log('time', sun)
  await fly('Fiji')
  await shot('s1-sun-pacific')
  await fly('Mexico City')
  await shot('s2-terminator-americas')
  for (const place of ['Japan', 'Kenya', 'Brazil']) {
    await evaluate(`document.querySelector('.command-input input').focus(); true`)
    await send('Input.insertText', { text: place })
    await delay(300)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await delay(3000)
    await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => el.innerText.startsWith(${JSON.stringify(place)})); row?.click(); return !!row })()`)
    await delay(1500)
    console.log(place, '→', await evaluate(`[...document.querySelectorAll('.globe-detail dt')].find((dt) => dt.textContent === 'Sun there')?.nextElementSibling?.textContent ?? 'no row'`))
    if (place === 'Japan') await shot('s3-sun-there-japan')
  }
}
