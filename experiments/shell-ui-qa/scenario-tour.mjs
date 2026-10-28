// The guided tour from Settings: every step shows its part of the app, and the app is put back at the end.
import { runAppCheck, expect } from '../e2e/lib.mjs'
import { join } from 'node:path'

const evidenceDir = join(import.meta.dirname, 'evidence')
console.log(await runAppCheck(async (ctx) => {
  await ctx.waitForNews()
  await ctx.click('.settings-button')
  await ctx.wait(`!!document.querySelector('.settings-tour button')`, 10_000, 'the tour button in Settings')
  await ctx.click('.settings-tour button')
  await ctx.wait(`!!document.querySelector('.tour-card')`, 5_000, 'the tour')
  const notes = []
  for (let step = 0; step < 14; step += 1) {
    await ctx.delay(step === 0 ? 6500 : step === 4 ? 9000 : 3500)
    const info = JSON.parse(await ctx.evaluate(`JSON.stringify({ title: document.querySelector('#tour-title')?.textContent, spot: !!document.querySelector('.tour-spotlight'), count: document.querySelector('.tour-count')?.textContent })`))
    notes.push(`${info.count}: ${info.title}${info.spot ? '' : ' (no spotlight)'}`)
    await ctx.shot(`tour-${String(step + 1).padStart(2, '0')}`)
    await ctx.click('.tour-next')
  }
  await ctx.delay(1500)
  const after = JSON.parse(await ctx.evaluate(`JSON.stringify({ tour: !!document.querySelector('.tour'), olds: !!document.querySelector('.olds-sheet'), page: !!document.querySelector('.browser-actions') })`))
  expect(!after.tour && !after.olds && !after.page, `The app was not put back: ${JSON.stringify(after)}`)
  return notes.join('\n')
}, { evidenceDir, name: 'tour', timeoutMs: 400_000 }))
