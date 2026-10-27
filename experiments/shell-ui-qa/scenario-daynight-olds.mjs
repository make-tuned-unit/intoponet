// Day & night on the globe, and opening The Olds from the header.
export default async function ({ evaluate, shotApp: shot, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(800) }
    return false
  }
  await delay(9000)
  console.log('toggle:', await evaluate(`document.querySelector('.globe-daynight')?.innerText.replace(/\\n+/g, ' | ')`))
  await shot('d1-day-night')
  await evaluate(`document.querySelector('.globe-daynight')?.click(); true`)
  await delay(1500)
  await shot('d2-evenly-lit')
  await evaluate(`document.querySelector('.globe-daynight')?.click(); true`)
  await delay(1500)
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('The Olds'))?.click(); true`)
  await wait(`!!document.querySelector('.olds-title h2')`, 40_000)
  console.log('olds for the view centre:', await evaluate(`document.querySelector('.olds-title h2')?.textContent`))
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('The Olds'))?.click(); true`)
  await delay(800)
  // Fly to the day side (the Americas in the evening UTC) and open The Olds for that place.
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Mexico City' })
  await delay(400)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(4000)
  await shot('d2b-day-side')
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('The Olds'))?.click(); true`)
  const ok = await wait(`!!document.querySelector('.olds-sheet') && !document.querySelector('.olds-status:not(.is-error)')`, 40_000)
  await delay(1200)
  console.log('olds', ok, (await evaluate(`document.querySelector('.olds-sheet')?.innerText.slice(0, 200) ?? 'none'`)).replace(/\n+/g, ' | '))
  await shot('d3-olds-from-header')
}
