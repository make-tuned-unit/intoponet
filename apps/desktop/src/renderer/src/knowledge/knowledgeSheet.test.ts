import { describe, expect, it } from 'vitest'
import { wikipediaArticle } from './KnowledgeSheet'

describe('wikipediaArticle', () => {
  it('reads title and language from article URLs only', () => {
    expect(wikipediaArticle('https://en.wikipedia.org/wiki/Fall_of_the_Berlin_Wall')).toEqual({ title: 'Fall of the Berlin Wall', lang: 'en' })
    expect(wikipediaArticle('https://de.m.wikipedia.org/wiki/S%C3%A3o_Paulo')).toEqual({ title: 'São Paulo', lang: 'de' })
    expect(wikipediaArticle('https://en.wikipedia.org/wiki/Special:Random')).toBeNull()
    expect(wikipediaArticle('https://example.org/wiki/Thing')).toBeNull()
  })
})
