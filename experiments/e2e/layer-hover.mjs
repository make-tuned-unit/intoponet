// Built-app check: compact layer toggles remain clickable during the 1 s hover delay.
import { expect, runAppCheck } from './lib.mjs'

console.log(await runAppCheck(async (ctx) => {
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 100 })
  await ctx.wait(`!!document.querySelector('.globe-layers.is-compact .globe-compact-icon')`)
  const point = await ctx.evaluate(`(() => { const b = document.querySelector('.globe-compact-icon'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, pressed: b.getAttribute('aria-pressed') }; })()`)
  const compact = () => ctx.evaluate(`!!document.querySelector('.globe-layers.is-compact')`)
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await ctx.delay(100)
  await ctx.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await ctx.delay(100)
  expect(await compact(), 'Click focus expanded the controls before one second.')
  expect(await ctx.evaluate(`document.querySelector('.globe-compact-icon').getAttribute('aria-pressed')`) !== point.pressed, 'The compact layer did not toggle immediately.')
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 100 })
  await ctx.delay(1100)
  expect(await compact(), 'Leaving the controls did not cancel pending expansion.')
  await ctx.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await ctx.delay(700)
  expect(await compact(), 'Controls expanded before the one-second delay.')
  await ctx.delay(450)
  expect(!(await compact()), 'Controls did not expand after a sustained one-second hover.')
  await ctx.shot('expanded')
  return 'PASS: immediate layer toggle; no click-triggered expansion; hover cancelled on leave; expansion after 1 s.'
}, { evidenceDir: 'experiments/e2e/evidence/layer-hover', name: 'layers' }))
