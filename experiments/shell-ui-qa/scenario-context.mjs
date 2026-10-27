// The bigger picture card at the top of a country's news panel.
export default async function ({ evaluate, shotApp: shot, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(700) }
    return false
  }
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.length > 150)`, 300_000)
  await delay(2000)
  for (const [place, name] of [['Curaçao', 'x1-curacao'], ['Greenland', 'x2-greenland']]) {
    await evaluate(`document.querySelector('.command-input input').focus(); true`)
    await send('Input.insertText', { text: place })
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await delay(3000)
    const opened = await evaluate(`(() => { const rows = [...document.querySelectorAll('.globe-list .globe-row')]; const row = rows.find((el) => el.innerText.startsWith(${JSON.stringify(place)})) ?? rows.find((el) => el.innerText.includes('stories')); row?.click(); return row?.innerText.split('\\n')[0] ?? null })()`)
    await wait(`!!document.querySelector('.globe-context-chapter, .globe-context-links')`, 60_000)
    await delay(800)
    console.log(place, opened, '|', await evaluate(`document.querySelector('.globe-context')?.innerText.replace(/\\n+/g, ' | ') ?? 'no context'`))
    console.log('  note:', await evaluate(`document.querySelector('.tr-headline-note')?.textContent ?? '-'`), '| icon:', await evaluate(`(() => { const b = document.querySelector('.globe-headlines .headline-history'); if (!b) return 'none'; const r = b.getBoundingClientRect(); const li = b.closest('li').getBoundingClientRect(); return Math.round(r.width) + 'px wide, right gap ' + Math.round(li.right - r.right) })()`))
    await shot(name)
    await evaluate(`document.querySelector('.globe-close')?.click(); true`)
    await delay(600)
  }
}
