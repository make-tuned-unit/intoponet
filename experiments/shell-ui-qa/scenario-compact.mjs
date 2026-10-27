// Compact layer card (expands on hover) and readable links for natural hazards.
export default async function ({ evaluate, shotApp: shot, delay, send }) {
  const wait = async (expr, ms = 60_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) { if (await evaluate(expr)) return true; await delay(1200) }
    return false
  }
  await wait(`document.querySelectorAll('.globe-list .globe-row').length > 5`, 120_000)
  await delay(1500)
  const box = () => evaluate(`(() => { const r = document.querySelector('.globe-layers').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + (document.querySelector('.globe-layers').classList.contains('is-compact') ? ' compact' : ' open') })()`)
  console.log('at rest:', await box())
  await shot('c1-compact')
  const r = await evaluate(`(() => { const b = document.querySelector('.globe-compact-icon').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await delay(700)
  console.log('hovered:', await box(), '| rows:', await evaluate(`[...document.querySelectorAll('.globe-layers .globe-layer strong')].map((s) => s.textContent).join(', ')`))
  await shot('c2-expanded')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 500 })
  await delay(900)
  console.log('after leaving:', await box())
  // A natural hazard's links: show only that layer.
  await evaluate(`[...document.querySelectorAll('.globe-compact-icon')].slice(0, 2).forEach((b) => b.classList.contains('is-on') && b.click()); true`)
  await wait(`[...document.querySelectorAll('.globe-list .globe-row')].some((el) => /storm|Hurricane|Typhoon|Cyclone|Wildfire|Flood|Volcano/i.test(el.innerText))`, 120_000)
  const opened = await evaluate(`(() => { const row = [...document.querySelectorAll('.globe-list .globe-row')].find((el) => /storm|Hurricane|Typhoon|Cyclone|Wildfire|Flood|Volcano/i.test(el.innerText)); row?.click(); return row?.innerText.split('\\n')[0] ?? null })()`)
  await delay(1000)
  console.log('hazard:', opened, '| actions:', await evaluate(`[...document.querySelectorAll('.globe-actions button')].map((b) => (b.innerText || b.getAttribute('aria-label')) + (b.title ? ' [' + b.title.slice(0, 90) + ']' : '')).join(' | ')`), '| footer:', await evaluate(`document.querySelector('.globe-provenance')?.innerText`))
  await shot('c3-hazard')
}
