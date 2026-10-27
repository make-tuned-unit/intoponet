// Settings › auto-translate: a Russian page is detected and translated into English on its own.
export default async function ({ evaluate, shot, shotApp, delay }) {
  await delay(3000)
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.getAttribute('aria-label') === 'Settings')?.click(); true`)
  await delay(1200)
  await shotApp('settings-panel')
  // Turn on auto-translate and auto-download from the panel's own switches.
  await evaluate(`(() => { const boxes = [...document.querySelectorAll('.settings-pane input[type=checkbox]')]; boxes[0].click(); return true })()`)
  await delay(300)
  await evaluate(`(() => { const boxes = [...document.querySelectorAll('.settings-pane input[type=checkbox]')]; boxes[1].click(); return true })()`)
  await delay(300)
  console.log('settings', await evaluate(`localStorage.getItem('intoponet.settings.v1')`), '| headlines', await evaluate(`localStorage.getItem('intoponet.translate.headlines.v1')`))
  await evaluate(`document.querySelector('[aria-label="Close settings"]').click(); true`)
  await delay(500)
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://www.fontanka.ru/' }); true`)
  const start = Date.now()
  let last = ''
  while (Date.now() - start < 240_000) {
    const state = await evaluate(`window.intoponet.translate.pageState().then((s) => JSON.stringify(s))`)
    if (state !== last) { console.log(Math.round((Date.now() - start) / 1000) + 's', state.slice(0, 160)); last = state }
    if (state.includes('"translated"')) break
    await delay(2000)
  }
  await delay(1500)
  await shot('auto-translate-fontanka')
}
