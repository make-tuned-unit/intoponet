// Short window: Bigger Picture fully visible, Olds timeline cards not clipped, and headline history relevance (Honduras).
export default async function ({ evaluate, shotApp: shot, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(700) }
    return false
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1380, height: 820, deviceScaleFactor: 2, mobile: false })
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.length > 150)`, 300_000)
  await delay(1500)
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Honduras' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(3000)
  await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => el.innerText.startsWith('Honduras')); row?.click(); return true })()`)
  await wait(`!!document.querySelector('.globe-context-links, .globe-context-facts')`, 60_000)
  await delay(800)
  console.log('context box', await evaluate(`(() => { const el = document.querySelector('.globe-context'); return el ? 'client ' + el.clientHeight + ' / scroll ' + el.scrollHeight : 'none' })()`))
  await shot('hn-context')
  // Each headline's history, judged by eye from the log.
  const count = await evaluate(`document.querySelectorAll('.globe-headlines .headline-history').length`)
  for (let i = 0; i < Math.min(4, count); i += 1) {
    const title = await evaluate(`document.querySelectorAll('.globe-headlines .headline-history')[${i}].closest('li').innerText.split('\\n')[0]`)
    await evaluate(`document.querySelectorAll('.globe-headlines .headline-history')[${i}].click(); true`)
    await wait(`!!document.querySelector('.olds-sheet h2') && !document.querySelector('.olds-status .olds-spin')`, 90_000)
    await delay(1000)
    console.log(`\n[${i}] ${title}\n  → ${await evaluate(`document.querySelector('.olds-sheet h2')?.innerText`)}\n  ${await evaluate(`document.querySelector('.olds-story-why, .olds-story p')?.innerText ?? ''`)}`)
    if (i === 0) await shot('hn-story')
  }
  // Country timeline (Its history): no card above or below the track.
  await evaluate(`document.querySelector('.olds-sheet [aria-label="Close The Olds"]')?.click(); true`)
  await delay(800)
  await evaluate(`document.querySelector('.globe-context-open')?.click(); true`)
  await wait(`document.querySelectorAll('.olds-card').length > 3`, 90_000)
  await delay(1500)
  console.log('\ntimeline', await evaluate(`(() => { const t = document.querySelector('.olds-track')?.getBoundingClientRect(); if (!t) return 'no track'; const cards = [...document.querySelectorAll('.olds-card')].map((c) => c.getBoundingClientRect()); const clipped = cards.filter((c) => c.top < t.top - 1 || c.bottom > t.bottom + 1).length; return 'track ' + Math.round(t.height) + 'px, cards ' + cards.length + ', clipped ' + clipped })()`))
  await shot('hn-timeline')
}
