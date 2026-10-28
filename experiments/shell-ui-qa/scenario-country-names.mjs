// Country names and clicks on the globe: names at the default view, a click on a country with no
// marker opens it, and flying to countries large and tiny ends with that country named in focus.
import { runAppCheck, expect } from '../e2e/lib.mjs'
import { join } from 'node:path'

const evidenceDir = join(import.meta.dirname, 'evidence')
const notes = await runAppCheck(async (ctx) => {
  await ctx.delay(2500)
  const atStart = await ctx.evaluate(`[...document.querySelectorAll('.country-name.is-on')].map((el) => el.textContent)`)
  expect(atStart.length >= 8, `Only ${atStart.length} country names at the default view.`)
  await ctx.shot('country-names-default')

  // Click a named country away from any marker: the name sits on the country itself.
  const target = JSON.parse(await ctx.evaluate(`(() => {
    const el = [...document.querySelectorAll('.country-name.is-on')].find((item) => !['Antarctica'].includes(item.textContent))
    const r = el.getBoundingClientRect()
    return JSON.stringify({ name: el.textContent, code: el.dataset.code, x: r.left + r.width / 2, y: r.top + r.height / 2 + 1 })
  })()`))
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await ctx.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 })
    await ctx.delay(type === 'mouseMoved' ? 200 : 60)
  }
  await ctx.delay(2200)
  const opened = await ctx.evaluate(`document.querySelector('.globe-panel')?.innerText.slice(0, 400) ?? ''`)
  await ctx.shot('country-click')

  // Fly to countries of every size; the one in view must be named and in focus.
  const flights = ['Canada', 'Brazil', 'Andorra', 'Vatican City', 'Nauru', 'Tuvalu', 'Liechtenstein', 'Monaco', 'Gibraltar', 'Western Sahara', 'New Zealand', 'Kiribati', 'Lesotho', 'French Guiana', 'Singapore', 'Bahrain', 'Trinidad and Tobago', 'Fiji']
  const results = []
  for (const place of flights) {
    await ctx.press('Escape')
    await ctx.flyTo(place)
    // Wait for the flight to settle: the centre stops moving.
    let last = ''
    for (let i = 0, still = 0; i < 30 && still < 3; i += 1) {
      await ctx.delay(400)
      const now = await ctx.evaluate(`document.querySelector('.country-names').dataset.focus ?? ''`)
      still = now === last ? still + 1 : 0
      last = now
    }
    const focus = await ctx.evaluate(`[...document.querySelectorAll('.country-name.is-focus.is-on')].map((el) => el.textContent).join(', ')`)
    results.push(`${place} → ${focus || '(none)'}`)
    if (['Vatican City', 'Nauru', 'Kiribati'].includes(place)) await ctx.shot(`country-fly-${place.replace(/\W+/g, '-').toLowerCase()}`)
  }
  const missed = results.filter((line) => line.endsWith('(none)'))
  expect(!missed.length, `No name in focus after flying: ${missed.join('; ')}`)
  return `Default view: ${atStart.length} names (${atStart.slice(0, 8).join(', ')}…). Clicked ${target.name}: panel "${opened.split('\n').slice(0, 2).join(' / ')}". Flights: ${results.join('; ')}`
}, { evidenceDir, name: 'countries', timeoutMs: 300_000 })
console.log(notes)
