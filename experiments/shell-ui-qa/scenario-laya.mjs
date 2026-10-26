// Laya: absorb three articles, opt in, then ask / meaning search / themes / related.
export default async function ({ evaluate, shotApp, click, delay, send }) {
  const wait = async (expr, ms = 120_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(1000) }
    return false
  }
  await delay(5000)
  for (const url of ['https://en.wikipedia.org/wiki/Aurora', 'https://en.wikipedia.org/wiki/Sourdough', 'https://en.wikipedia.org/wiki/Solar_wind']) {
    await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: ${JSON.stringify(url)} }).then(() => true)`)
    await delay(5000)
    await evaluate(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Absorb this page into your knowledge')?.click(); true`)
    await wait(`!!document.querySelector('.absorb-primary')`, 20_000)
    await click('.absorb-primary')
    await wait(`!document.querySelector('.absorb-sheet')`, 20_000)
    await delay(500)
  }
  await evaluate(`window.intoponet.browserHost.close().then(() => true)`)
  await delay(1200)
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('Knowledge'))?.click(); true`)
  await wait(`!!document.querySelector('.laya-strip')`, 10_000)
  await delay(800)
  await shotApp('l1-laya-offer')
  await click('.laya-strip .absorb-primary')
  const t0 = Date.now()
  const ready = await wait(`(() => { const t = document.querySelector('.laya-strip.is-on span')?.textContent ?? ''; const m = t.match(/(\\d+) of (\\d+) pages understood/); return !!m && m[1] === m[2] && m[2] !== '0' })()`, 400_000)
  console.log('laya ready', ready, Math.round((Date.now() - t0) / 1000) + 's', await evaluate(`document.querySelector('.laya-strip')?.innerText`))
  await shotApp('l2-laya-on-themes')
  // Ask
  await click('.knowledge-mode button:nth-child(2)')
  await evaluate(`document.querySelector('.knowledge-search input').focus(); true`)
  await send('Input.insertText', { text: 'why does the sky glow green near the poles?' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait(`!!document.querySelector('.knowledge-passage') || /closely enough/.test(document.querySelector('.knowledge-list')?.innerText ?? '')`, 30_000)
  await delay(600)
  console.log('ask', await evaluate(`[...document.querySelectorAll('.knowledge-passage')].slice(0, 3).map((el) => el.innerText.replace(/\\n+/g, ' | ').slice(0, 160)).join('\\n')`))
  await click('.knowledge-passage')
  await delay(1500)
  await shotApp('l3-laya-ask')
  // Meaning search
  await click('.knowledge-mode button:nth-child(1)')
  await evaluate(`(() => { const i = document.querySelector('.knowledge-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); return true })()`)
  await send('Input.insertText', { text: 'making bread rise with wild yeast' })
  await wait(`document.querySelectorAll('.knowledge-list li').length > 0`, 20_000)
  await delay(800)
  console.log('search', await evaluate(`[...document.querySelectorAll('.knowledge-list li')].slice(0, 3).map((el) => el.innerText.replace(/\\n+/g, ' | ').slice(0, 140)).join('\\n')`))
  await click('.knowledge-list li button')
  await delay(1500)
  await evaluate(`document.querySelector('.knowledge-related')?.scrollIntoView(); true`)
  await delay(600)
  await shotApp('l4-laya-search-related')
  console.log('related', await evaluate(`document.querySelector('.knowledge-related')?.innerText.replace(/\\n+/g, ' | ').slice(0, 300) ?? 'none'`))
}
