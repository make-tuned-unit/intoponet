// Keyboard: open each header panel with Enter, close with Escape, focus returns.
export default async function ({ evaluate, delay, send }) {
  await delay(4000)
  const key = async (k, code = k) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, ...(k === 'Enter' ? { text: '\r' } : {}), windowsVirtualKeyCode: k === 'Escape' ? 27 : k === 'Enter' ? 13 : k === 'Tab' ? 9 : 0 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : k === 'Enter' ? 13 : k === 'Tab' ? 9 : 0 }) }
  const open = { Bookmarks: '.bookmark-pane .bm-surface, .bm-surface', 'The Olds': '.olds-sheet', Knowledge: '.knowledge-sheet', 'My map': '.bookmark-drawer', Settings: '.settings-drawer' }
  for (const [label, selector] of Object.entries(open)) {
    await evaluate(`(() => { const b = [...document.querySelectorAll('.bookmark-library-button')].find((el) => (el.innerText || el.getAttribute('aria-label') || '').includes(${JSON.stringify(label)})); b.focus(); return true })()`)
    await key('Enter')
    await delay(1500)
    const opened = await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
    await key('Escape')
    await delay(900)
    const closed = !(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`))
    const focus = await evaluate(`(() => { const a = document.activeElement; return a.tagName + '.' + String(a.className).slice(0, 30) + ' ' + (a.getAttribute('aria-label') || a.innerText || '').trim().slice(0, 20) })()`)
    console.log(label.padEnd(10), 'opened', opened, '| Esc closed', closed, '| focus now:', focus)
  }
  // Visible focus ring on a header button.
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')][1].focus(); true`)
  console.log('focus ring', await evaluate(`(() => { const el = document.activeElement; const cs = getComputedStyle(el); return el.className + ' focusVisible=' + el.matches(':focus-visible') + ' outline=' + cs.outlineStyle + ' ' + cs.outlineWidth + ' shadow=' + (cs.boxShadow !== 'none') })()`))
}
