import { describe, expect, it } from 'vitest'
import { historicalFixtures, presentedAsCause, relationshipLabel } from './history'
import { absorbPage, isSensitiveUrl, parsePrivateLibrary, searchAbsorbed, serializePrivateLibrary } from './library'

describe('private library', () => {
  it('round-trips explicit bookmark field anchors while accepting legacy bookmarks', () => {
    const raw = JSON.stringify({
      schema: 'intoponet.private-library.v1',
      bookmarks: [
        { url: 'https://legacy.example/', title: 'Legacy', topic: 'History', savedAt: '2026-01-01' },
        {
          url: 'https://anchored.example/', title: 'Anchored', topic: 'History', savedAt: '2026-01-02',
          fieldAnchor: { lat: 64.1466, lon: -21.9426, label: ' Reykjavík ' },
        },
      ],
      collections: [],
      recents: [],
      absorbed: [],
    })
    const parsed = parsePrivateLibrary(raw)
    expect(parsed?.bookmarks).toEqual([
      { url: 'https://legacy.example/', title: 'Legacy', topic: 'History', savedAt: '2026-01-01' },
      {
        url: 'https://anchored.example/', title: 'Anchored', topic: 'History', savedAt: '2026-01-02',
        fieldAnchor: { lat: 64.1466, lon: -21.9426, label: 'Reykjavík' },
      },
    ])
    const roundTripped = parsePrivateLibrary(serializePrivateLibrary(parsed!))
    expect(roundTripped?.bookmarks).toEqual(parsed?.bookmarks)
  })

  it('rejects malformed optional bookmark anchors but retains valid older records', () => {
    const invalidAnchors = [
      { lat: Number.NaN, lon: 0, label: 'Invalid latitude' },
      { lat: 0, lon: Number.POSITIVE_INFINITY, label: 'Invalid longitude' },
      { lat: -91, lon: 0, label: 'Out of range' },
      { lat: 0, lon: 181, label: 'Out of range' },
      { lat: 0, lon: 0, label: 'x'.repeat(161) },
      { lat: 0, lon: 0, label: '   ' },
      null,
      { lat: 0, lon: 0 },
    ]
    const parsed = parsePrivateLibrary(JSON.stringify({
      schema: 'intoponet.private-library.v1',
      bookmarks: [
        { url: 'https://legacy.example/', title: 'Legacy', topic: 'History', savedAt: '2026-01-01' },
        ...invalidAnchors.map((fieldAnchor, index) => ({
          url: `https://invalid${index}.example/`, title: 'Invalid', topic: 'History', savedAt: '2026-01-01', fieldAnchor,
        })),
      ],
      collections: [],
      recents: [],
      absorbed: [],
    }))
    expect(parsed?.bookmarks).toEqual([
      { url: 'https://legacy.example/', title: 'Legacy', topic: 'History', savedAt: '2026-01-01' },
    ])
  })

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
