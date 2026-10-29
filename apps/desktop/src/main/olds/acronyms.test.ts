import { describe, expect, it } from 'vitest'
import { expansionFromSnippets } from './acronyms'

describe('sourced acronym expansion', () => {
  it('uses an explicit expansion despite search highlighting', () => {
    expect(expansionFromSnippets('BUEI', [{ title: 'Peter Benchley', snippet: 'founding board members of the Bermuda Underwater Exploration Institute (<span class="searchmatch">BUEI</span>).' }]))
      .toEqual({ name: 'Bermuda Underwater Exploration Institute', source: 'Peter Benchley' })
  })
  it('does not mistake an unrelated article title or a partial word for an expansion', () => {
    expect(expansionFromSnippets('BUEI', [{ title: 'Bueil', snippet: 'Bueil is a French commune.' }])).toBeNull()
    expect(expansionFromSnippets('BUEI', [{ title: 'Bermuda', snippet: 'Bermuda Underwater Exploration Institute' }])).toBeNull()
    expect(expansionFromSnippets('BUEI', [{ title: 'Wrong', snippet: 'British Museum (BUEI)' }])).toBeNull()
  })
  it('refuses conflicting expansions and handles connector words', () => {
    expect(expansionFromSnippets('ABC', [
      { title: 'One', snippet: 'American Broadcasting Company (ABC)' },
      { title: 'Two', snippet: 'Australian Broadcasting Corporation (ABC)' },
    ])).toBeNull()
    expect(expansionFromSnippets('ABC', [{ title: 'One', snippet: 'Association of British Colleges (ABC)' }])?.name).toBe('Association of British Colleges')
  })
})
