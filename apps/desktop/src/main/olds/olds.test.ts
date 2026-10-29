import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseOldsCommand } from '@intoponet/browser-api'
import { edgesFromEntity, nodeFromEntity, parseWikidataTime, resolveCitations, type WikidataEntity } from './wikidata'
import { OldsService } from './oldsService'

const item = (id: string) => ({ snaktype: 'value', datavalue: { type: 'wikibase-entityid', value: { id } } })
const time = (value: string, precision: number) => ({ snaktype: 'value', datavalue: { type: 'time', value: { time: value, precision } } })

const fallOfWall: WikidataEntity = {
  id: 'Q41921',
  labels: { en: { value: 'Fall of the Berlin Wall' } },
  descriptions: { en: { value: 'opening of the Berlin Wall in 1989' } },
  sitelinks: { enwiki: { title: 'Fall of the Berlin Wall' } },
  claims: {
    P585: [{ mainsnak: time('+1989-11-09T00:00:00Z', 11), rank: 'normal' }],
    P828: [
      {
        mainsnak: item('Q1'), rank: 'normal',
        references: [
          { snaks: { P854: [{ snaktype: 'value', datavalue: { type: 'string', value: 'https://example.org/source' } }] } },
          { snaks: { P248: [item('Q2')] } },
          { snaks: { P143: [item('Q328')] } },
        ],
      },
      { mainsnak: item('Q3'), rank: 'deprecated' },
      { mainsnak: item('Q4'), rank: 'normal', qualifiers: { P1310: [item('Q5')] } },
    ],
    P1542: [{ mainsnak: item('Q6'), rank: 'normal' }],
    P155: [{ mainsnak: item('Q7'), rank: 'normal' }],
    P17: [{ mainsnak: item('Q183'), rank: 'normal' }],
    P1889: [{ mainsnak: item('Q8'), rank: 'normal' }],
  },
}

describe('Wikidata dates', () => {
  it('respects precision and BCE years', () => {
    expect(parseWikidataTime({ time: '+1989-11-09T00:00:00Z', precision: 11 })).toEqual({ iso: '1989-11-09', precision: 'day', label: '9 Nov 1989' })
    expect(parseWikidataTime({ time: '+1989-11-00T00:00:00Z', precision: 10 })).toEqual({ iso: '1989-11', precision: 'month', label: 'Nov 1989' })
    expect(parseWikidataTime({ time: '-0044-03-15T00:00:00Z', precision: 11 })).toEqual({ iso: '-0044-03-15', precision: 'day', label: '15 Mar 44 BC' })
    expect(parseWikidataTime({ time: '-0044-00-00T00:00:00Z', precision: 9 })?.label).toBe('44 BC')
    expect(parseWikidataTime({ time: '+1960-00-00T00:00:00Z', precision: 8 })?.label).toBe('1960s')
    expect(parseWikidataTime({ time: '+1901-00-00T00:00:00Z', precision: 7 })?.label).toBe('20th century')
    expect(parseWikidataTime({ time: '-0450-00-00T00:00:00Z', precision: 7 })?.label).toBe('5th century BC')
    expect(parseWikidataTime({ time: '+1500-00-00T00:00:00Z', precision: 6 })?.label).toBe('2nd millennium')
    expect(parseWikidataTime({ time: '+1990-00-00T00:00:00Z', precision: 3 })).toBeNull()
    expect(parseWikidataTime({ time: 'garbage', precision: 11 })).toBeNull()
  })
})

