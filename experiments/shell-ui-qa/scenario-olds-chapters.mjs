// The Olds for Greenland: chapters from its history article, dragging back
// through time, and a chapter's detail.
export default async function ({ evaluate, shotApp: shot, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(800) }
    return false
  }
  await delay(6000)
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Greenland' })
  await delay(300)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(3000)
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('The Olds'))?.click(); true`)
  const ok = await wait(`!!document.querySelector('.olds-eras')`, 60_000)
  await delay(1500)
  console.log('chapters', ok, await evaluate(`[...document.querySelectorAll('.olds-era')].map((b) => b.innerText.replace(/\\n/g, ' ')).join(' | ')`))
  console.log('events', await evaluate(`[...document.querySelectorAll('.olds-card strong')].map((s) => s.textContent).join(' | ')`))
  console.log('edges', await evaluate(`[...document.querySelectorAll('.olds-edge')].map((b) => b.innerText).join(',')`))
  await shot('o1-greenland-now')
  // Drag right → back in time.
  const box = await evaluate(`(() => { const r = document.querySelector('.olds-track').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x - 200, y: box.y + 120, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 12; i += 1) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x - 200 + i * 60, y: box.y + 120, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 520, y: box.y + 120, button: 'left', clickCount: 1 })
  await delay(800)
  console.log('after drag scrollLeft', await evaluate(`document.querySelector('.olds-track').scrollLeft`), 'current chapter', await evaluate(`document.querySelector('.olds-era.is-current')?.innerText.replace(/\\n/g, ' ') ?? 'none'`))
  await evaluate(`[...document.querySelectorAll('.olds-era')].find((b) => b.innerText.startsWith('Norse settlement'))?.click(); true`)
  await delay(1200)
  console.log('chapter detail', await evaluate(`document.querySelector('.olds-detail')?.innerText.replace(/\\n+/g, ' | ').slice(0, 300) ?? 'none'`))
  await shot('o2-greenland-norse')
  await evaluate(`[...document.querySelectorAll('.olds-era')].find((b) => b.innerText.startsWith('Second presidency'))?.click(); true`)
  await delay(1200)
  await shot('o3-greenland-crisis')
}
