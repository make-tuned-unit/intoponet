import { describe, expect, it } from 'vitest'
import type { GlobeSignal } from './globeSignals'
import { labelViewChanged, viewLabelSignals, visibleRadiusKm, type LabelView } from './viewLabels'

const signal = (id: string, lat: number, lon: number, intensity: number): GlobeSignal => ({ id, lat, lon, intensity, title: id, layer: 'news' } as GlobeSignal)
const view = (centerLat: number, centerLon: number, distance: number): LabelView => ({ centerLat, centerLon, distance, degPerPx: 0.02 * (distance - 1), width: 1400, height: 900 })

// Big stories elsewhere in the world, and small towns in the Netherlands.
const world = Array.from({ length: 30 }, (_, i) => signal(`news:country:X${i}`, -30 + i, 120 + i, 0.9 - i * 0.01))
const towns = [
  signal('news:city:2759794', 52.37, 4.89, 0.3), // Amsterdam
  signal('news:city:2747891', 51.92, 4.48, 0.25), // Rotterdam
  signal('news:city:2745912', 52.09, 5.12, 0.1), // Utrecht
]
const all = [...world, ...towns]

describe('viewLabelSignals', () => {
  it('labels the world’s top stories when the whole planet is in view', () => {
    const labels = viewLabelSignals(all, view(52, 5, 4.35), null)
    expect(labels).toHaveLength(16)
    expect(labels[0]!.id).toBe('news:country:X0')
  })

  it('labels the towns in view when zoomed in on a region, not stories on the far side', () => {
    const labels = viewLabelSignals(all, view(52.2, 4.9, 1.5), null).map((item) => item.id)
    expect(labels).toEqual(['news:city:2759794', 'news:city:2747891', 'news:city:2745912'])
  })

  it('keeps the selected signal first wherever it is', () => {
    const labels = viewLabelSignals(all, view(52.2, 4.9, 1.5), 'news:country:X3').map((item) => item.id)
    expect(labels[0]).toBe('news:country:X3')
    expect(labels).toContain('news:city:2759794')
  })
})

describe('visibleRadiusKm', () => {
  it('shrinks as you zoom in and never passes the horizon', () => {
    expect(visibleRadiusKm(view(0, 0, 1.3))).toBeLessThan(visibleRadiusKm(view(0, 0, 2.5)))
    expect(visibleRadiusKm({ ...view(0, 0, 5), degPerPx: 10 })).toBeLessThan(Math.PI / 2 * 6371)
  })
})

describe('labelViewChanged', () => {
  it('ignores tiny drifts and notices real moves', () => {
    const at = view(52, 5, 1.6)
    expect(labelViewChanged(at, { ...at, centerLat: 52.01 })).toBe(false)
    expect(labelViewChanged(at, { ...at, centerLat: 49 })).toBe(true)
    expect(labelViewChanged(at, { ...at, distance: 1.9 })).toBe(true)
    expect(labelViewChanged(view(0, 0, 4.3), view(30, 30, 4.4))).toBe(false)
  })
})
