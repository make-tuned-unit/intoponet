// Run The Olds on given headline queries in a fresh profile and print what each matched.
//   node experiments/e2e/olds-query.mjs queries.json   (needs a built app; network)
// queries.json: [{ "text": "…", "countryCode": "CZ", "lang": "cs", "place": "Zlín", "geonameId": "3061370" }, …]
import { runAppCheck } from './lib.mjs'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const queries = JSON.parse(readFileSync(process.argv[2], 'utf8'))
// Each run judges the current code: drop The Olds' cache from a kept profile.
if (process.env.E2E_PROFILE) rmSync(join(process.env.E2E_PROFILE, 'olds-cache'), { recursive: true, force: true })
const notes = await runAppCheck(async (ctx) => {
  const lines = []
  for (const q of queries) {
    const query = { kind: 'headline', ...q }
    const started = Date.now()
    try {
      const t = JSON.parse(await ctx.evaluate(`window.intoponet.olds.thread(${JSON.stringify(query)}).then((t) => JSON.stringify(t))`))
      const root = t.nodes.find((n) => n.id === t.rootId)
      lines.push(`${q.text.slice(0, 80)}\n   → ${root?.label} | ${(t.context?.matchedBy ?? '').slice(0, 70)} | ${Math.round((Date.now() - started) / 1000)} s`)
    } catch (error) {
      lines.push(`${q.text.slice(0, 80)}\n   ERROR ${String(error).slice(-80)}`)
    }
  }
  return lines.join('\n')
}, { timeoutMs: 1_800_000 })
console.log(notes)
