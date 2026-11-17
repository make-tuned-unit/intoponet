import { describe, expect, it } from 'vitest'

// Live audit, 16 November 2026: five of the six "views" shown for the Russian Revolution were not views anyone holds.
describe('who holds a view (2026-11-16 audit)', () => {
  it('does not attribute a sentence to a school named as a noun, an event or a state', async () => {
    const { interpretationsFrom } = await import('./interpretations')
    const text = `Lead.

== Historiography ==
The historiography of the Revolution generally divides into three schools of thought: the Soviet-Marxist (Marxist-Leninist) view, the Western 'totalitarian' view, and the 'revisionist' view. Since the Revolutions of 1989 and the dissolution of the Soviet Union in 1991, the Western-Totalitarian view has again become dominant and the Soviet-Marxist view has practically vanished in mainstream political analysis. The schism between Trotsky and Stalin is the focal point where the Revisionist view comes into existence. By 1923 the Bolsheviks had controlled the last of the White Army holdouts and the Russian Civil War concluded with a Bolshevik victory. This victory ultimately influenced how the Soviet Union interpreted its own ideology and the October Revolution itself. Tony Cliff argued the Bolshevik–Left Socialist Revolutionary coalition government dissolved the Constituent Assembly due to a number of reasons. Richard Pipes concluded that the October seizure of power was a coup carried out by a small minority.
`
    const found = interpretationsFrom(text, { title: 'Russian Revolution', url: 'https://en.wikipedia.org/wiki/Russian_Revolution' })
    expect(found.map((item) => item.who)).toEqual(['Tony Cliff', 'Richard Pipes'])
  })

  it('still reads a school that views something a certain way', async () => {
    const { interpretationsFrom } = await import('./interpretations')
    const text = `Lead.

== Debate ==
Revisionist historians view the reforms as a continuation of earlier policy rather than a break with it. Marxist scholars viewed it as the decisive moment of the whole period under discussion here.
`
    expect(interpretationsFrom(text, { title: 'X', url: 'https://en.wikipedia.org/wiki/X' }).map((item) => item.who)).toEqual(['Revisionist historians', 'Marxist scholars'])
  })
})
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
