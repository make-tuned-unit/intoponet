import { publicFieldSnapshot } from '@intoponet/field-snapshot'
import type { SourceRecord } from '@intoponet/field-snapshot'

const stamp = '2026-10-23T00:00:00.000Z'

const wikiRecord = (id: string, title: string, lat: number, lon: number, weight: number): SourceRecord => ({
  id,
  kind: 'public-record',
  title,
  url: `https://${id}.fixtures.intoponet.test/article`,
  licence: 'cc-by',
  attribution: 'Fixed render fixture; not a live public source',
  retrievedAt: stamp,
  lat,
  lon,
  radiusKm: 20,
  topics: ['open-knowledge'],
  weight,
  publishedAt: stamp,
  measurement: {
    kind: 'wikimedia-pageviews',
    value: weight * 100,
    unit: 'pageviews',
    sourceId: 'fixed-visual-fixture',
    sourceUrl: 'https://www.wikimedia.org/',
    transformation: 'fixed deterministic screenshot input',
  },
})

const records: SourceRecord[] = [
  wikiRecord('nyc-west', 'New York west fixture point', 40.7, -78.2, 2.4),
  wikiRecord('nyc-center', 'New York center fixture point', 40.7, -74, 4.8),
  wikiRecord('nyc-east', 'New York east fixture point', 40.7, -69.8, 1.8),
  {
    ...wikiRecord('nyc-quake', 'New York seismic fixture point', 40.8, -73.9, 2.5),
    measurement: {
      kind: 'usgs-earthquake-magnitude',
      value: 5.2,
      unit: 'magnitude',
      sourceId: 'fixed-usgs-visual-fixture',
      sourceUrl: 'https://earthquake.usgs.gov/',
      transformation: 'fixed deterministic screenshot input',
      scale: 'ml',
    },
  },
]

const aggregated = publicFieldSnapshot(records, Date.parse(stamp), true)
export const publicSnapshotFixture = {
  ...aggregated,
  coverageNote: 'Deterministic public-record render fixture using fixed Wikimedia and USGS examples. Not public activity.',
}
