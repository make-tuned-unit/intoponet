import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OldsService } from './oldsService'

const claim = (value: unknown) => [{ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } }]
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('headline event selection through the service', () => {
  async function select({ geocoded = true, ended = false, dated = true, filed = false } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'olds-local-event-'))
    dirs.push(dir)
    const entities = {
      Q1000: { id: 'Q1000', labels: { en: { value: 'Blockade of Oleshky' } }, descriptions: { en: { value: 'ongoing blockade' } }, sitelinks: { enwiki: { title: 'Blockade of Oleshky' } }, claims: { P31: claim({ id: 'Q198' }), P17: claim({ id: 'Q212' }), ...(dated ? { P580: claim({ time: '+2022-01-01T00:00:00Z', precision: 11 }) } : {}), ...(ended ? { P582: claim({ time: '+2024-01-01T00:00:00Z', precision: 11 }) } : {}) } },
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
    return (await service.thread({ kind: 'headline', text: 'Who brokered Russia-Ukraine peace negotiations and ceasefire in Oleshky', countryCode: 'UA' })).rootId
  }

  it('prefers the current event in the explicitly named verified place', async () => {
    expect(await select()).toBe('Q1000')
  })
  it('uses a dated editorial filing when Wikidata has no start date', async () => {
    expect(await select({ dated: false, filed: true })).toBe('Q1000')
    expect(await select({ dated: false })).toBe('Q1001')
  })
  it('does not give that priority to an ended event', async () => {
    expect(await select({ ended: true })).toBe('Q1001')
  })
  it('does not infer location priority from capitalisation alone', async () => {
    expect(await select({ geocoded: false })).toBe('Q1001')
  })
})
