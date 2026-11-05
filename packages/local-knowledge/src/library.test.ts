import { describe, expect, it } from 'vitest'
import { historicalFixtures, presentedAsCause, relationshipLabel } from './history'
import { absorbPage, isSensitiveUrl, mergePrivateLibraries, parsePrivateLibrary, searchAbsorbed, serializePrivateLibrary } from './library'

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

describe('tags and import', () => {
  const doc = (part: Partial<import('./library').PrivateLibraryDocument>) => ({ schema: 'intoponet.private-library.v1' as const, bookmarks: [], collections: [], recents: [], absorbed: [], ...part })
  it('cleans tags and keeps them through a save', async () => {
    const { cleanTags, parsePrivateLibrary, serializePrivateLibrary } = await import('./library')
    expect(cleanTags(['  Pacific ', 'pacific', 'Water', '', 3, 'x'.repeat(60)], 'water')).toEqual(['Pacific', 'x'.repeat(40)])
    const saved = parsePrivateLibrary(serializePrivateLibrary(doc({ bookmarks: [{ url: 'https://a.test/', title: 'A', topic: 'Water', savedAt: '2026-01-01', tags: ['Pacific', 'Water'] }] })))
    expect(saved?.bookmarks[0]?.tags).toEqual(['Pacific'])
  })
  it('merges an import without losing what you have', async () => {
    const { mergePrivateLibraries } = await import('./library')
    const mine = doc({
      bookmarks: [{ url: 'https://a.test/', title: 'Mine', topic: 'Water', savedAt: '2026-01-01', note: 'my note' }],
      collections: [{ id: 'c1', label: 'Pacific', createdAt: '2026-01-01', memberUrls: ['https://a.test/'] }],
      recents: [{ url: 'https://r1.test/', title: 'R1', visitedAt: '2026-02-01' }],
    })
    const theirs = doc({
      bookmarks: [
        { url: 'https://a.test/', title: 'Theirs', topic: 'Climate', savedAt: '2025-01-01', note: 'their note', fieldAnchor: { lat: 1, lon: 2, label: 'Fiji' } },
        { url: 'https://b.test/', title: 'B', topic: 'Energy', savedAt: '2025-01-01' },
      ],
      collections: [{ id: 'other', label: 'pacific ', createdAt: '2025-01-01', memberUrls: ['https://b.test/'] }, { id: 'c9', label: 'New', createdAt: '2025-01-01', memberUrls: [] }],
      recents: [{ url: 'https://r2.test/', title: 'R2', visitedAt: '2026-03-01' }, { url: 'https://r1.test/', title: 'R1', visitedAt: '2026-01-01' }],
    })
    const { library, added } = mergePrivateLibraries(mine, theirs)
    expect(library.bookmarks[0]).toMatchObject({ title: 'Mine', note: 'my note', tags: ['Climate'], fieldAnchor: { label: 'Fiji' } })
    expect(library.bookmarks).toHaveLength(2)
    expect(library.collections.find((c) => c.id === 'c1')?.memberUrls).toEqual(['https://a.test/', 'https://b.test/'])
    expect(library.recents.map((r) => r.url)).toEqual(['https://r2.test/', 'https://r1.test/'])
    expect(added).toEqual({ bookmarks: 1, collections: 1, recents: 1, absorbed: 0 })
  })
})

describe('Bookmarks linked to a saved PDF', () => {
  const base = { schema: 'intoponet.private-library.v1', collections: [], recents: [], absorbed: [] }
  const bookmark = { url: 'https://example.com/a', title: 'A', topic: 'T', savedAt: '2026-11-05T00:00:00Z' }
  it('keeps a link to an absolute .pdf path, and drops anything else', () => {
    const parse = (pdf: unknown) => parsePrivateLibrary(JSON.stringify({ ...base, bookmarks: [{ ...bookmark, pdf }] }))?.bookmarks[0]?.pdf
    expect(parse({ path: '/Users/me/Downloads/A.pdf', savedAt: '2026-11-05T00:00:00Z' })).toEqual({ path: '/Users/me/Downloads/A.pdf', savedAt: '2026-11-05T00:00:00Z' })
    expect(parse({ path: 'relative/A.pdf', savedAt: 'x' })).toBeUndefined()
    expect(parse({ path: '/Applications/Evil.app', savedAt: 'x' })).toBeUndefined()
    expect(parse('nope')).toBeUndefined()
  })
  it('keeps the link when another library is merged in', () => {
    const mine = parsePrivateLibrary(JSON.stringify({ ...base, bookmarks: [bookmark] }))!
    const theirs = parsePrivateLibrary(JSON.stringify({ ...base, bookmarks: [{ ...bookmark, pdf: { path: '/tmp/A.pdf', savedAt: 'x' } }] }))!
    expect(mergePrivateLibraries(mine, theirs).library.bookmarks[0]?.pdf?.path).toBe('/tmp/A.pdf')
  })
})
