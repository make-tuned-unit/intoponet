// Scores The Olds against hand-labelled live headlines (olds-gold.json): the share whose topic is an
// acceptable one. Run with Laya off and on to compare.
//   node experiments/e2e/olds-eval.mjs out.json            (needs a built app; network)
//   LAYA=1 node experiments/e2e/olds-eval.mjs out.json     (turns Laya on first; downloads its model once)
//   E2E_PROFILE=<dir> keeps the profile (installed languages, Laya model) between runs.
//   ONLY=<regex> scores only the stories whose title matches (for tracing a few misses).
import { runAppCheck } from './lib.mjs'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'olds-eval.json'
const gold = JSON.parse(readFileSync(join(import.meta.dirname, 'olds-gold.json'), 'utf8')).stories
  .filter((story) => !process.env.ONLY || new RegExp(process.env.ONLY).test(story.title))
const laya = process.env.LAYA === '1'
if (process.env.E2E_PROFILE) rmSync(join(process.env.E2E_PROFILE, 'olds-cache'), { recursive: true, force: true })

const summary = await runAppCheck(async (ctx) => {
  const status = await ctx.evaluate(laya
    ? `window.intoponet.laya.enable().then((s) => JSON.stringify(s), (e) => 'ERR ' + e.message)`
    : `window.intoponet.laya.status().then((s) => s.enabled ? window.intoponet.laya.disable({ deleteModel: false }) : s).then((s) => JSON.stringify(s))`)
  if (laya) await ctx.wait(`window.intoponet.laya.status().then((s) => s.enabled && s.model.downloaded && !s.busy)`, 900_000, 'Laya to be ready')
  const results = []
  for (const story of gold) {
    const query = { kind: 'headline', text: story.title.slice(0, 400), ...(story.countryCode ? { countryCode: story.countryCode } : {}), ...(story.lang && !story.lang.startsWith('en') ? { lang: story.lang.split('-')[0] } : {}) }
    const started = Date.now()
    try {
      const t = JSON.parse(await ctx.evaluate(`window.intoponet.olds.thread(${JSON.stringify(query)}).then((t) => JSON.stringify({ root: t.nodes.find((n) => n.id === t.rootId)?.label ?? '', events: (t.chronicle ?? []).length, matchedBy: t.context?.matchedBy ?? '', filed: t.context?.filedUnder?.threads ?? [] }))`))
      results.push({ title: story.title, accept: story.accept, ...t, ok: new RegExp(story.accept).test(t.root), ms: Date.now() - started })
    } catch (error) {
      results.push({ title: story.title, accept: story.accept, root: '', error: String(error).slice(-120), ok: false, ms: Date.now() - started })
    }
  }
  writeFileSync(out, JSON.stringify({ laya, status: status.slice(0, 300), results }, null, 1))
  const passed = results.filter((r) => r.ok).length
  const events = Math.round(results.reduce((sum, r) => sum + (r.events ?? 0), 0) / results.length * 10) / 10
  const seconds = Math.round(results.reduce((sum, r) => sum + r.ms, 0) / results.length / 100) / 10
  return `Laya ${laya ? 'on' : 'off'}: ${passed}/${results.length} acceptable topics; ${events} dated events on average; ${seconds} s per story.\n` + results.filter((r) => !r.ok).map((r) => `  ✗ ${r.title.slice(0, 70)} → ${r.root || r.error}`).join('\n')
}, { timeoutMs: 3_600_000 })
console.log(summary)
