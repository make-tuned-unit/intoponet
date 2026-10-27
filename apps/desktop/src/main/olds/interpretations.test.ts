import { describe, expect, it } from 'vitest'
import { interpretationsFrom } from './interpretations'

const article = `Intro text.

== Causes in Britain ==
Bob Allen has argued that high wages, cheap capital and very cheap energy in Britain made it the ideal place for the revolution. Williams argued European capital amassed from slavery was vital in the early years of the revolution. He argued that it was not only for economic reasons at all, in any reading.

== Geography ==
Joel Mokyr argued about the rivers of England and their importance for trade over centuries.

== Historiography ==
However, Schroeder argues that all of that was not the main cause of the war in 1914 at all. The majority of Barelvis supported the creation of Pakistan and believed that co-operation would fail.`

describe('interpretations', () => {
  it('keeps attributed views from debate sections only, skipping pronouns and false subjects', () => {
    const found = interpretationsFrom(article, { title: 'X', url: 'https://en.wikipedia.org/wiki/X' })
    expect(found.map((item) => item.who)).toEqual(['Bob Allen', 'Williams', 'Schroeder'])
    expect(found[0]).toMatchObject({ section: 'Causes in Britain', url: 'https://en.wikipedia.org/wiki/X#Causes_in_Britain' })
  })
  it('does not present a single view as a debate', () => {
    expect(interpretationsFrom('== Legacy ==\nBob Allen has argued that cheap energy in Britain made it the ideal place for the revolution.', { title: 'X', url: 'u' })).toEqual([])
  })
})
