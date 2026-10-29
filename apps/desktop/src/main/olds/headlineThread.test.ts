import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OldsService } from './oldsService'

const claim = (value: unknown) => [{ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } }]
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('headline event selection through the service', () => {
  async function select({ geocoded = true, ended = false, dated = true, filed = false, eventDescription = 'ongoing blockade' } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'olds-local-event-'))
    dirs.push(dir)
    const entities = {
      Q1000: { id: 'Q1000', labels: { en: { value: 'Blockade of Oleshky' } }, descriptions: { en: { value: eventDescription } }, sitelinks: { enwiki: { title: 'Blockade of Oleshky' } }, claims: { P31: claim({ id: 'Q198' }), P17: claim({ id: 'Q212' }), ...(dated ? { P580: claim({ time: '+2022-01-01T00:00:00Z', precision: 11 }) } : {}), ...(ended ? { P582: claim({ time: '+2024-01-01T00:00:00Z', precision: 11 }) } : {}) } },
      Q1001: { id: 'Q1001', labels: { en: { value: 'Peace negotiations in the Russo-Ukrainian war' } }, descriptions: { en: { value: 'ongoing war' } }, sitelinks: { enwiki: { title: 'Peace negotiations in the Russo-Ukrainian war' } }, claims: { P31: claim({ id: 'Q198' }), P17: claim({ id: 'Q212' }), P580: claim({ time: '+2022-01-01T00:00:00Z', precision: 11 }) } },
      Q1002: { id: 'Q1002', labels: { en: { value: 'Oleshky' } }, descriptions: { en: { value: 'city in Ukraine' } }, sitelinks: { enwiki: { title: 'Oleshky' } }, claims: { P31: claim({ id: 'Q515' }), P17: claim({ id: 'Q212' }), ...(geocoded ? { P625: claim({ latitude: 46.6, longitude: 32.7 }) } : {}) } },
      Q212: { id: 'Q212', labels: { en: { value: 'Ukraine' } }, claims: { P31: claim({ id: 'Q6256' }) } },
      Q159: { id: 'Q159', labels: { en: { value: 'Russia' } }, claims: { P31: claim({ id: 'Q6256' }) } },
    }
    const titles = ['Peace negotiations in the Russo-Ukrainian war', 'Blockade of Oleshky', 'Oleshky']
    const titleIds = { 'Peace negotiations in the Russo-Ukrainian war': 'Q1001', 'Blockade of Oleshky': 'Q1000', Oleshky: 'Q1002' }
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      const params = url.searchParams
      let payload: unknown = {}
      if (params.get('action') === 'wbgetentities') payload = { entities }
      else if (params.get('list') === 'search') payload = { query: { search: url.hostname === 'www.wikidata.org'
        ? [{ title: params.get('srsearch')?.includes('P297=RU') ? 'Q159' : 'Q212' }]
        : titles.map((title) => ({ title })) } }
      else if (params.get('prop')?.includes('pageprops')) payload = { query: { pages: (params.get('titles') ?? '').split('|').map((title) => ({ title, ...(title in titleIds ? { pageprops: { wikibase_item: titleIds[title as keyof typeof titleIds] } } : { missing: true }) })) } }
      else if (params.get('action') === 'parse') payload = { parse: { wikitext: '' } }
      return new Response(JSON.stringify(payload))
    }
    if (filed) await writeFile(join(dir, 'current-events.json'), JSON.stringify({
      at: Date.parse('2026-10-28T12:00:00Z'),
      items: [{ date: '2026-10-27', category: 'Armed conflicts',
        text: 'Russia and Ukraine reach peace negotiations and a ceasefire in Oleshky.',
        links: ['Oleshky'], threads: ['Blockade of Oleshky', 'Peace negotiations in the Russo-Ukrainian war'],
        url: 'https://en.wikipedia.org/wiki/Portal:Current_events/2026_October_27' }],
    }))
    const service = new OldsService({ cacheDir: dir, fetchImpl, now: () => Date.parse('2026-10-28T12:00:00Z') })
    return service.thread({ kind: 'headline', text: 'Who brokered Russia-Ukraine peace negotiations and ceasefire in Oleshky', countryCode: 'UA' })
  }

  it('prefers the current event in the explicitly named verified place', async () => {
    const thread = await select()
    expect(thread.rootId).toBe('Q1000')
    expect(thread.context?.matchedBy).not.toMatch(/^Geographic fallback:/)
  })
  it('does not classify a specific event from its mention of a city or island', async () => {
    const thread = await select({ filed: true, eventDescription: 'ongoing blockade in the city of Oleshky and on a nearby island' })
    expect(thread.rootId).toBe('Q1000')
    expect(thread.context?.matchedBy).not.toMatch(/^Geographic fallback:/)
  })
  it('uses a dated editorial filing when Wikidata has no start date', async () => {
    expect((await select({ dated: false, filed: true })).rootId).toBe('Q1000')
    expect((await select({ dated: false })).rootId).toBe('Q1001')
  })
  it('does not give that priority to an ended event', async () => {
    expect((await select({ ended: true })).rootId).toBe('Q1001')
  })
  it('does not infer location priority from capitalisation alone', async () => {
    expect((await select({ geocoded: false })).rootId).toBe('Q1001')
  })

  it('labels a Crown Dependency name match as a geographic fallback when no narrower topic is verified', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'olds-place-fallback-'))
    dirs.push(dir)
    await writeFile(join(dir, 'current-events.json'), JSON.stringify({ at: Date.parse('2026-10-28T12:00:00Z'), items: [] }))
    const title = 'Bailiwick of Guernsey'
    const entity = {
      id: 'Q25230',
      labels: { en: { value: title } },
      descriptions: { en: { value: 'one of the British Crown Dependencies in the Channel Islands' } },
      sitelinks: { enwiki: { title } },
      // Deliberately use an unfamiliar class: the geographic description is
      // the evidence that makes this a place, as it is for the live root.
      claims: { P31: claim({ id: 'Q999999' }), P625: claim({ latitude: 49.45, longitude: -2.54 }) },
    }
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input))
      const params = url.searchParams
      let payload: unknown = {}
      if (url.hostname === 'en.wikipedia.org' && params.get('list') === 'search') {
        payload = { query: { search: [{ title }] } }
      } else if (url.hostname === 'en.wikipedia.org' && params.get('prop')?.includes('pageprops')) {
        payload = { query: { pages: [{ title, pageprops: { wikibase_item: 'Q25230' } }] } }
      } else if (url.hostname === 'www.wikidata.org' && params.get('action') === 'wbgetentities') {
        payload = { entities: { Q25230: entity } }
      } else if (url.hostname === 'en.wikipedia.org' && params.get('action') === 'parse') {
        payload = { parse: { title, wikitext: '' } }
      } else if (url.hostname === 'en.wikipedia.org' && params.get('prop')?.includes('extracts')) {
        payload = { query: { pages: [{ title, extract: '' }] } }
      }
      return new Response(JSON.stringify(payload))
    }
    const service = new OldsService({ cacheDir: dir, fetchImpl, now: () => Date.parse('2026-10-28T12:00:00Z') })

    const thread = await service.thread({ kind: 'headline', text: 'Bailiwick of Guernsey considers new housing sites' })

    expect(thread.context?.topicId).toBe('Q25230')
    expect(thread.context?.matchedBy).toMatch(/^Geographic fallback: the headline matched Bailiwick of Guernsey, a broad place, but no specific subject or event was verified\./)
  })
})
