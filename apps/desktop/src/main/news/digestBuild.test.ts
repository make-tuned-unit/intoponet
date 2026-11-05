import { describe, expect, it } from 'vitest'
import { DigestModel, NeedsFullUpdate, type DigestUpdate } from './digestBuild'

const source = (sourceId: string) => ({ sourceId, countryCode: 'KE', publisherName: sourceId, publisherGroupId: sourceId, scope: 'national' as const, cityName: null, regionName: null, language: 'en' })
const item = (sourceId: string, title: string) => ({ sourceId, title, url: `https://example.ke/${encodeURIComponent(title)}`, publishedAt: new Date().toISOString(), discoveredAt: new Date().toISOString() })
const update = (patch: Partial<DigestUpdate>): DigestUpdate => ({ full: false, schemaVersion: 2, changed: {}, memoryOnly: [], health: {}, coverage: {}, inTheNews: [], now: Date.now(), ...patch })
const titles = (json: string) => JSON.stringify(JSON.parse(json))

describe('digest model', () => {
  it('shows no-store headlines now but keeps them off the disk copy', () => {
    const model = new DigestModel()
    model.apply(update({ full: true, sources: [source('s1')], changed: { s1: [item('s1', 'Floods hit Mombasa')] }, memoryOnly: [item('s1', 'Secret no-store headline')] }))
    const out = model.build(Date.now())
    expect(out.latest).toContain('Secret no-store headline')
    expect(out.disk).not.toContain('Secret no-store headline')
    expect(out.disk).toContain('Floods hit Mombasa')
  })

  it('writes the shown digest to disk when every feed may be stored', () => {
    const model = new DigestModel()
    model.apply(update({ full: true, sources: [source('s1')], changed: { s1: [item('s1', 'Floods hit Mombasa')] } }))
    const out = model.build(Date.now())
    expect(out.disk).toBeNull()
    expect(JSON.parse(out.latest).coverageSchemaVersion).toBe(2)
  })

  it('keeps unchanged feeds between updates, replaces changed ones and clears emptied ones', () => {
    const model = new DigestModel()
    model.apply(update({ full: true, sources: [source('s1'), source('s2')], changed: { s1: [item('s1', 'Floods hit Mombasa')], s2: [item('s2', 'Rains reach Kisumu')] } }))
    model.apply(update({ changed: { s1: [item('s1', 'Nairobi traffic eases')] } }))
    let out = titles(model.build(Date.now()).latest)
    expect(out).toContain('Rains reach Kisumu')
    expect(out).toContain('Nairobi traffic eases')
    expect(out).not.toContain('Floods hit Mombasa')
    model.apply(update({ changed: { s2: [] } }))
    out = titles(model.build(Date.now()).latest)
    expect(out).not.toContain('Rains reach Kisumu')
  })

  it('asks for a full update when it has no state (a restarted worker)', () => {
    const model = new DigestModel()
    expect(() => model.apply(update({ changed: { s1: [] } }))).toThrow(NeedsFullUpdate)
    expect(() => model.trends({ countryCode: 'KE' }, Date.now())).toThrow(NeedsFullUpdate)
  })
})
