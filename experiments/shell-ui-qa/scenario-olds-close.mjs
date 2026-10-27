// Opening and closing a chapter in The Olds: ×, Esc, and clicking the chapter again.
export default async function ({ evaluate, shotApp: shot, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(600) }
    return false
  }
  const state = () => evaluate(`({ detail: !!document.querySelector('.olds-detail'), olds: !!document.querySelector('.olds-sheet') })`)
  const openChapter = () => evaluate(`[...document.querySelectorAll('.olds-era')].find((b) => b.innerText.startsWith('Strategic'))?.click(); true`)
  await delay(6000)
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Greenland' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(3000)
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('The Olds'))?.click(); true`)
  console.log('olds loaded', await wait(`!!document.querySelector('.olds-eras')`, 120_000))
  await evaluate(`document.activeElement?.blur(); true`)
  await delay(800)
  await openChapter(); await delay(700)
  console.log('opened', JSON.stringify(await state()))
  await shot('c1-chapter-open')
  await evaluate(`document.querySelector('.olds-detail-close')?.click(); true`); await delay(700)
  console.log('after ×', JSON.stringify(await state()))
  await openChapter(); await delay(700)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await delay(700)
  console.log('after Esc', JSON.stringify(await state()))
  await openChapter(); await delay(500); await openChapter(); await delay(700)
  console.log('after clicking chapter again', JSON.stringify(await state()))
  await evaluate(`document.querySelector('.olds-card')?.click(); true`); await delay(700)
  console.log('event opened', JSON.stringify(await state()))
  await evaluate(`document.querySelector('.olds-detail-close')?.click(); true`); await delay(700)
  console.log('event after ×', JSON.stringify(await state()))
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await delay(800)
  console.log('Esc with nothing open closes The Olds', JSON.stringify(await state()))
}
