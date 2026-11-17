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
  // What The Olds showed for live headlines on 2026-11-16 (the audit of 44), and what it may show instead.
  ['Asesinan a un periodista', 'Journalists of La Nación v. Costa Rica', 'Costa Rica'],
  ['Asesinan a un periodista', 'President of Costa Rica', 'Crime in Costa Rica'],
  ['Falha técnica afeta', 'United States Secret Service', 'United States'],
  ['Australian-funded fence', 'Crime in Australia', 'Gizo, Solomon Islands'],
  ['Central business chambers', 'SOS incident', 'Trinidad and Tobago'],
  ['RUTA MAVE', 'Above the Law (group)', 'Cook Islands'],
  ['World Bank weighs', 'West Bank', 'Somalia'],
  ['Singapore’s non-oil exports', 'Energy in Singapore', 'Singapore'],
  ['Conférence épiscopale Burkina-Niger', 'Niger River', 'Niger'],
  ['Flash info', 'Prime Minister of France', 'Central African Republic'],
  ['UEFA backs France’s Diallo', 'Abdou Diallo', 'FIFA'],
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
