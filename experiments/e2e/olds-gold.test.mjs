import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const { stories } = JSON.parse(readFileSync(new URL('./olds-gold.json', import.meta.url), 'utf8'))

// These are actual wrong selections from the 2026-10-28 comparison, previously counted as passes.
const cases = [
  ['FNB launches', 'FNB Stadium', 'Eswatini'],
  ['Round 8 of', '2026 European Motocross Championship', 'Motocross'],
  ['Lluvias en Perú', 'Peru–United Kingdom relations', 'Climate of Peru'],
  ['NOCZ unveils', 'Zambia at the 2026 Commonwealth Games', '2026 Summer Youth Olympics'],
  ['APNU+AFC', 'Guyana–United Kingdom relations', 'ExxonMobil'],
  ['Bernardo on saying', 'Canada–Philippines relations', 'Jinggoy Estrada'],
  ['Bernardo on saying', 'Bernardo Bernardo', 'Philippines'],
]

for (const [prefix, wrong, acceptable] of cases) {
  test(`${prefix}: rejects ${wrong}`, () => {
    const story = stories.find((story) => story.title.startsWith(prefix))
    assert.ok(story, `Missing labelled headline: ${prefix}`)
    const accept = new RegExp(story.accept)
    assert.equal(accept.test(wrong), false)
    assert.equal(accept.test(acceptable), true)
  })
}
