// Quality sample for The Olds: random stories from the live digest (world stories, rising words,
// rising countries, and ordinary local news from random countries), each run through The Olds in a
// fresh profile. Writes what was matched for a person to judge.
//   node experiments/e2e/olds-sample.mjs out.json [count] [exclude.json]   (needs a built app; network)
//   INTOPONET_OLDS_DEBUG=scores.jsonl …   also records every candidate's score
// exclude.json: earlier samples (arrays of {title}) so a review sees new stories.
import { runAppCheck } from './lib.mjs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const out = process.argv[2] ?? 'olds-sample.json'
const count = Number(process.argv[3] ?? 10)
const excluded = new Set((process.argv[4] && existsSync(process.argv[4]) ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : []).map((item) => item.title.toLowerCase().slice(0, 40)))
const notes = await runAppCheck(async (ctx) => {
  await ctx.waitForNews()
  const digest = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getNewsDigest()`))
  const english = (h) => !h.lang || h.lang.startsWith('en')
  const pool = []
  for (const g of digest.global ?? []) pool.push({ from: `global (${g.countries.length} countries)`, title: g.title, countryCode: g.headlines.find((h) => !h.international)?.countryCode ?? null, lang: g.headlines.find((h) => h.title === g.title)?.lang ?? null })
  for (const t of digest.rising ?? []) for (const h of t.headlines.filter(english).slice(0, 1)) pool.push({ from: `rising term "${t.term}"`, title: h.title, countryCode: null, lang: h.lang })
  const risingCountries = digest.countries.filter((c) => (c.momentum ?? 0) > 0.15).sort(() => Math.random() - 0.5)
  for (const c of risingCountries.slice(0, 15)) {
    const h = c.headlines.filter(english)[Math.floor(Math.random() * 3)] ?? c.headlines.find(english)
    if (h) pool.push({ from: `rising country ${c.name} (momentum ${c.momentum.toFixed(2)})`, title: h.title, countryCode: c.countryCode, lang: h.lang })
  }
  // Ordinary local news: one headline from each of 40 random countries (any language, any subject).
  const local = []
  for (const c of [...digest.countries].sort(() => Math.random() - 0.5).slice(0, 40)) {
    const h = c.headlines[Math.floor(Math.random() * c.headlines.length)]
    if (h) local.push({ from: `local ${c.name}`, title: h.title, countryCode: c.countryCode, lang: h.lang ?? null })
  }
  // About a third trending, two thirds local.
  const trending = pool.sort(() => Math.random() - 0.5).slice(0, Math.ceil(count / 3) + 5)
  const shuffled = [...trending.slice(0, Math.ceil(count / 3)), ...local, ...trending.slice(Math.ceil(count / 3))]
  const seen = new Set(excluded)
  const picks = []
  for (const p of shuffled) {
    const key = p.title.toLowerCase().slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    picks.push(p)
    if (picks.length === count) break
  }
  const results = []
  for (const p of picks) {
    const query = { kind: 'headline', text: p.title.slice(0, 400), ...(p.countryCode ? { countryCode: p.countryCode } : {}), ...(p.lang && !p.lang.startsWith('en') ? { lang: p.lang.split('-')[0] } : {}) }
    const started = Date.now()
    try {
      const t = JSON.parse(await ctx.evaluate(`window.intoponet.olds.thread(${JSON.stringify(query)}).then((t) => JSON.stringify(t))`))
      const root = t.nodes.find((n) => n.id === t.rootId)
      results.push({
        ...p,
        ms: Date.now() - started,
        root: root && { label: root.label, description: root.description, start: root.start?.label },
        matchedBy: t.context?.matchedBy,
        candidates: (t.context?.candidates ?? []).map((c) => c.label),
        chapter: t.context?.chapter?.title ?? null,
        path: (t.context?.path ?? []).map((s) => s.label ?? s.title ?? JSON.stringify(s).slice(0, 80)),
        related: (t.context?.related ?? []).map((r) => ({ title: r.title, figures: (r.figures ?? []).slice(0, 2) })),
        chronicle: (t.chronicle ?? []).map((e) => `${e.at.label}: ${e.text}`),
        nodes: t.nodes.length,
      })
    } catch (error) {
      results.push({ ...p, error: String(error) })
    }
  }
  writeFileSync(out, JSON.stringify(results, null, 2))
  return `${results.length} stories`
}, { timeoutMs: 2_400_000 })
console.log(notes)
