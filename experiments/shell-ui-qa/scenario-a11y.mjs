// Accessibility audit with axe-core across the main screens (renderer only).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export default async function ({ evaluate, delay, send }) {
  const axe = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8')
  await delay(5000)
  await evaluate(`${axe}; true`)
  const axeVersion = await evaluate('axe.version')
  const report = {}
  const keyboard = []
  let runtimeEvidence = null
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
  const waitFor = async (description, predicate, timeout = 12000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await evaluate(predicate)) return
      await delay(250)
    }
    const focus = await evaluate('({ tag: document.activeElement?.tagName, className: document.activeElement?.className, ariaLabel: document.activeElement?.getAttribute("aria-label"), dataPanel: document.activeElement?.getAttribute("data-panel") })')
    throw new Error(`Accessibility scenario could not open ${description}; active element: ${JSON.stringify(focus)}.`)
  }
  const click = async (selector, description, predicate) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ${selector}'); el.focus({ preventScroll: true }); el.click(); return true })()`)
    await waitFor(description, predicate)
  }
  const clickTab = async (label, description, predicate) => {
    await evaluate(`(() => { const el = [...document.querySelectorAll('[role="tab"]')].find((item) => (item.innerText || '').trim() === ${JSON.stringify(label)}); if (!el) throw new Error('missing tab ${label}'); el.focus({ preventScroll: true }); el.click(); return true })()`)
    await waitFor(description, predicate)
  }
  const press = async (key, code, virtualKey) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}), windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey })
  }
  const run = async (name, predicate, selector) => {
    await waitFor(name, predicate)
    const raw = JSON.parse(await evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(tags)} }, resultTypes: ['violations'] }).then((r) => JSON.stringify(r.violations))`))
    const result = raw.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary || '').split('\n')[1] ?? ''} :: ${n.html.slice(0, 120)}`) }))
    report[name] = { screenSelector: selector, tags, violations: result }
    console.log(`\n== ${name}: ${result.length} rules`)
    for (const v of result) console.log(`  [${v.impact}] ${v.id} ×${v.nodes} — ${v.help}\n     ${v.targets.slice(0, 2).join('\n     ')}`)
  }
  const home = 'Boolean(document.querySelector(".app-shell") && !document.querySelector(".bookmark-pane, .bookmark-drawer, .settings-drawer, .knowledge-sheet, .olds-sheet"))'
  const bookmarks = 'Boolean(document.querySelector(".bookmark-pane"))'
  const myMap = 'Boolean([...document.querySelectorAll(".bookmark-drawer h2")].some((el) => el.innerText.trim() === "My map"))'
  const privacy = 'Boolean([...document.querySelectorAll(".bookmark-drawer h2")].some((el) => el.innerText.trim() === "Privacy") && [...document.querySelectorAll("[role=tab]")].some((el) => el.innerText.trim() === "Privacy" && el.getAttribute("aria-selected") === "true"))'
  const settings = 'Boolean(document.querySelector(".settings-drawer #settings-heading"))'
  const knowledge = 'Boolean(document.querySelector(".knowledge-sheet[role=dialog]"))'
  const olds = `Boolean(document.querySelector('.olds-sheet[aria-label^="The Olds:"]'))`
  const country = `Boolean(document.querySelector(".globe-header h1")?.innerText.trim() === "Japan" && document.querySelector('.globe-panel[aria-label="Near Japan"]'))`

  await run('home', home, '.app-shell')
  runtimeEvidence = await evaluate(`({ eyebrow: document.querySelector('.globe-eyebrow')?.innerText.trim() ?? '', summary: document.querySelector('.globe-summary')?.innerText.trim() ?? '' })`)
  if (runtimeEvidence.eyebrow === 'No public snapshot yet' && runtimeEvidence.summary.includes('public signals') && !/public signals across \d+ active layers\./.test(runtimeEvidence.summary)) {
    throw new Error(`Public signal count does not name active layers: ${runtimeEvidence.summary}`)
  }
  await click('[data-panel="bookmarks"]', 'Bookmarks', bookmarks); await run('bookmarks', bookmarks, '.bookmark-pane')
  await click('[data-panel="library"]', 'My map', myMap); await run('my map', myMap, '.bookmark-drawer h2: My map')
  await clickTab('Privacy', 'Privacy', privacy); await run('privacy', privacy, '.bookmark-drawer h2: Privacy')
  await click('[data-panel="settings"]', 'Settings', settings); await run('settings', settings, '.settings-drawer')
  await press('Escape', 'Escape', 27)
  await waitFor('Settings to close and return focus', 'Boolean(!document.querySelector(".settings-drawer") && document.activeElement?.matches("[data-panel=\\"settings\\"]"))')
  keyboard.push({ screen: 'settings', openMethod: 'pointer', closeKey: 'Escape', focusReturned: true })
  await press('Enter', 'Enter', 13)
  await waitFor('Settings to reopen from keyboard', settings)
  await press('Escape', 'Escape', 27)
  await waitFor('keyboard-opened Settings to close and return focus', 'Boolean(!document.querySelector(".settings-drawer") && document.activeElement?.matches("[data-panel=\\"settings\\"]"))')
  keyboard.push({ screen: 'settings', openMethod: 'Enter', closeKey: 'Escape', focusReturned: true })
  await click('[data-panel="knowledge"]', 'Knowledge', knowledge); await run('knowledge', knowledge, '.knowledge-sheet[role="dialog"]')
  await click('[data-panel="olds"]', 'The Olds', olds); await delay(4500); await run('olds', olds, '.olds-sheet')
  await waitFor('focus to move into The Olds', 'Boolean(document.activeElement?.closest(".olds-sheet"))')
  await press('Escape', 'Escape', 27)
  await waitFor('The Olds to close and return focus', 'Boolean(!document.querySelector(".olds-sheet") && document.activeElement?.matches("[data-panel=\\"olds\\"]"))')
  keyboard.push({ screen: 'The Olds', openMethod: 'pointer', closeKey: 'Escape', focusMovedIntoPanel: true, focusReturned: true })
  await evaluate(`(() => { const input = document.querySelector('.command-input input'); if (!input) throw new Error('missing place search'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Japan'); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await waitFor('Japan place suggestion', 'Boolean([...document.querySelectorAll("#place-suggestions [role=option]")].some((el) => el.innerText.includes("Fly to Japan")))')
  await evaluate(`(() => { const option = [...document.querySelectorAll('#place-suggestions [role="option"]')].find((el) => el.innerText.includes('Fly to Japan')); if (!option) throw new Error('missing Japan suggestion'); option.click(); return true })()`)
  await run('country', country, '.globe-panel[aria-label="Near Japan"]')

  const output = resolve(process.env.A11Y_OUT ?? new URL('./results/a11y-latest.json', import.meta.url).pathname)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), build: 'built desktop app via CDP', axeVersion, tags, runtimeEvidence, screens: report, keyboard }, null, 2))
  console.log(`\nWrote ${output}`)
}
