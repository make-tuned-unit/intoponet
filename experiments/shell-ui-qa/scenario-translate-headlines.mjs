// Headline translation: Russia's local outlets, one click to download
// Russian and translate, then flip between Русский and English.
export default async function ({ evaluate, shotApp: shot, click, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(800) }
    return false
  }
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.some((c) => c.countryCode === 'RU' && c.headlines.length > 3))`, 300_000)
  await delay(3000)
  await evaluate(`document.querySelector('.command-input input').focus(); true`)
  await send('Input.insertText', { text: 'Russia' })
  await delay(400)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(3000)
  const opened = await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => el.innerText.startsWith('Russia')); if (!row) return false; row.click(); return true })()`)
  await delay(2500)
  const bar = () => evaluate(`document.querySelector('.tr-headline-bar')?.innerText.replace(/\\n+/g, ' | ') ?? 'no bar'`)
  const first = () => evaluate(`[...document.querySelectorAll('.globe-headlines li strong')].slice(0, 3).map((el) => el.textContent).join(' // ')`)
  console.log('opened', opened, '| bar:', await bar(), '| headlines:', await first())
  await evaluate(`document.querySelector('.globe-headlines')?.scrollIntoView(); true`)
  await shot('h1-headlines-offer')
  const t0 = Date.now()
  console.log('button:', await evaluate(`document.querySelector('.tr-inline-primary')?.outerHTML.slice(0, 200) ?? 'none'`))
  await evaluate(`document.querySelector('.tr-headline-bar button')?.click(); true`)
  await delay(1500)
  console.log('during:', await bar())
  const ok = await wait(`!!document.querySelector('.tr-flip-small') && /[A-Za-z]{4}/.test(document.querySelector('.globe-headlines li strong')?.textContent ?? '') && !/[А-я]{4}/.test(document.querySelector('.globe-headlines li strong')?.textContent ?? '')`, 240_000)
  console.log('translated', ok, Math.round((Date.now() - t0) / 1000) + 's', '| bar:', await bar(), '| headlines:', await first())
  await delay(800)
  await shot('h2-headlines-english')
  await evaluate(`[...document.querySelectorAll('.tr-flip-small button')].find((b) => !b.classList.contains('is-active'))?.click(); true`)
  await delay(800)
  console.log('flipped back | bar:', await bar(), '| headlines:', await first())
  await shot('h3-headlines-original')
  await evaluate(`[...document.querySelectorAll('.tr-flip-small button')].find((b) => !b.classList.contains('is-active'))?.click(); true`)
  await delay(800)
  console.log('flipped forward | headlines:', await first())
}
