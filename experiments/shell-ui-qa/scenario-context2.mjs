// Context card for Russia (facts, names behind today's headlines, recent history), a name chip, and a chapter's events.
export default async function ({ evaluate, shotApp: shot, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(1000) }
    return false
  }
  await evaluate(`window.intoponet.translate.install('ru').then(() => true)`)
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.some((c) => c.countryCode === 'RU' && c.headlines.length > 6))`, 300_000)
  const fly = async (place) => {
    await evaluate(`document.querySelector('.command-input input').focus(); true`)
    await send('Input.insertText', { text: place })
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await delay(3000)
  }
  await fly('Russia')
  await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => el.innerText.startsWith('Russia')); row?.click(); return !!row })()`)
  await wait(`!!document.querySelector('.globe-context-facts')`, 60_000)
  await delay(4000)
  console.log('card:', await evaluate(`document.querySelector('.globe-context')?.innerText.replace(/\\n+/g, ' | ')`))
  console.log('fits:', await evaluate(`(() => { const c = document.querySelector('.globe-context').getBoundingClientRect(); const p = document.querySelector('.globe-panel').getBoundingClientRect(); return c.right <= p.right + 1 })()`))
  await shot('b1-russia-context')
  const chip = await evaluate(`(() => { const b = document.querySelector('.globe-context-links[aria-label="Names in today\\'s headlines"] button'); b?.click(); return b?.innerText.replace(/\\n/g, ' ') ?? null })()`)
  const ok = await wait(`!!document.querySelector('.olds-story-track')`, 90_000)
  await delay(1000)
  console.log('chip:', chip, ok, '|', await evaluate(`document.querySelector('.olds-story-track')?.innerText.replace(/\\n+/g, ' | ') ?? document.querySelector('.olds-sheet')?.innerText.slice(0, 200)`))
  await shot('b2-name-story')
  await evaluate(`document.querySelector('.olds-sheet .lg-icon-button[aria-label="Close The Olds"]')?.click(); document.querySelector('.globe-close')?.click(); true`)
  await delay(800)
  await fly('Mauritania')
  await evaluate(`[...document.querySelectorAll('.bookmark-library-button')].find((b) => b.innerText.includes('The Olds'))?.click(); true`)
  await wait(`!!document.querySelector('.olds-eras')`, 90_000)
  await evaluate(`[...document.querySelectorAll('.olds-era')].find((b) => b.innerText.startsWith('Islamization'))?.click(); true`)
  await wait(`/Key events of/.test(document.querySelector('.olds-chapter-bar')?.innerText ?? '')`, 60_000)
  await delay(800)
  console.log('chapter:', await evaluate(`document.querySelector('.olds-chapter-bar')?.innerText.replace(/\\n+/g, ' | ')`), '|', await evaluate(`[...document.querySelectorAll('.olds-card strong')].map((s) => s.textContent).join(' · ')`))
  await shot('b3-chapter-events')
}
