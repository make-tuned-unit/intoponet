// Quality sample for The Olds on local news: headlines from city and regional outlets around the
// world, and stories spreading between places, each run through The Olds in a fresh profile.
// Writes what was matched for a person to judge.
//   node experiments/e2e/olds-local-sample.mjs out.json [count] [exclude.json]   (needs a built app; network)
//   INTOPONET_OLDS_DEBUG=scores.jsonl …   also records every candidate's score
// exclude.json: earlier samples (arrays of {title}) so a review sees new stories.
import { runAppCheck } from './lib.mjs'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2] ?? 'olds-sample.json'
const count = Number(process.argv[3] ?? 10)
const excluded = new Set((process.argv[4] && existsSync(process.argv[4]) ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : []).map((item) => item.title.toLowerCase().slice(0, 40)))
// OLDS_LANGS=es,fr,pt …: install these translation models first (with E2E_PROFILE they persist between runs).
const langs = (process.env.OLDS_LANGS ?? '').split(',').map((code) => code.trim()).filter(Boolean)
// Each run judges the current code: drop The Olds' cache from a kept profile.
if (process.env.E2E_PROFILE) rmSync(join(process.env.E2E_PROFILE, 'olds-cache'), { recursive: true, force: true })
const notes = await runAppCheck(async (ctx) => {
  for (const code of langs) {
    await ctx.evaluate(`window.intoponet.translate.install(${JSON.stringify(code)}).then(() => true, () => false)`)
  }
  if (langs.length) console.log('Installed:', await ctx.evaluate(`window.intoponet.translate.status().then((s) => s.languages.filter((l) => l.downloaded).map((l) => l.code).join(','))`))
  await ctx.waitForNews()
  // Thousands of local feeds take several minutes to arrive after the first national ones.
  await ctx.delay(Number(process.env.OLDS_LOCAL_WAIT_MS ?? 420_000))
  const digest = JSON.parse(await ctx.evaluate(`window.intoponet.browserHost.getNewsDigest()`))
  // Local stories only: headlines from city and regional outlets, and stories spreading between places.
  const pool = []
  for (const s of (digest.spreading ?? [])) pool.push({ from: `spreading from ${s.origin.name} (${s.pickups.length} places)`, title: s.title, countryCode: s.origin.countryCode, place: s.origin.name, geonameId: s.origin.id.match(/^city:(\d+)$/)?.[1] ?? null, lang: s.headlines.find((h) => h.title === s.title)?.lang ?? null })
  const places = [...digest.places].filter((p) => p.evidence !== 'named-in-headline').sort(() => Math.random() - 0.5)
  // Spread across countries: at most two places per country.
  const perCountry = new Map()
  for (const p of places) {
    if ((perCountry.get(p.countryCode) ?? 0) >= 2) continue
    // OLDS_LOCAL_LANG=en: only headlines in that language (undeclared counts as English).
    const wanted = process.env.OLDS_LOCAL_LANG
    const usable = wanted ? p.headlines.filter((item) => (item.lang ?? 'en').startsWith(wanted)) : p.headlines
    const h = usable[Math.floor(Math.random() * Math.min(4, usable.length))]
    if (!h) continue
    perCountry.set(p.countryCode, (perCountry.get(p.countryCode) ?? 0) + 1)
    pool.push({ from: `local ${p.name}, ${p.countryCode}`, title: h.title, countryCode: p.countryCode, place: p.name, geonameId: p.id.match(/^city:(\d+)$/)?.[1] ?? null, lang: h.lang ?? null })
  }
  const spreadCount = Math.min(digest.spreading?.length ?? 0, Math.ceil(count / 4))
  const shuffled = [...pool.slice(0, spreadCount), ...pool.slice(digest.spreading?.length ?? 0)]
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
    const query = { kind: 'headline', text: p.title.slice(0, 400), ...(p.countryCode ? { countryCode: p.countryCode } : {}), ...(p.lang && !p.lang.startsWith('en') ? { lang: p.lang.split('-')[0] } : {}), ...(p.place ? { place: p.place } : {}), ...(p.geonameId ? { geonameId: p.geonameId } : {}) }
    const started = Date.now()
    try {
      // One slow story must not sink the run: two minutes each.
      const t = JSON.parse(await Promise.race([
        ctx.evaluate(`window.intoponet.olds.thread(${JSON.stringify(query)}).then((t) => JSON.stringify(t))`),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Story took longer than 120 s')), 120_000)),
      ]))
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
    // Written after every story, so a run cut short still leaves its results.
    writeFileSync(out, JSON.stringify(results, null, 2))
  }
  writeFileSync(out, JSON.stringify(results, null, 2))
  return `${results.length} stories`
}, { timeoutMs: 2_400_000 })
console.log(notes)
