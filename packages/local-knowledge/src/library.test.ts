import { describe, expect, it } from 'vitest'
import { historicalFixtures, presentedAsCause, relationshipLabel } from './history'
import { absorbPage, isSensitiveUrl, parsePrivateLibrary, searchAbsorbed, serializePrivateLibrary } from './library'

describe('private library', () => {
  it('refuses banking and health pages', () => {
    expect(isSensitiveUrl('https://www.chase.com/login')).toBe(true)
    expect(isSensitiveUrl('https://clinic.example/visit')).toBe(true)
    expect(absorbPage({
      url: 'https://www.chase.com/login',
      title: 'Account',
      excerpt: 'This should not be stored on the device.',
      topic: 'Open knowledge',
    })).toEqual({ error: 'Banking, health, and account pages are not absorbed.' })
  })

  it('keeps an explicit excerpt and finds it by the citation text', () => {
    const absorbed = absorbPage({
      url: 'https://example.org/notes',
      title: 'Town notes',
      excerpt: 'The harbour record mentions the rebuilt wharf.',
      topic: 'Local archives',
      now: '2026-10-23T00:00:00.000Z',
    })
    expect('error' in absorbed).toBe(false)
    if ('error' in absorbed) return
    expect(searchAbsorbed([absorbed], 'wharf')[0]?.citationUrl).toBe('https://example.org/notes')
    const raw = serializePrivateLibrary({
      schema: 'intoponet.private-library.v1',
      bookmarks: [],
      collections: [],
      recents: [],
      absorbed: [absorbed],
    })
    expect(parsePrivateLibrary(raw)?.absorbed).toHaveLength(1)
    expect(parsePrivateLibrary('{"schema":"nope"}')).toBeNull()
  })

  it('does not present an analogy or a sequence as a cause', () => {
    const analogy = historicalFixtures.find((edge) => edge.relationship === 'analogous_to')
    const sequence = historicalFixtures.find((edge) => edge.relationship === 'preceded_by')
    const sourced = historicalFixtures.find((edge) => edge.id === 'edge-fixture-contribution')
    expect(analogy && relationshipLabel(analogy)).toBe('Analogy. Not a cause.')
    expect(sequence && presentedAsCause(sequence)).toBe(false)
    expect(sourced && presentedAsCause(sourced)).toBe(true)
    expect(relationshipLabel(sourced!)).not.toMatch(/not a cause/i)
  })
})
