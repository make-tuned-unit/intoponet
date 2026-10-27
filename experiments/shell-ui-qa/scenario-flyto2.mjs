// With a page open: typing a place and pressing Enter spins the globe there (no browser).
export default async function ({ evaluate, shot, delay, send }) {
  await delay(4000)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://www.cbc.ca/news' }); true`)
  await delay(5000)
  const go = async (text) => {
    await evaluate(`(() => { const i = document.querySelector('.command-input input'); i.focus(); i.select(); return true })()`)
    await send('Input.insertText', { text })
    await delay(700)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await delay(3500)
    const state = await evaluate(`window.intoponet.browserHost.getState().then((s) => JSON.stringify({ pageOpen: s.isVisible, url: s.url }))`)
    const title = await evaluate(`[...document.querySelectorAll('h1')].map((h) => h.innerText).join(' | ')`)
    const near = await evaluate(`(document.querySelector('.globe-hud-summary, .field-meta, [class*=signals-within]')?.innerText ?? [...document.querySelectorAll('p')].find((p) => /public signals/.test(p.innerText))?.innerText ?? '').slice(0, 90)`)
    console.log(JSON.stringify(text), '→ title:', title, '|', state, '|', near)
  }
  await go('Charlottetown PEI')
  await shot('flyto-pei')
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://www.cbc.ca/news' }); true`)
  await delay(4000)
  await go('Fredericto')
  await go('Paris attacks timeline')
}
