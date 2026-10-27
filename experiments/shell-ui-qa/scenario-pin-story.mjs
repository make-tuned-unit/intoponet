// Pin editor place suggestions and search; the history behind a live headline.
export default async function ({ evaluate, shotApp: shot, shot: shotWindow, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(700) }
    return false
  }
  const typeIn = async (selector, text) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus(); true`)
    await send('Input.insertText', { text })
  }
  await delay(5000)
  // 1. Pin a page about Vanuatu.
  await evaluate(`window.intoponet.browserHost.open({ kind: 'url', value: 'https://en.wikipedia.org/wiki/History_of_Vanuatu' }).then(() => true)`)
  await delay(6000)
  await evaluate(`[...document.querySelectorAll('button')].find((b) => /Pin current page to My map|Edit current page pin/.test(b.getAttribute('aria-label') ?? ''))?.click(); true`)
  await wait(`!!document.querySelector('.pin-editor')`, 10_000)
  await delay(600)
  console.log('pin place:', await evaluate(`document.querySelector('.pin-editor-chosen')?.innerText.replace(/\\n+/g, ' | ') ?? 'none'`))
  await shot('p1-pin-suggested')
  await evaluate(`[...document.querySelectorAll('.pin-editor-chosen button')].find((b) => b.innerText === 'Change')?.click(); true`)
  await delay(300)
  await typeIn('.pin-editor-search input', 'Port V')
  await delay(500)
  console.log('search results:', await evaluate(`[...document.querySelectorAll('.pin-editor-results li')].map((li) => li.innerText.replace(/\\n+/g, ' · ')).join(' | ')`))
  await shot('p2-pin-search')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(400)
  console.log('after Enter:', await evaluate(`document.querySelector('.pin-editor-chosen')?.innerText.replace(/\\n+/g, ' | ') ?? 'none'`))
  await evaluate(`[...document.querySelectorAll('.pin-editor-actions button')].find((b) => b.innerText === 'Cancel')?.click(); true`)
  await delay(800)
  await evaluate(`window.intoponet.browserHost.close().then(() => true)`)
  await delay(1500)
  // 2. The history behind a live headline (Kenya).
  await wait(`window.intoponet.browserHost.getNewsDigest().then((raw) => !!raw && JSON.parse(raw).countries.some((c) => c.countryCode === 'KE' && c.headlines.length > 0))`, 240_000)
  await typeIn('.command-input input', 'Kenya')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await delay(3000)
  await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => el.innerText.startsWith('Kenya')); row?.click(); return !!row })()`)
  await delay(1500)
  const headline = await evaluate(`document.querySelector('.globe-headlines li strong')?.textContent ?? 'none'`)
  console.log('headline:', headline)
  await evaluate(`document.querySelector('.globe-headlines .headline-history')?.click(); true`)
  const ok = await wait(`!!document.querySelector('.olds-story-track')`, 90_000)
  await delay(1200)
  console.log('story', ok, (await evaluate(`document.querySelector('.olds-story-track')?.innerText.replace(/\\n+/g, ' | ') ?? document.querySelector('.olds-sheet')?.innerText.slice(0, 300)`)))
  console.log('note:', await evaluate(`document.querySelector('.olds-story-note')?.textContent ?? ''`))
  await shot('p3-story')
  await evaluate(`[...document.querySelectorAll('.olds-views button')].find((b) => b.innerText.includes('Timeline'))?.click(); true`)
  await delay(900)
  console.log('sources:', await evaluate(`document.querySelector('.olds-sources')?.innerText.replace(/\\n+/g, ' | ') ?? 'none'`))
  await shot('p4-timeline-sources')
}
