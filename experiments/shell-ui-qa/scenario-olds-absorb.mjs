// Rising/fading, The Olds and Absorb + Knowledge, end to end in the real app.
export default async function ({ evaluate, shot, shotApp, click, delay, send }) {
  const wait = async (expr, ms = 120_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(1000) }
    return false
  }
  await wait(`document.querySelectorAll('.globe-list .globe-row').length > 10`)
  await wait(`Number(document.querySelector('.globe-layer-list li:nth-child(1) .globe-layer-count')?.textContent ?? 0) > 300`, 180_000)
  await delay(4000)
  // Rising tab
  await click('.globe-tabs button:nth-child(2)')
  await delay(1200)
  await shotApp('o1-rising')
  console.log('rising rows', await evaluate(`document.querySelectorAll('.globe-list .globe-row').length`), 'terms', await evaluate(`[...document.querySelectorAll('.globe-rising-terms button span')].map((el) => el.textContent).join(', ')`))
  const term = await evaluate(`!!document.querySelector('.globe-rising-terms button')`)
  if (term) {
    await click('.globe-rising-terms button')
    await delay(1500)
    await shotApp('o2-rising-term')
    await click('.globe-term .globe-back')
  }
  // The Olds from a country's local news (Germany), then follow a thread
  await click('.globe-tabs button:nth-child(1)')
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Germany' })
  await delay(400)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(2500)
  console.log('germany row', await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => el.innerText.startsWith('Germany')); row?.click(); return !!row })()`))
  await delay(2000)
  await shotApp('o2b-country-trend')
  await click('.globe-headlines-actions button[aria-label="The Olds: history"]')
  await wait(`!!document.querySelector('.olds-card, .olds-status')`, 30_000)
  await wait(`!document.querySelector('.olds-spin')`, 45_000)
  await delay(1500)
  await shotApp('o3-olds-timeline')
  console.log('olds', await evaluate(`document.querySelector('.olds-sheet')?.innerText.slice(0, 300).replace(/\\n+/g, ' | ')`))
  if (await evaluate(`!!document.querySelector('.olds-card')`)) {
    await click('.olds-card')
    await delay(900)
    await shotApp('o4-olds-detail')
    await click('.olds-follow')
    await wait(`!document.querySelector('.olds-spin')`, 45_000)
    await delay(1500)
    await shotApp('o5-olds-followed')
    console.log('followed', await evaluate(`document.querySelector('.olds-title h2')?.textContent`))
    await click('.olds-views button:nth-child(2)')
    await delay(800)
    await shotApp('o6-olds-list')
  }
  await click('.olds-head .lg-icon-button[aria-label="Close The Olds"]')
  // Absorb a real article
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/Aurora' }).then(() => true)`)
  await delay(5000)
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Absorb this page into your knowledge')?.click(); true`)
  await wait(`!!document.querySelector('.absorb-title, .absorb-refused, .absorb-status.is-error')`, 20_000)
  await delay(800)
  await shotApp('o7-absorb-preview')
  console.log('absorb', await evaluate(`document.querySelector('.absorb-sheet')?.innerText.slice(0, 300).replace(/\\n+/g, ' | ')`))
  await click('.absorb-primary')
  await wait(`!document.querySelector('.absorb-sheet')`, 20_000)
  await delay(800)
  console.log('notice', await evaluate(`document.querySelector('.notice-message')?.innerText`))
  // A sensitive page is refused
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://github.com/login' }).then(() => true)`)
  await delay(4000)
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Absorb this page into your knowledge')?.click(); true`)
  await wait(`!!document.querySelector('.absorb-refused, .absorb-title')`, 20_000)
  await delay(600)
  await shotApp('o8-absorb-refused')
  console.log('refused', await evaluate(`document.querySelector('.absorb-sheet')?.innerText.slice(0, 200).replace(/\\n+/g, ' | ')`))
  await click('.absorb-head .lg-icon-button')
  await evaluate(`window.intoponet.browserHost.close().then(() => true)`)
  await delay(1500)
  // Knowledge search with citations
  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.startsWith('Knowledge'))?.click(); true`)
  await delay(1200)
  await evaluate(`document.querySelector('.knowledge-search input').focus(); true`)
  await send('Input.insertText', { text: 'solar wind' })
  await wait(`document.querySelectorAll('.knowledge-list li').length > 0`, 10_000)
  await click('.knowledge-list li button')
  await delay(1500)
  await shotApp('o9-knowledge-cited')
  console.log('hit', await evaluate(`document.querySelector('.knowledge-list li')?.innerText.replace(/\\n+/g, ' | ')`))
  await click('.knowledge-sheet .absorb-head .lg-icon-button')
  // Mine view shows absorbed places privately
  await click('.globe-segment button:nth-child(2)')
  await delay(2000)
  await shotApp('o10-mine-knowledge')
}
