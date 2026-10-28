// A natural event's card: NASA satellite picture and news naming the event, not agency records.
import { runAppCheck, expect } from '../e2e/lib.mjs'
import { join } from 'node:path'

const evidenceDir = join(import.meta.dirname, 'evidence')
console.log(await runAppCheck(async (ctx) => {
  await ctx.wait(`[...document.querySelectorAll('.globe-tabs button')].some((b) => /Peaks/.test(b.textContent))`, 60_000, 'the list tabs')
  await ctx.click('.globe-tabs button', 'Peaks')
  await ctx.wait(`[...document.querySelectorAll('.globe-list li, .globe-list button')].some((el) => /Wildfire|Cyclone|Typhoon|Hurricane|Storm/.test(el.textContent))`, 240_000, 'natural events in the list')
  const notes = []
  for (const kind of ['Wildfire', 'Cyclone|Typhoon|Hurricane|Storm']) {
    const clicked = await ctx.evaluate(`(() => { const el = [...document.querySelectorAll('.globe-list li button.globe-row')].find((item) => /${kind}/.test(item.textContent)); if (!el) return ''; el.click(); return el.textContent.slice(0, 60) })()`)
    if (!clicked) { notes.push(`no ${kind}`); continue }
    await ctx.delay(9000)
    notes.push(await ctx.evaluate(`JSON.stringify({ view: !!document.querySelector('.event-view'), img: document.querySelector('.event-picture img')?.src?.slice(0, 160) ?? null, w: document.querySelector('.event-picture img')?.naturalWidth ?? null, title: document.querySelector('.globe-detail h2')?.textContent })`))
    const card = JSON.parse(await ctx.evaluate(`JSON.stringify({ buttons: [...document.querySelectorAll('.globe-actions button')].map((b) => b.textContent.trim()).filter(Boolean), news: document.querySelectorAll('.event-coverage li').length, caption: document.querySelector('.event-picture figcaption')?.textContent })`))
    expect(!card.buttons.includes('Agency report'), 'Agency report is still a main button.')
    notes.push(`${clicked.trim()}: [${card.buttons.join(', ')}], ${card.news} headlines, “${card.caption}”`)
    await ctx.shot(`natural-${kind.split('|')[0].toLowerCase()}`)
    await ctx.click('.globe-back')
    await ctx.delay(600)
  }
  return notes.join('\n')
}, { evidenceDir, name: 'natural', timeoutMs: 300_000 }))
