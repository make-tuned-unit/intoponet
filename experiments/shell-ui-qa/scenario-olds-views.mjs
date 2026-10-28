// The Olds' three views show the same story: Story, Timeline (dated events on the axis) and List.
import { runAppCheck, expect } from '../e2e/lib.mjs'
import { join } from 'node:path'

const evidenceDir = join(import.meta.dirname, 'evidence')
console.log(await runAppCheck(async (ctx) => {
  await ctx.evaluate(`window.__oldsTest = window.intoponet.olds.thread({ kind: 'headline', text: 'Flavio Bolsonaro lands in Miami with his family after Trump offers Brazil exit', countryCode: 'BR' }); true`)
  // Open it through the UI: the launcher's Olds button with a headline isn't scriptable, so use the World list.
  await ctx.waitForNews()
  await ctx.click('.globe-tabs button', 'World')
  await ctx.wait(`document.querySelectorAll('.world-list > li').length >= 3`, 90_000, 'world stories')
  await ctx.evaluate(`document.querySelector('.world-list > li .world-row').click(); true`)
  await ctx.delay(800)
  await ctx.click('.globe-history-button', 'The history behind it')
  await ctx.wait(`!!document.querySelector('.olds-story, .olds-timeline')`, 120_000, 'The Olds')
  const notes = []
  for (const view of ['Timeline', 'List']) {
    await ctx.click('.olds-views button, [role="radio"]', view)
    await ctx.delay(1200)
    const count = await ctx.evaluate(view === 'Timeline' ? `document.querySelectorAll('.olds-timeline > li').length` : `document.querySelectorAll('.olds-list li').length`)
    notes.push(`${view}: ${count} items`)
    expect(count > 1, `${view} view is empty.`)
    await ctx.shot(`olds-${view.toLowerCase()}`)
  }
  return notes.join('; ')
}, { evidenceDir, name: 'views', timeoutMs: 400_000 }))
