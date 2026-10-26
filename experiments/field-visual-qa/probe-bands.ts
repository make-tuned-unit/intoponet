import { bandsFromSnapshot, demoFieldSnapshot, parseFieldSnapshot } from '@intoponet/field-snapshot'
import { fieldAt, distToArc, latLonToRender, segmentsFromBands } from '@intoponet/frequency-field'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const publicPath = 'experiments/field-visual-qa/artifacts/public-field-snapshot.json'
const publicSnapshot = parseFieldSnapshot(readFileSync(publicPath, 'utf8'))
if (!publicSnapshot) throw new Error('Current public snapshot did not parse')

const cameraTarget = { lat: 40.7, lon: -74 }
function unmodulatedCoverage(point: ReturnType<typeof latLonToRender>, segments: ReturnType<typeof segmentsFromBands>): number {
  return segments.reduce((sum, segment) => {
    const nearest = distToArc(
      point,
      { x: segment.ax, y: segment.ay, z: segment.az },
      { x: segment.bx, y: segment.by, z: segment.bz },
    )
    const sigma = Math.max(segment.sigma * 1.28, 0.008)
    return sum + segment.amplitude * Math.exp(-0.5 * (nearest.distance / sigma) ** 2)
  }, 0)
}
const reportSnapshot = (label: string, snapshot: typeof publicSnapshot): object => {
  const bands = bandsFromSnapshot(snapshot, 'earth')
  const segments = segmentsFromBands(bands, latLonToRender)
  const candidates = bands.flatMap((band) => band.centerline.slice(1).flatMap((end, index) => {
    const start = band.centerline[index]
    if (!start) return []
    return Array.from({ length: 101 }, (_, step) => {
      const amount = step / 100
      const point = latLonToRender(
        start.lat + (end.lat - start.lat) * amount,
        start.lon + (end.lon - start.lon) * amount,
      )
      return {
        point,
        field: fieldAt(point, segments, 0),
        coverage: unmodulatedCoverage(point, segments),
      }
    })
  }))
  const trough = candidates
    .filter((candidate) => candidate.coverage > 0.25)
    .sort((a, b) => a.field - b.field)[0]
  return {
    label,
    snapshotSourceCount: snapshot.sources.length,
    bandCount: bands.length,
    segmentCount: segments.length,
    bands: bands.map((band) => ({
      id: band.id,
      centerline: band.centerline,
      amplitude: band.amplitude,
      widthKm: band.widthKm,
    })),
    fieldAtCameraTarget: fieldAt(latLonToRender(cameraTarget.lat, cameraTarget.lon), segments, 0),
    unmodulatedCoverageAtCameraTarget: unmodulatedCoverage(latLonToRender(cameraTarget.lat, cameraTarget.lon), segments),
    fieldAtTrough: trough?.field ?? null,
    coverageAtTrough: trough?.coverage ?? null,
    fieldAtNorthAmericaCenter: fieldAt(latLonToRender(40, -100), segments, 0),
  }
}

const report = [
  reportSnapshot('synthetic', demoFieldSnapshot()),
  reportSnapshot('public-fixture', publicSnapshot),
]
for (const result of report as Array<{ label: string; fieldAtCameraTarget: number; unmodulatedCoverageAtCameraTarget: number }>) {
  assert.ok(result.fieldAtTrough !== null && result.fieldAtTrough < 0.01, `${result.label}: expected a deterministic t=0 trough along a corridor`)
  assert.ok(result.coverageAtTrough !== null && result.coverageAtTrough > 0.25, `${result.label}: coverage should remain present at the trough`)
}
writeFileSync('experiments/field-visual-qa/artifacts/band-probe.json', JSON.stringify(report, null, 2))
console.log('Deterministic trough probe passed: phase-modulated values are <0.01 while envelope coverage remains >0.25.')
console.log(JSON.stringify(report.map((item) => ({ label: item.label, fieldAtCameraTarget: item.fieldAtCameraTarget, unmodulatedCoverageAtCameraTarget: item.unmodulatedCoverageAtCameraTarget, fieldAtTrough: item.fieldAtTrough, coverageAtTrough: item.coverageAtTrough })), null, 2))