describe('Wikidata relations', () => {
  const edges = edgesFromEntity(fallOfWall)

  it('maps statements to typed, directed edges', () => {
    const cause = edges.find((edge) => edge.from === 'Q1')!
    expect(cause).toMatchObject({ to: 'Q41921', type: 'contributed_to', epistemic: 'source-stated', property: 'P828', propertyLabel: 'has cause' })
    expect(edges.find((edge) => edge.to === 'Q6')).toMatchObject({ from: 'Q41921', type: 'contributed_to', property: 'P1542' })
    expect(edges.find((edge) => edge.to === 'Q7')).toMatchObject({ type: 'preceded_by', epistemic: 'chronology-only' })
    // An event gets its location statements as located_at.
    expect(edges.find((edge) => edge.to === 'Q183')).toMatchObject({ type: 'located_at', property: 'P17' })
  })

  it('skips deprecated and ignored properties; marks disputed statements', () => {
    expect(edges.some((edge) => edge.from === 'Q3' || edge.to === 'Q3')).toBe(false)
    expect(edges.some((edge) => edge.to === 'Q8' || edge.from === 'Q8')).toBe(false)
    expect(edges.find((edge) => edge.from === 'Q4')).toMatchObject({ type: 'disputed_link', epistemic: 'disputed' })
  })

  it('does not attach location edges to non-events', () => {
    const person: WikidataEntity = { id: 'Q9', claims: { P17: [{ mainsnak: item('Q183'), rank: 'normal' }] } }
    expect(edgesFromEntity(person)).toEqual([])
  })

  it('extracts citations from reference URLs and stated-in items, ignoring bare imports', () => {
    const cause = edges.find((edge) => edge.from === 'Q1')!
    expect(cause.referenceCount).toBe(2)
    const citations = resolveCitations(cause.citationDrafts, new Map([['Q2', { id: 'Q2', label: 'Britannica', description: null, start: null, end: null, wikipediaUrl: 'https://en.wikipedia.org/wiki/Britannica', wikidataUrl: 'https://www.wikidata.org/wiki/Q2' }]]))
    expect(citations).toEqual([
      { url: 'https://example.org/source', title: null },
      { url: 'https://en.wikipedia.org/wiki/Britannica', title: 'Britannica' },
    ])
  })

  it('builds sanitized nodes with dates and links', () => {
    const node = nodeFromEntity({ ...fallOfWall, sitelinks: {}, labels: { en: { value: 'Fall\u0000 of   the Berlin Wall' } } })!
    expect(node).toMatchObject({ id: 'Q41921', label: 'Fall of the Berlin Wall', wikipediaUrl: null })
    // The Wikipedia title supplies display case over Wikidata's lowercase label.
    expect(nodeFromEntity({ ...fallOfWall, labels: { en: { value: 'fall of the Berlin Wall' } } })).toMatchObject({ label: 'Fall of the Berlin Wall', wikipediaUrl: 'https://en.wikipedia.org/wiki/Fall_of_the_Berlin_Wall' })
    expect(node.start?.label).toBe('9 Nov 1989')
    expect(nodeFromEntity({ id: 'not-a-qid' })).toBeNull()
  })
})

describe('Olds commands', () => {
  it('validates queries', () => {
    expect(parseOldsCommand({ type: 'thread', query: { kind: 'qid', qid: 'Q362' } })).toEqual({ type: 'thread', query: { kind: 'qid', qid: 'Q362' } })
    expect(parseOldsCommand({ type: 'thread', query: { kind: 'country', countryCode: 'KE' } }).query).toEqual({ kind: 'country', countryCode: 'KE' })
    expect(() => parseOldsCommand({ type: 'thread', query: { kind: 'qid', qid: 'Q0' } })).toThrow()
    expect(() => parseOldsCommand({ type: 'thread', query: { kind: 'wikipedia', title: 'a|b' } })).toThrow()
    expect(() => parseOldsCommand({ type: 'thread', query: { kind: 'country', countryCode: 'ke' } })).toThrow()
    expect(() => parseOldsCommand({ type: 'nope' })).toThrow()
  })
})

