import { describe, expect, it } from 'vitest'
import { inferUnifiedLauncherIntent } from './launcherIntent'

const topics = [
  { id: 'ancient-rome', label: 'Ancient Rome' },
  { id: 'open-knowledge', label: 'Open knowledge' },
]

describe('unified launcher intent', () => {
  it('opens URL-like input automatically', () => {
    expect(inferUnifiedLauncherIntent('example.org/history', topics)).toEqual({
      kind: 'url', value: 'example.org/history',
    })
    expect(inferUnifiedLauncherIntent('https://example.org', topics)).toEqual({
      kind: 'url', value: 'https://example.org',
    })
  })

  it('explores an exact available topic and searches ordinary free text', () => {
    expect(inferUnifiedLauncherIntent('  ancient ROME ', topics)).toEqual({
      kind: 'topic', value: 'Ancient Rome',
    })
    expect(inferUnifiedLauncherIntent('Roman Colosseum visitor history', topics)).toEqual({
      kind: 'search', value: 'Roman Colosseum visitor history',
    })
    expect(inferUnifiedLauncherIntent('search engines', topics)).toEqual({
      kind: 'search', value: 'search engines',
    })
  })

  it('allows explicit explore and search phrasing without mode controls', () => {
    expect(inferUnifiedLauncherIntent('explore: Roman Colosseum', topics)).toEqual({
      kind: 'topic', value: 'Roman Colosseum',
    })
    expect(inferUnifiedLauncherIntent('search: Ancient Rome', topics)).toEqual({
      kind: 'search', value: 'Ancient Rome',
    })
  })
})
