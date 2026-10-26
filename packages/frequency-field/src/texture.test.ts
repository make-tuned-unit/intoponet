import { describe, expect, it } from 'vitest'
import type { FrequencyBand } from './types'
import { FIELD_DETAIL_TEXTURE_SIZE, FIELD_TEXTURE_SIZE, buildFieldDetailTile, buildFieldTexture, buildFieldTextureLods, createFieldSnapshotTransition, emptyFieldTexture, fieldChannelsAt, interpolateFieldTextures, materialPhaseTimeSeconds, phaseModulateBaseline, textureDisplacementAt } from './texture'

const stamp = '2026-10-23T19:00:00.000Z'
function band(overrides: Partial<FrequencyBand> = {}): FrequencyBand {
  return {
    id: 'signal', centerline: [{ lat: 0, lon: -2 }, { lat: 0, lon: 2 }], widthKm: 500,
    wavelengthKm: 1000, amplitude: 0.6, phase: 0.4, phaseVelocity: 0.08,
    confidence: 0.8, geographicConfidence: 0.7, coverageConfidence: 0.75, momentum: 0.2,
    phaseModulation: 0.14, topicIds: ['test-topic'], updatedAt: stamp, sourceType: 'synthetic',
    ...overrides,
  }
}

describe('multiresolution field textures', () => {
  it('produces deterministic pixels and version independent of input ordering', () => {
    const a = band({ id: 'a' })
    const b = band({ id: 'b', centerline: [{ lat: 2, lon: 40 }, { lat: 3, lon: 42 }], phase: 1.3 })
    const first = buildFieldTexture([a, b], 'earth', { tilePublishedAt: stamp, provenanceManifestId: 'manifest-1' })
    const second = buildFieldTexture([b, a], 'earth', { tilePublishedAt: stamp, provenanceManifestId: 'manifest-1' })
    expect(first.manifest.dataVersion).toBe(second.manifest.dataVersion)
    expect(first.field).toEqual(second.field)
    expect(first.wave).toEqual(second.wave)
    expect(first.manifest.bandIds).toEqual(['a', 'b'])
    expect(first.manifest.provenanceManifestId).toBe('manifest-1')
  })

  it('validates clock/provenance metadata and labels provisional sources honestly', () => {
    const publicBand = band({ sourceType: 'public-aggregate', sourceIds: ['source-a'], sourceSnapshotId: 'snapshot-1' })
    const provisional = buildFieldTexture([publicBand], 'earth')
    expect(provisional.manifest.provenanceStatus).toBe('provisional')
    expect(provisional.manifest.sourceType).toBe('public-aggregate')
    expect(provisional.manifest.sourceIds).toEqual(['source-a'])
    const fullyAttributed = { ...publicBand, provenanceManifestId: 'provenance-1', observationStart: stamp, observationEnd: stamp }
    const complete = buildFieldTexture([fullyAttributed], 'earth')
    expect(complete.manifest.provenanceStatus).toBe('complete')
    expect(complete.manifest.provenanceManifestId).toBe('provenance-1')
    expect(buildFieldTexture([{ ...fullyAttributed, provisional: true }], 'earth').manifest.provenanceStatus).toBe('provisional')
    expect(buildFieldTexture([{ ...fullyAttributed, sourceIds: [] }], 'earth').manifest.provenanceStatus).toBe('provisional')
    const { sourceSnapshotId: _snapshot, ...withoutSnapshot } = fullyAttributed
    const { observationEnd: _end, ...withoutWindowEnd } = fullyAttributed
    const { provenanceManifestId: _provenance, ...withoutBandManifest } = fullyAttributed
    expect(buildFieldTexture([withoutSnapshot], 'earth').manifest.provenanceStatus).toBe('provisional')
    expect(buildFieldTexture([withoutWindowEnd], 'earth').manifest.provenanceStatus).toBe('provisional')
    expect(buildFieldTexture([withoutBandManifest], 'earth', { provenanceManifestId: 'provenance-1' }).manifest.provenanceStatus).toBe('provisional')
    expect(emptyFieldTexture().manifest.sourceType).toBe('none')
    expect(() => buildFieldTexture([band()], 'earth', { tilePublishedAt: '2026-02-30T12:00:00Z' })).toThrow('UTC timestamps')
    const first = buildFieldTexture([band()], 'earth', { tilePublishedAt: stamp })
    const refreshed = buildFieldTexture([band()], 'earth', { tilePublishedAt: '2026-10-23T19:01:00Z' })
    expect(first.manifest.dataVersion).not.toBe(refreshed.manifest.dataVersion)
    expect(() => buildFieldTexture([{ ...publicBand, provenanceManifestId: 'manifest-a' }], 'earth', { provenanceManifestId: 'manifest-b' })).toThrow('conflict')
  })

  it('round trips signed channels and decodes bilinear momentum without snapping to a byte', () => {
    for (const momentum of [-1, 0, 1]) {
      const texture = buildFieldTexture([band({ momentum })], 'earth')
      expect(fieldChannelsAt(texture, 0, 0).momentum).toBeCloseTo(momentum, 2)
    }
    const base = emptyFieldTexture()
    const field = new Uint8Array(2 * 2 * 4)
    const wave = new Uint8Array(2 * 2 * 4)
    for (let y = 0; y < 2; y += 1) {
      field[(y * 2) * 4 + 1] = 127
      field[(y * 2 + 1) * 4 + 1] = 128
    }
    const tiny = { width: 2, height: 2, field, wave, manifest: { ...base.manifest, width: 2, height: 2 } }
    expect(fieldChannelsAt(tiny, 0, 0).momentum).toBeCloseTo(127.5 / 128 - 1, 6)
  })

  it('wraps longitude across the antimeridian and clamps poles without seams', () => {
    const seam = buildFieldTexture([band({ centerline: [{ lat: 0, lon: 178 }, { lat: 0, lon: -178 }], widthKm: 700 })])
    const westSeam = fieldChannelsAt(seam, 0, -180)
    const eastSeam = fieldChannelsAt(seam, 0, 180)
    expect(westSeam.intensity).toBeCloseTo(eastSeam.intensity, 6)
    expect(westSeam.coverage).toBeCloseTo(eastSeam.coverage, 6)

    const polar = buildFieldTexture([band({ centerline: [{ lat: 84, lon: -100 }, { lat: 85, lon: 100 }], widthKm: 1200 })])
    for (const latitude of [-90, 90]) {
      const samples = [-180, -90, 0, 90, 180].map((longitude) => fieldChannelsAt(polar, latitude, longitude).coverage)
      expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.005)
    }
  })

  it('keeps the same normalized signal baseline across LOD resolutions', () => {
    const input = [band({ centerline: [{ lat: 0, lon: -8 }, { lat: 0, lon: 8 }], widthKm: 900 })]
    const earth = buildFieldTexture(input, 'earth')
    const city = buildFieldTexture(input, 'city')
    expect(earth.manifest.normalizationVersion).toBe(city.manifest.normalizationVersion)
    expect(earth.manifest.width).toBe(FIELD_TEXTURE_SIZE.earth.width)
    expect(earth.manifest.width).toBeGreaterThan(buildFieldTexture(input, 'region').manifest.width)
    expect(city.manifest.minimumResolvedWidthKm).toBeGreaterThan(70)
    const coarse = fieldChannelsAt(earth, 1, 0)
    const fine = fieldChannelsAt(city, 1, 0)
    expect(Math.abs(coarse.intensity - fine.intensity)).toBeLessThan(0.035)
    expect(Math.abs(coarse.coverage - fine.coverage)).toBeLessThan(0.035)
  })

  it('resolves the minimum Earth carrier with at least eight global and detail texels', () => {
    const minimumCarrierWavelengthKm = 650
    const earthTexelWidthKm = (2 * Math.PI * 6371) / FIELD_TEXTURE_SIZE.earth.width
    const earthDetail = buildFieldDetailTile([], { lat: 0, lon: 0 }, 'earth')
    expect(FIELD_TEXTURE_SIZE.earth).toEqual({ width: 512, height: 256 })
    expect(FIELD_DETAIL_TEXTURE_SIZE.earth).toBe(256)
    expect(minimumCarrierWavelengthKm / earthTexelWidthKm).toBeGreaterThan(8)
    expect(16000 / earthDetail.width).toBeLessThan(63)
  })

  it('distinguishes unknown coverage from measured low activity', () => {
    const unknown = emptyFieldTexture('earth')
    const low = buildFieldTexture([band({ amplitude: 0.04 })], 'earth')
    const unknownAtAnchor = fieldChannelsAt(unknown, 0, 0)
    const lowAtAnchor = fieldChannelsAt(low, 0, 0)
    expect(unknownAtAnchor.intensity).toBe(0)
    expect(unknownAtAnchor.coverage).toBe(0)
    expect(lowAtAnchor.intensity).toBeGreaterThan(0)
    expect(lowAtAnchor.intensity).toBeLessThan(0.1)
    expect(lowAtAnchor.coverage).toBeGreaterThan(0.4)
  })

  it('changes height with intensity and reach with width but keeps the anchor fixed', () => {
    const low = buildFieldTexture([band({ amplitude: 0.2, widthKm: 500 })], 'earth')
    const high = buildFieldTexture([band({ amplitude: 0.8, widthKm: 500 })], 'earth')
    const narrow = buildFieldTexture([band({ widthKm: 500 })], 'earth')
    const wide = buildFieldTexture([band({ widthKm: 1000 })], 'earth')
    expect(textureDisplacementAt(high, 0, 0, 0, 0.045)).toBeGreaterThan(textureDisplacementAt(low, 0, 0, 0, 0.045))
    expect(Math.abs(fieldChannelsAt(wide, 0, 0).intensity - fieldChannelsAt(narrow, 0, 0).intensity)).toBeLessThan(0.02)
    expect(fieldChannelsAt(wide, 2, 0).intensity).toBeGreaterThan(fieldChannelsAt(narrow, 2, 0).intensity)
  })

  it('saturates overlap, and phase changes modulation without erasing the envelope', () => {
    const one = buildFieldTexture([band({ amplitude: 1 })], 'earth')
    const overlap = buildFieldTexture([band({ amplitude: 1 }), band({ id: 'two', amplitude: 1 })], 'earth')
    expect(fieldChannelsAt(overlap, 0, 0, 0).intensity).toBeGreaterThan(fieldChannelsAt(one, 0, 0, 0).intensity)
    expect(fieldChannelsAt(overlap, 0, 0, 0).intensity).toBeLessThan(1)
    const phaseA = fieldChannelsAt(one, 0, 0, 0).intensity
    const phaseB = fieldChannelsAt(one, 0, 0, 10).intensity
    expect(Math.min(phaseA, phaseB)).toBeGreaterThan(0)
    expect(Math.abs(phaseA - phaseB)).toBeLessThan(0.25)
    const period = (2 * Math.PI) / fieldChannelsAt(one, 0, 0).phaseVelocity
    const baseline = fieldChannelsAt(one, 0, 0).baselineIntensity
    const mean = Array.from({ length: 240 }, (_, index) => fieldChannelsAt(one, 0, 0, period * index / 240).intensity)
      .reduce((sum, value) => sum + value, 0) / 240
    expect(mean).toBeCloseTo(baseline, 3)
    expect(phaseModulateBaseline(baseline, 0.2, 0)).toBeLessThanOrEqual(1)
  })

  it('carries wave phase continuously across a polyline joint', () => {
    const corridor = band({
      centerline: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 0, lon: 2 }],
      widthKm: 80,
      wavelengthKm: 600,
    })
    const tile = buildFieldDetailTile([corridor], { lat: 0, lon: 1 }, 'topic', { halfExtentKm: 150 })
    const before = fieldChannelsAt(tile, 0, 0.99).phase
    const after = fieldChannelsAt(tile, 0, 1.01).phase
    const wrappedDelta = Math.atan2(Math.sin(after - before), Math.cos(after - before))
    expect(Math.abs(wrappedDelta)).toBeLessThan(0.1)
  })

  it('interpolates observations smoothly and rejects mixed synthetic/public bundles', () => {
    const from = emptyFieldTexture('earth')
    const to = buildFieldTexture([band()], 'earth')
    const halfway = interpolateFieldTextures(from, to, 0.5)
    expect(fieldChannelsAt(halfway, 0, 0).intensity).toBeGreaterThan(0)
    expect(fieldChannelsAt(halfway, 0, 0).intensity).toBeLessThan(fieldChannelsAt(to, 0, 0).intensity)
    const differentLod = buildFieldTexture([band()], 'city')
    expect(interpolateFieldTextures(from, differentLod, 0.5).width).toBe(differentLod.width)
    expect(() => buildFieldTexture([band(), band({ id: 'public', sourceType: 'public-aggregate' })], 'earth')).toThrow('cannot share')
  })

  it('retains provenance for every contributor through fades and interrupted transitions', () => {
    const attributed = band({ sourceType: 'public-aggregate', sourceIds: ['source-a'], sourceSnapshotId: 'snapshot-a', provenanceManifestId: 'manifest-a', observationStart: stamp, observationEnd: stamp })
    const publicA = buildFieldTexture([attributed], 'earth')
    const empty = emptyFieldTexture('earth')
    const fadeOut = interpolateFieldTextures(publicA, empty, 0.5)
    expect(fadeOut.manifest.bandIds).toContain('signal')
    expect(fadeOut.manifest.sourceIds).toContain('source-a')
    expect(fadeOut.manifest.provenanceManifestIds).toEqual(['manifest-a'])
    expect(fadeOut.manifest.provenanceStatus).toBe('complete')
    const interrupted = interpolateFieldTextures(fadeOut, empty, 0.5)
    expect(interrupted.manifest.bandIds).toContain('signal')
    expect(interrupted.manifest.sourceIds).toContain('source-a')
    expect(interrupted.manifest.provenanceStatus).toBe('complete')

    const provisional = buildFieldTexture([band({ sourceType: 'public-aggregate', sourceIds: ['source-old'], sourceSnapshotId: 'snapshot-old' })], 'earth')
    const mix = interpolateFieldTextures(provisional, publicA, 0.5)
    expect(mix.manifest.provenanceManifestIds).toEqual(['manifest-a'])
    expect(mix.manifest.sourceIds).toEqual(['source-a', 'source-old'])
    expect(mix.manifest.provenanceStatus).toBe('provisional')
    const publicB = buildFieldTexture([{ ...attributed, provenanceManifestId: 'manifest-b' }], 'earth')
    const crossed = interpolateFieldTextures(publicA, publicB, 0.5)
    expect(crossed.manifest.provenanceManifestId).toBeNull()
    expect(crossed.manifest.provenanceManifestIds).toEqual(['manifest-a', 'manifest-b'])
    expect(crossed.manifest.provenanceStatus).toBe('provisional')
    expect(interpolateFieldTextures(publicA, empty, 0)).toBe(publicA)
    expect(interpolateFieldTextures(publicA, empty, 1)).toBe(empty)
  })

  it('rejects malformed inputs and over-budget segments instead of silently dropping them', () => {
    expect(() => buildFieldTexture([band({ centerline: [{ lat: 91, lon: 0 }, { lat: 0, lon: 0 }] })])).toThrow('malformed')
    const manySegments = Array.from({ length: 19 }, (_, index) => band({
      id: `many-${index}`,
      centerline: Array.from({ length: 8 }, (__, pointIndex) => ({ lat: index % 80, lon: pointIndex - 4 })),
    }))
    expect(() => buildFieldTexture(manySegments, 'earth')).toThrow('at most 128 line segments')
    const expensiveDetail = Array.from({ length: 18 }, (_, index) => band({
      id: `detail-${index}`,
      centerline: Array.from({ length: 8 }, (__, pointIndex) => ({ lat: index / 10, lon: pointIndex / 10 })),
    }))
    expect(() => buildFieldTexture(expensiveDetail, 'topic', { detail: { center: { lat: 0, lon: 0 }, halfExtentKm: 20 } })).toThrow('work budget')
  })

  it('builds bounded local detail tiles with physical resolution and stable geographic sampling', () => {
    const anchor = { lat: 44.65, lon: -63.6 }
    const local = band({ centerline: [{ lat: 44.5, lon: -64.4 }, { lat: 44.8, lon: -62.8 }], widthKm: 45, wavelengthKm: 100 })
    const remote = band({ id: 'remote', centerline: [{ lat: 35, lon: 135 }, { lat: 36, lon: 136 }] })
    const tile = buildFieldDetailTile([local, remote], anchor, 'city', { halfExtentKm: 180 })
    expect(tile.manifest.projection).toBe('local-azimuthal-equidistant')
    expect(tile.manifest.detailCenter).toEqual(anchor)
    expect(tile.manifest.bandIds).toEqual(['signal'])
    expect(tile.manifest.pixelWidthKm).toBeCloseTo(360 / tile.width, 6)
    expect(tile.manifest.minimumResolvedWidthKm).toBe(tile.manifest.pixelWidthKm)
    expect(fieldChannelsAt(tile, anchor.lat, anchor.lon).coverage).toBeGreaterThan(0.5)
    expect(fieldChannelsAt(tile, 35.5, 135.5).coverage).toBe(0)
  })

  it('keeps local detail centered and finite across antimeridian and near-pole anchors', () => {
    const edge = band({ centerline: [{ lat: 5, lon: 179 }, { lat: 5, lon: -179 }], widthKm: 80 })
    const seam = buildFieldDetailTile([edge], { lat: 5, lon: 180 }, 'topic', { halfExtentKm: 100 })
    expect(fieldChannelsAt(seam, 5, 180).coverage).toBeGreaterThan(0.5)
    const polar = band({ centerline: [{ lat: 88, lon: -120 }, { lat: 89, lon: 30 }], widthKm: 80 })
    const poleTile = buildFieldDetailTile([polar], { lat: 88.5, lon: 160 }, 'topic', { halfExtentKm: 100 })
    expect(Number.isFinite(fieldChannelsAt(poleTile, 88.5, 160).intensity)).toBe(true)
    expect(() => buildFieldDetailTile([edge], { lat: 91, lon: 0 }, 'city')).toThrow('Invalid local detail bounds')
  })

  it('clamps local tile edges instead of sampling the opposite edge and keeps empty momentum neutral', () => {
    const eastBand = band({ centerline: [{ lat: 0, lon: 0.86 }, { lat: 0, lon: 0.88 }], widthKm: 4 })
    const local = buildFieldDetailTile([eastBand], { lat: 0, lon: 0 }, 'city', { halfExtentKm: 100 })
    expect(fieldChannelsAt(local, 0, 0.88).intensity).toBeGreaterThan(0.35)
    expect(fieldChannelsAt(local, 0, -0.88).intensity).toBeLessThan(0.02)
    expect(fieldChannelsAt(local, 0, -0.88).coverage).toBeLessThan(0.02)
    expect(fieldChannelsAt(emptyFieldTexture(), 0, 0).momentum).toBe(0)
    const outside = fieldChannelsAt(local, 50, 50)
    expect(outside.momentum).toBe(0)
    expect(outside.phase).toBe(0)
    expect(outside.phaseVelocity).toBe(0)
  })

  it('builds coherent LODs and keeps snapshot and material clocks independent', () => {
    const low = buildFieldTextureLods([band({ amplitude: 0.3 })], { observationStart: stamp, observationEnd: stamp, historicalTime: stamp })
    const high = buildFieldTextureLods([band({ amplitude: 0.7 })], { observationStart: stamp, observationEnd: stamp, historicalTime: stamp })
    expect(low.earth.manifest.normalizationVersion).toBe(low.topic.manifest.normalizationVersion)
    expect(low.earth.manifest.observationStart).toBe(stamp)
    expect(low.city.manifest.historicalTime).toBe(stamp)
    expect(fieldChannelsAt(low.earth, 0, 0).intensity).toBeGreaterThan(0)
    expect(fieldChannelsAt(high.earth, 0, 0).intensity).toBeGreaterThan(fieldChannelsAt(low.earth, 0, 0).intensity)
    const transition = createFieldSnapshotTransition(low.earth, high.earth, { startedAtMs: 1000, durationMs: 15_000 })
    expect(transition.progress(1000)).toBe(0)
    expect(transition.progress(8500)).toBe(0.5)
    expect(transition.complete(16_000)).toBe(true)
    expect(fieldChannelsAt(transition.sample(8500), 0, 0).intensity).toBeGreaterThan(fieldChannelsAt(low.earth, 0, 0).intensity)
    expect(transition.sample(8500).manifest.snapshotTransition?.toVersion).toBe(high.earth.manifest.dataVersion)
    expect(materialPhaseTimeSeconds(12, true)).toBe(0)
    expect(materialPhaseTimeSeconds(12, false)).toBe(12)
    expect(() => createFieldSnapshotTransition(low.earth, high.earth, { startedAtMs: 0, durationMs: 9_999 })).toThrow('10 and 30 seconds')
    expect(() => createFieldSnapshotTransition(low.earth, high.earth, { startedAtMs: Number.NaN })).toThrow('finite start time')
    expect(() => transition.progress(Number.NaN)).toThrow('finite')
    expect(() => interpolateFieldTextures(low.earth, high.earth, Number.NaN)).toThrow('finite')
    const atStart = interpolateFieldTextures(low.earth, high.earth, 0)
    const atEnd = interpolateFieldTextures(low.earth, high.earth, 1)
    expect(atStart.wave).toEqual(low.earth.wave)
    expect(atEnd.wave).toEqual(high.earth.wave)
  })

  it('reprojects local detail during an anchor transition instead of erasing the field', () => {
    const signal = band({ centerline: [{ lat: 44, lon: -65 }, { lat: 45, lon: -62 }], widthKm: 90, wavelengthKm: 180 })
    const from = buildFieldDetailTile([signal], { lat: 44.5, lon: -64 }, 'city', { halfExtentKm: 240 })
    const to = buildFieldDetailTile([signal], { lat: 45, lon: -62.5 }, 'city', { halfExtentKm: 240 })
    const transition = interpolateFieldTextures(from, to, 0.5)
    expect(transition.manifest.detailCenter).toEqual(to.manifest.detailCenter)
    expect(fieldChannelsAt(transition, 44.5, -63.5).coverage).toBeGreaterThan(0.25)
  })
})
