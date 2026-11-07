import { describe, expect, it } from 'vitest'
import { keepPairsWhole, suggestGroups, tidyCandidates, tidyText, TIDY_MAX_GROUPS, TIDY_SIMILARITY, type TidyTab } from './tabTidy'

const vector = (...values: number[]) => new Float32Array(values)

describe('tidyCandidates', () => {
  it('keeps loose web tabs only: no pinned, foldered, private, start-page or non-web tabs', () => {
    const tabs: TidyTab[] = [
      { id: 'loose', url: 'https://cooking.example/pasta', title: 'Pasta' },
      { id: 'pinned', url: 'https://cooking.example/a', title: 'Pinned', pinned: true },
      { id: 'foldered', url: 'https://cooking.example/b', title: 'Foldered', folderId: 'f' },
      { id: 'private', url: 'https://cooking.example/c', title: 'Secret recipe title', isPrivate: true },
      { id: 'start', url: '', title: 'New tab', isStartPage: true },
      { id: 'file', url: 'file:///Users/x/notes.html', title: 'Notes' },
    ]
    expect(tidyCandidates(tabs).map((tab) => tab.id)).toEqual(['loose'])
  })

  it('never builds text from a private tab title', () => {
    const tabs: TidyTab[] = [
      { id: 'private', url: 'https://bank.example/account', title: 'Private banking login', isPrivate: true },
      { id: 'public', url: 'https://sky.example/moon', title: 'The moon tonight' },
    ]
    const texts = tidyCandidates(tabs).map(tidyText)
    expect(texts).toEqual(['The moon tonight sky.example'])
    expect(texts.join(' ')).not.toContain('Private')
  })

  it('reads the title and the host, without www', () => {
    expect(tidyText({ id: 'a', url: 'https://www.news.example/x', title: '  Two   lines\nhere ' })).toBe('Two lines here news.example')
  })
})

describe('suggestGroups', () => {
  const tab = (id: string, title: string, host = 'site.example'): TidyTab => ({ id, url: `https://${host}/${id}`, title })

  it('separates two topics and leaves a stray tab alone', () => {
    const candidates = [
      tab('p1', 'Cooking pasta at home'),
      tab('p2', 'Cooking rice dishes'),
      tab('p3', 'Cooking bread and soup'),
      tab('s1', 'Astronomy: telescopes for beginners'),
      tab('s2', 'Astronomy of the night sky'),
      tab('s3', 'Astronomy guide to planets'),
      tab('stray', 'Gardening tips'),
    ]
    const vectors = [
      vector(1, 0.02, 0), vector(0.98, 0.05, 0), vector(0.97, 0, 0.1),
      vector(0, 1, 0.02), vector(0.04, 0.99, 0), vector(0, 0.98, 0.1),
      vector(0, 0, 1),
    ]
    const groups = suggestGroups(vectors, candidates)
    expect(groups.map((group) => group.tabIds.slice().sort())).toEqual([['p1', 'p2', 'p3'], ['s1', 's2', 's3']])
    expect(groups[0]!.name).toBe('Cooking')
    expect(groups[1]!.name).toBe('Astronomy')
  })

  it('merges only at or above the similarity threshold', () => {
    const pair = [tab('a', 'Alpha topic'), tab('b', 'Alpha topic too')]
    const at = (cosine: number) => [vector(1, 0), vector(cosine, Math.sqrt(1 - cosine * cosine))]
    expect(suggestGroups(at(TIDY_SIMILARITY - 0.05), pair)).toEqual([])
    expect(suggestGroups(at(TIDY_SIMILARITY + 0.05), pair)).toHaveLength(1)
  })

  it('keeps two topics apart when same-topic tabs are alike and different-topic tabs are not', () => {
    const cooking = [tab('c1', 'Cooking pasta'), tab('c2', 'Cooking rice'), tab('c3', 'Cooking bread')]
    const astro = [tab('a1', 'Astronomy Jupiter'), tab('a2', 'Astronomy night sky')]
    // Same-topic cosines about 0.9, across topics about 0.3 (below TIDY_SIMILARITY).
    const cookingVectors = [vector(1, 0, 0.1), vector(0.98, 0, 0.2), vector(0.97, 0, 0.25)]
    const astroVectors = [vector(0.3, 0.95, 0), vector(0.28, 0.96, 0)]
    const groups = suggestGroups([...cookingVectors, ...astroVectors], [...cooking, ...astro])
    // Largest first.
    expect(groups.map((group) => group.tabIds.slice().sort())).toEqual([['c1', 'c2', 'c3'], ['a1', 'a2']])
  })

  it('suggests at most eight groups', () => {
    const candidates: TidyTab[] = []
    const vectors: Float32Array[] = []
    for (let topic = 0; topic < 10; topic += 1) {
      for (let copy = 0; copy < 2; copy += 1) {
        candidates.push(tab(`t${topic}-${copy}`, `Topic${topic} story`))
        const v = new Float32Array(10)
        v[topic] = 1
        vectors.push(v)
      }
    }
    expect(suggestGroups(vectors, candidates)).toHaveLength(TIDY_MAX_GROUPS)
  })

  it('falls back to the shared site name, then to "Tabs", and keeps names unique', () => {
    const sameSite = [tab('x1', 'Morning', 'daily.example'), tab('x2', 'Evening', 'daily.example')]
    expect(suggestGroups([vector(1, 0), vector(0.99, 0.14)], sameSite)[0]!.name).toBe('Daily')
    const mixed = [tab('y1', 'Morning', 'one.example'), tab('y2', 'Evening', 'two.example')]
    expect(suggestGroups([vector(1, 0), vector(0.99, 0.14)], mixed)[0]!.name).toBe('Tabs')
    const twins: TidyTab[] = [tab('z1', 'Rivers flow north'), tab('z2', 'Rivers flow south'), tab('z3', 'Rivers and lakes'), tab('z4', 'Rivers of the world')]
    const near = [vector(1, 0), vector(0.99, 0.14), vector(0, 1), vector(0.01, 1)]
    const names = suggestGroups(near, twins).map((group) => group.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('needs one vector per candidate', () => {
    expect(() => suggestGroups([vector(1, 0)], [tab('a', 'A'), tab('b', 'B')])).toThrow()
  })
})

describe('keepPairsWhole', () => {
  const tab = (id: string, title: string): TidyTab => ({ id, url: `https://site.example/${id}`, title })

  it('suggests a side of a pair only in the same folder as its other side, and drops groups left too small', () => {
    const tabs: TidyTab[] = [
      { ...tab('l', 'Left'), split: { partnerId: 'r' } },
      { ...tab('r', 'Right'), split: { partnerId: 'l' } },
      tab('a', 'A'), tab('b', 'B'), tab('c', 'C'),
    ]
    expect(keepPairsWhole([{ name: 'One', tabIds: ['l', 'a', 'b'] }, { name: 'Two', tabIds: ['r', 'c'] }, { name: 'Both', tabIds: ['l', 'r'] }], tabs)).toEqual([
      { name: 'One', tabIds: ['a', 'b'] },
      { name: 'Both', tabIds: ['l', 'r'] },
    ])
  })
})
