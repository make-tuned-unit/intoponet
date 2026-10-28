import { describe, expect, it } from 'vitest'
import { articleCandidates as candidatesFor } from './eonet'
describe('article candidates for natural events', () => {
  it('tries this year’s storm first, then the bare name, and volcanoes by their mountain', () => {
    expect(candidatesFor('Tropical Cyclone Arnab', 2026).slice(0, 2)).toEqual(['Tropical Cyclone Arnab (2026)', 'Tropical Cyclone Arnab'])
    expect(candidatesFor('Tropical Cyclone Arnab', 2026)).toContain('Cyclone Arnab')
    expect(candidatesFor('Super Typhoon In-fa', 2026)).toContain('Typhoon In-fa (2026)')
    expect(candidatesFor('Etna Volcano, Italy', 2026)).toContain('Mount Etna')
    expect(candidatesFor('Wildfire BEE HAVEN (2) (24-06), Hamilton, Florida', 2026)[0]).toBe('Wildfire BEE HAVEN (2026)')
  })
})
