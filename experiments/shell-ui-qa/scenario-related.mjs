// Topics behind a story, shown in the Olds Story view from a Canadian headline.
export default async function ({ evaluate, shotApp, delay, send }) {
  const wait = async (expr, ms = 90_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await delay(800) } return false }
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.length > 150)`, 300_000)
  await delay(1500)
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Canada' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(3000)
  console.log('rows:', await evaluate(`[...document.querySelectorAll('.globe-list .globe-row')].slice(0, 6).map((el) => el.innerText.split('\\n')[0]).join(' | ')`))
  await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => el.innerText.startsWith('Canada')) ?? [...document.querySelectorAll('.globe-list .globe-row')].find((el) => /stories/.test(el.innerText)); row?.click(); return true })()`)
  await delay(2000)
  console.log('detail:', await evaluate(`document.querySelector('.globe-detail h2, .globe-detail strong')?.innerText ?? 'none'`))
  await wait(`document.querySelectorAll('.globe-headlines .headline-history').length > 0`, 60_000)
  const titles = await evaluate(`[...document.querySelectorAll('.globe-headlines li')].map((li) => li.innerText.split('\\n')[0])`)
  const pick = titles.findIndex((t) => /police|court|prison|jail|hospital|housing|rent|crime|charged|health|school|election/i.test(t))
  const index = pick === -1 ? 0 : pick
  console.log('headline:', titles[index])
  await evaluate(`document.querySelectorAll('.globe-headlines .headline-history')[${index}].click(); true`)
  await wait(`!!document.querySelector('.olds-related') || (!!document.querySelector('.olds-sheet h2') && !document.querySelector('.olds-status .olds-spin'))`, 120_000)
  await delay(1500)
  console.log('related:', await evaluate(`[...document.querySelectorAll('.olds-related-card strong')].map((s) => s.innerText).join(' | ') || 'none'`))
  await shotApp('olds-related')
}