describe('OldsService', () => {
  let dir = ''
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

  const related: Record<string, WikidataEntity> = {
    Q1: { id: 'Q1', labels: { en: { value: 'Revolutions of 1989' } }, sitelinks: { enwiki: { title: 'Revolutions of 1989' } }, claims: { P580: [{ mainsnak: time('+1989-01-00T00:00:00Z', 10), rank: 'normal' }] } },
    Q2: { id: 'Q2', labels: { en: { value: 'Britannica' } } },
    Q4: { id: 'Q4', labels: { en: { value: 'Disputed cause' } } },
    Q6: { id: 'Q6', labels: { en: { value: 'German reunification' } } },
    Q7: { id: 'Q7', labels: { en: { value: 'Pan-European Picnic' } } },
    Q183: { id: 'Q183', labels: { en: { value: 'Germany' } } },
  }

  function fakeFetch(calls: string[]): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      calls.push(url.hostname)
      if (url.hostname === 'en.wikipedia.org') {
        return new Response(JSON.stringify({ query: { pages: [{ pageprops: { wikibase_item: 'Q41921' } }] } }))
      }
      const ids = (url.searchParams.get('ids') ?? '').split('|')
      const entities = Object.fromEntries(ids.map((id) => [id, id === 'Q41921' ? fallOfWall : related[id] ?? { id, missing: '' }]))
      return new Response(JSON.stringify({ entities }))
    }) as typeof fetch
  }

  it('resolves a Wikipedia title into a cited thread and caches it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'olds-'))
    const calls: string[] = []
    const service = new OldsService({ cacheDir: dir, fetchImpl: fakeFetch(calls), now: () => Date.parse('2026-10-26T12:00:00Z') })
    const thread = await service.thread({ kind: 'wikipedia', title: 'Fall of the Berlin Wall' })
    expect(thread.rootId).toBe('Q41921')
    expect(thread.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(['Fall of the Berlin Wall', 'Revolutions of 1989', 'German reunification', 'Pan-European Picnic', 'Germany']))
    // Stated-in items label citations but are not thread nodes.
    expect(thread.nodes.some((node) => node.id === 'Q2')).toBe(false)
    expect(thread.edges.find((edge) => edge.from === 'Q1')?.citations[1]).toEqual({ url: 'https://www.wikidata.org/wiki/Q2', title: 'Britannica' })
    expect(thread.note).toMatch(/Chronology only/)
    const before = calls.length
    // A fresh service reads the on-disk cache without the network.
    const again = await new OldsService({ cacheDir: dir, fetchImpl: fakeFetch(calls), now: () => Date.parse('2026-10-27T12:00:00Z') })
      .thread({ kind: 'wikipedia', title: 'Fall_of_the_Berlin_Wall' })
    expect(again.edges.length).toBe(thread.edges.length)
    expect(calls.length).toBe(before)
  })

  it('enriches from editions linked only by the root article, with bounded attributed fetches', async () => {
    dir = await mkdtemp(join(tmpdir(), 'olds-root-series-'))
    const currentTitle = '2026 Example national election'
    const editionTitles = [
      '2008 Example national election',
      '2012 Example national election',
      '2020 Example national election',
    ]
    const seriesFetches: string[] = []
    const rootWikitext = editionTitles.map((title) => `[[${title}]]`).join('\n') + '\n[[2019 Example presidential election]]'
    const edition = (title: string) => `The ${title} was held on 12 June ${title.slice(0, 4)}, and voters chose a new president.`
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      if (url.hostname === 'www.wikidata.org' && url.searchParams.get('action') === 'wbgetentities') {
        return new Response(JSON.stringify({ entities: {
          Q9000: {
            id: 'Q9000',
            labels: { en: { value: currentTitle } },
            descriptions: { en: { value: 'national election' } },
            sitelinks: { enwiki: { title: currentTitle } },
            claims: {},
          },
        } }))
      }
      if (url.hostname === 'en.wikipedia.org') {
        if (url.searchParams.get('action') === 'parse') {
          const title = url.searchParams.get('page') ?? ''
          if (editionTitles.includes(title)) seriesFetches.push(title)
          return new Response(JSON.stringify({ parse: {
            title,
            // No dated narrative or background article pointer: prior editions
            // are linked only from the root's own article body.
            wikitext: title === currentTitle ? rootWikitext : edition(title),
          } }))
        }
        if (url.searchParams.get('action') === 'query') {
          const title = url.searchParams.get('titles') ?? currentTitle
          if (url.searchParams.get('prop') === 'pageprops') {
            return new Response(JSON.stringify({ query: { pages: [{ pageprops: { wikibase_item: 'Q9000' } }] } }))
          }
          return new Response(JSON.stringify({ query: { pages: [{ title, extract: '' }] } }))
        }
      }
      return new Response(JSON.stringify({}))
    }
    const service = new OldsService({ cacheDir: dir, fetchImpl, now: () => Date.parse('2026-10-28T12:00:00Z') })

    const thread = await service.thread({ kind: 'qid', qid: 'Q9000' })

    expect(thread.chronicle?.map((entry) => entry.at.iso)).toEqual(['2008-06-12', '2012-06-12', '2020-06-12'])
    expect(thread.chronicle?.map((entry) => entry.sourceTitle)).toEqual(editionTitles)
    expect(thread.chronicle?.every((entry) => editionTitles.some((title) => entry.url.includes(encodeURIComponent(title.replace(/ /g, '_')))))).toBe(true)
    expect(thread.historyNote).toContain('Earlier context comes from linked subject articles and earlier events in the same series')
    expect(seriesFetches.sort()).toEqual([...editionTitles].sort())
    expect(seriesFetches).toHaveLength(3)
  })

  it('uses a recent previous edition only to find older same-series pages', async () => {
    dir = await mkdtemp(join(tmpdir(), 'olds-series-bridge-'))
    const currentTitle = '2026 Example national election'
    const bridgeTitle = '2021 Example national election'
    const olderTitle = '2016 Example national election'
    const seriesFetches: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      if (url.hostname === 'www.wikidata.org' && url.searchParams.get('action') === 'wbgetentities') {
        return new Response(JSON.stringify({ entities: {
          Q9001: {
            id: 'Q9001',
            labels: { en: { value: currentTitle } },
            descriptions: { en: { value: 'national election' } },
            sitelinks: { enwiki: { title: currentTitle } },
            claims: {},
          },
        } }))
      }
      if (url.hostname === 'en.wikipedia.org') {
        if (url.searchParams.get('action') === 'parse') {
          const title = url.searchParams.get('page') ?? ''
          if (title === bridgeTitle || title === olderTitle) seriesFetches.push(title)
          const wikitext = title === currentTitle
            ? `[[${bridgeTitle}]]\n[[2019 Example local election]]`
            : title === bridgeTitle
              ? `[[${olderTitle}]]\n[[2016 Example state election]]`
              : `The ${olderTitle} was held on 5 May 2016, and voters chose a new president.`
          return new Response(JSON.stringify({ parse: { title, wikitext } }))
        }
        if (url.searchParams.get('action') === 'query') {
          const title = url.searchParams.get('titles') ?? currentTitle
          return new Response(JSON.stringify({ query: { pages: [{ title, extract: '' }] } }))
        }
      }
      return new Response(JSON.stringify({}))
    }
    const service = new OldsService({ cacheDir: dir, fetchImpl, now: () => Date.parse('2026-10-28T12:00:00Z') })

    const thread = await service.thread({ kind: 'qid', qid: 'Q9001' })

    expect(thread.chronicle?.map((entry) => entry.at.iso)).toEqual(['2016-05-05'])
    expect(thread.chronicle?.[0]?.sourceTitle).toBe(olderTitle)
    expect(thread.chronicle?.[0]?.url).toContain(encodeURIComponent(olderTitle.replace(/ /g, '_')))
    expect(seriesFetches).toEqual([bridgeTitle, olderTitle])
  })

  it('samples the balanced middle edition when an even series has a sparse quarter point', async () => {
    dir = await mkdtemp(join(tmpdir(), 'olds-series-midpoint-'))
    const currentTitle = '2026 Example national election'
    const editionTitles = [
      '1971 Example national election',
      '1977 Example national election',
      '1991 Example national election',
      '2001 Example national election',
    ]
    const fetched: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      if (url.hostname === 'www.wikidata.org' && url.searchParams.get('action') === 'wbgetentities') {
        return new Response(JSON.stringify({ entities: {
          Q9002: {
            id: 'Q9002',
            labels: { en: { value: currentTitle } },
            descriptions: { en: { value: 'national election' } },
            sitelinks: { enwiki: { title: currentTitle } },
            claims: {},
          },
        } }))
      }
      if (url.hostname === 'en.wikipedia.org') {
        if (url.searchParams.get('action') === 'parse') {
          const title = url.searchParams.get('page') ?? ''
          if (editionTitles.includes(title)) fetched.push(title)
          const wikitext = title === currentTitle
            ? editionTitles.map((edition) => `[[${edition}]]`).join('\n')
            : title === editionTitles[1]
              ? 'This earlier edition has no dated prose sentence in the main narrative.'
              : `On 1 March ${title.slice(0, 4)}, voters chose assembly members in a statewide election held under the previous electoral law.`
          return new Response(JSON.stringify({ parse: { title, wikitext } }))
        }
        if (url.searchParams.get('action') === 'query') {
          const title = url.searchParams.get('titles') ?? currentTitle
          return new Response(JSON.stringify({ query: { pages: [{ title, extract: '' }] } }))
        }
      }
      return new Response(JSON.stringify({}))
    }
    const service = new OldsService({ cacheDir: dir, fetchImpl, now: () => Date.parse('2026-10-28T12:00:00Z') })

    const thread = await service.thread({ kind: 'qid', qid: 'Q9002' })

    expect(fetched).toEqual([editionTitles[0], editionTitles[2], editionTitles[3]])
    expect(thread.chronicle?.map((entry) => entry.at.iso)).toEqual(['1971-03-01', '1991-03-01', '2001-03-01'])
    expect(thread.chronicle?.map((entry) => entry.sourceTitle)).toEqual([editionTitles[0], editionTitles[2], editionTitles[3]])
  })
})
