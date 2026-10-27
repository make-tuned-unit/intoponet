// Accessibility audit with axe-core across the main screens (renderer only).
import { readFileSync, writeFileSync } from 'node:fs'
export default async function ({ evaluate, delay }) {
  const axe = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8')
  await delay(5000)
  await evaluate(`${axe}; true`)
  const report = {}
  const run = async (name) => {
    const raw = JSON.parse(await evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations))`))
    const result = raw.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary || '').split('\n')[1] ?? ''} :: ${n.html.slice(0, 120)}`) }))
    report[name] = result
    console.log(`\n== ${name}: ${result.length} rules`)
    for (const v of result) console.log(`  [${v.impact}] ${v.id} ×${v.nodes} — ${v.help}\n     ${v.targets.slice(0, 2).join('\n     ')}`)
  }
  const click = (sel, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => (b.innerText || b.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})); el?.click(); return !!el })()`)
  await run('home')
  await click('.bookmark-library-button', 'Bookmarks'); await delay(1200); await run('bookmarks')
  await click('.bookmark-library-button', 'My map'); await delay(1000); await run('my map')
  await click('.drawer-tabs button', 'Privacy'); await delay(600); await run('privacy')
  await click('.bookmark-library-button', 'Settings'); await delay(1000); await run('settings')
  await click('.bookmark-library-button', 'Knowledge'); await delay(1200); await run('knowledge')
  await click('.bookmark-library-button', 'The Olds'); await delay(6000); await run('olds')
  await evaluate(`document.querySelector('[aria-label="Close The Olds"]')?.click(); true`)
  await delay(800)
  await evaluate(`[...document.querySelectorAll('.globe-row')][0]?.click(); true`)
  await delay(3000); await run('country')
  writeFileSync(process.env.A11Y_OUT, JSON.stringify(report, null, 2))
}
