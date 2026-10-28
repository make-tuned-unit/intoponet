// At a city or country, Rising and Fading show what is changing in its own news.
import { runAppCheck } from '../e2e/lib.mjs'
import { join } from 'node:path'

const evidenceDir = join(import.meta.dirname, 'evidence')
console.log(await runAppCheck(async (ctx) => {
  await ctx.waitForNews()
  await ctx.delay(4000)
  const notes = []
  for (const place of ['Goma', 'New York City', 'Rome', 'Brazil']) {
    await ctx.press('Escape')
    await ctx.flyTo(place)
    await ctx.delay(2500)
    for (const tab of ['Rising', 'Fading']) {
      await ctx.click('.globe-tabs button', tab)
      await ctx.wait(`!!document.querySelector('.place-trends') && !document.querySelector('.place-trends')?.textContent.includes('Comparing')`, 20_000, 'place trends')
      const info = await ctx.evaluate(`(() => { const s = document.querySelector('.place-trends'); return s.querySelector('h3')?.textContent + ' | ' + (s.querySelector('.place-trends-note')?.textContent ?? '') + ' | ' + [...s.querySelectorAll('.place-trend-term')].slice(0, 6).map((t) => t.textContent).join(', ') })()`)
      notes.push(info)
      if (place === 'Goma' || place === 'Rome') await ctx.shot(`trends-${place.toLowerCase()}-${tab.toLowerCase()}`)
    }
  }
  return notes.join('\n')
}, { evidenceDir, name: 'trends', timeoutMs: 400_000 }))
