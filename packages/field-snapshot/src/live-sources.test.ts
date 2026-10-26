import { describe, expect, it } from 'vitest'
import { recordsFromEonet, weightFromEonet } from './eonet'
import { recordsFromQuakes } from './usgs'
import { parseFieldSnapshot, publicFieldSnapshot } from './wikipedia'
import {
  pageInfoFromPayload,
  READING_NOW_TOPIC,
  recordsFromTopArticles,
  topArticlesFromPayload,
  viewsByTitle,
  wikipediaPageInfoUrl,
  wikipediaTopUrl,
} from './wikipedia-top'

const retrievedAt = '2026-10-26T12:00:00.000Z'
const day = new Date('2026-10-25T00:00:00.000Z')

const topPayload = {
  items: [{
    project: 'en.wikipedia',
    articles: [
      { article: 'Main_Page', views: 7_000_000, rank: 1 },
      { article: 'Special:Search', views: 900_000, rank: 2 },
      { article: 'Wikipedia:Featured_pictures', views: 500_000, rank: 3 },
      { article: 'Kehlsteinhaus', views: 120_000, rank: 4 },
      { article: 'Ansel_Adams', views: 400_000, rank: 5 },
      { article: 'United_States', views: 90_000, rank: 6 },
      { article: 'USA', views: 10_000, rank: 7 },
    ],
  }],
}

const infoPayload = {
  batchcomplete: true,
  query: {
    normalized: [{ from: 'Kehlsteinhaus', to: 'Kehlsteinhaus' }],
    redirects: [{ from: 'USA', to: 'United States' }],
    pages: [
      {
        title: 'Kehlsteinhaus',
        coordinates: [{ lat: 47.6115, lon: 13.0421, primary: true, globe: 'earth' }],
        description: 'Nazi-era chalet in Obersalzberg, Germany',
        thumbnail: { source: 'https://upload.wikimedia.org/k.jpg', width: 320, height: 200 },
      },
      { title: 'Ansel Adams', description: 'American photographer' },
      {
        title: 'United States',
        coordinates: [{ lat: 40, lon: -100, primary: true, globe: 'earth' }],
        description: 'Country primarily in North America',
        thumbnail: { source: 'http://insecure.example/flag.png' },
      },
      { title: 'Olympus Mons', coordinates: [{ lat: 18, lon: 226, globe: 'mars' }] },
    ],
  },
}

describe('reading now day-over-day', () => {
  it('records the previous day views, or null when new to the list', () => {
    const top = topArticlesFromPayload(topPayload)
    const pages = pageInfoFromPayload(infoPayload)
    const previous = viewsByTitle([{ title: 'Kehlsteinhaus', views: 1200, rank: 40 }])
    const records = recordsFromTopArticles(top, pages, day, retrievedAt, undefined, previous)
    expect(records.find((record) => record.title === 'Kehlsteinhaus')?.previousValue).toBe(1200)
    expect(records.find((record) => record.title === 'United States')?.previousValue).toBeNull()
    // Without a previous list there is no comparison at all.
    expect(recordsFromTopArticles(top, pages, day, retrievedAt)[0]!.previousValue).toBeUndefined()
  })

  it('validates previousValue through the snapshot parser', () => {
    const top = topArticlesFromPayload(topPayload)
    const records = recordsFromTopArticles(top, pageInfoFromPayload(infoPayload), day, retrievedAt, undefined, viewsByTitle([{ title: 'Kehlsteinhaus', views: 1200, rank: 1 }]))
    const snapshot = publicFieldSnapshot(records, Date.parse(retrievedAt), true)
    const parsed = parseFieldSnapshot(JSON.stringify(snapshot))!
    expect(parsed.sources.find((source) => source.title === 'Kehlsteinhaus')?.previousValue).toBe(1200)
    expect(parsed.sources.find((source) => source.title === 'United States')?.previousValue).toBeNull()
    const tampered = JSON.parse(JSON.stringify(snapshot)) as { sources: Array<Record<string, unknown>> }
    tampered.sources[0]!['previousValue'] = -5
    expect(parseFieldSnapshot(JSON.stringify(tampered))!.sources[0]!.previousValue).toBeUndefined()
  })
})

describe('reading now (Wikipedia top pageviews)', () => {
  it('drops the main page and non-article namespaces', () => {
    const top = topArticlesFromPayload(topPayload)
    expect(top.map((article) => article.title)).toEqual(['Kehlsteinhaus', 'Ansel Adams', 'United States', 'USA'])
    expect(topArticlesFromPayload({ nope: true })).toEqual([])
  })

  it('maps only articles with their own Earth coordinates', () => {
    const top = topArticlesFromPayload(topPayload)
    const pages = pageInfoFromPayload(infoPayload)
    expect(pages.get('USA')?.title).toBe('United States')
    expect(pages.has('Ansel Adams')).toBe(false)
    expect(pages.has('Olympus Mons')).toBe(false)
    const records = recordsFromTopArticles(top, pages, day, retrievedAt)
    expect(records.map((record) => record.title)).toEqual(['Kehlsteinhaus', 'United States'])
    const [chalet, country] = records
    expect(chalet).toMatchObject({
      id: 'wikitop-Kehlsteinhaus',
      topics: [READING_NOW_TOPIC],
      url: 'https://en.wikipedia.org/wiki/Kehlsteinhaus',
      licence: 'cc-by-sa',
      summary: 'Nazi-era chalet in Obersalzberg, Germany',
      thumbnail: 'https://upload.wikimedia.org/k.jpg',
      measurement: {
        kind: 'wikimedia-pageviews',
        value: 120_000,
        unit: 'pageviews',
        sourceId: 'wikimedia-top-pageviews-en',
        windowStart: '20261025',
        windowEnd: '20261025',
        scale: 'utc-day',
      },
    })
    // The redirect does not add a second record or its views.
    expect(country?.measurement.value).toBe(90_000)
    expect(country?.thumbnail).toBeUndefined()
  })

  it('builds the expected endpoints', () => {
    expect(wikipediaTopUrl(day)).toBe('https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/10/25')
    const url = new URL(wikipediaPageInfoUrl(['A', 'B']))
    expect(url.searchParams.get('titles')).toBe('A|B')
    expect(url.searchParams.get('colimit')).toBe('max')
  })
})

const eonetPayload = {
  events: [
    {
      id: 'EONET_1',
      title: 'Tropical Cyclone Arnab',
      link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1',
      closed: null,
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/products/io0226.tcw' }],
      geometry: [
        { magnitudeValue: 35, magnitudeUnit: 'kts', date: '2026-10-25T18:00:00Z', type: 'Point', coordinates: [89.3, 15.6] },
        { magnitudeValue: 80, magnitudeUnit: 'kts', date: '2026-10-26T12:00:00Z', type: 'Point', coordinates: [87.2, 15.9] },
      ],
    },
    {
      id: 'EONET_2',
      title: 'Iceberg A23A',
      link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_2',
      categories: [{ id: 'seaLakeIce', title: 'Sea and Lake Ice' }],
      sources: [{ id: 'NATICE', url: 'http://insecure.example/iceberg' }],
      geometry: [{ date: '2026-10-20T00:00:00Z', type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }],
    },
    { id: 'EONET_3', title: 'No geometry', categories: [{ id: 'wildfires', title: 'Wildfires' }], sources: [], geometry: [] },
    { id: 'EONET_4', title: 'Bad category', categories: [{ id: '../x', title: 'X' }], link: 'https://x.test', geometry: [{ date: '2026-10-20T00:00:00Z', type: 'Point', coordinates: [1, 1] }] },
  ],
}

describe('NASA EONET natural events', () => {
  it('uses the latest geometry, an https source link and a per-category topic', () => {
    const records = recordsFromEonet(eonetPayload, retrievedAt)
    expect(records.map((record) => record.id)).toEqual(['eonet-EONET_1', 'eonet-EONET_2'])
    const [storm, ice] = records
    expect(storm).toMatchObject({
      lat: 15.9,
      lon: 87.2,
      url: 'https://www.metoc.navy.mil/jtwc/products/io0226.tcw',
      topics: ['natural-severeStorms'],
      licence: 'public-domain',
      publishedAt: '2026-10-26T12:00:00.000Z',
      summary: 'Severe Storms · reported by JTWC',
      measurement: { kind: 'nasa-eonet-event', value: 80, unit: 'kts', scale: 'severeStorms' },
    })
    expect(storm?.weight).toBe(weightFromEonet(80))
    // Polygon centroid excludes the closing vertex; insecure source falls back to the EONET link.
    expect(ice).toMatchObject({ lat: 1, lon: 1, url: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_2', topics: ['natural-seaLakeIce'] })
    expect(ice?.measurement).toMatchObject({ value: null, unit: 'event' })
    expect(recordsFromEonet({}, retrievedAt)).toEqual([])
  })
})

describe('live snapshot round trip', () => {
  it('keeps optional display details and separates the three measurement groups', () => {
    const reading = recordsFromTopArticles(topArticlesFromPayload(topPayload), pageInfoFromPayload(infoPayload), day, retrievedAt)
    const quakes = recordsFromQuakes({
      features: [{
        id: 'us1',
        geometry: { type: 'Point', coordinates: [139.7, 35.6, 10.4] },
        properties: { mag: 5.6, magType: 'mww', place: 'near Tokyo, Japan', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1', time: Date.parse('2026-10-26T01:00:00Z'), type: 'earthquake' },
      }],
    }, retrievedAt)
    expect(quakes[0]).toMatchObject({ placeLabel: 'near Tokyo, Japan', summary: 'M5.6 earthquake · 10 km deep' })
    const natural = recordsFromEonet(eonetPayload, retrievedAt)
    const snapshot = publicFieldSnapshot([...reading, ...quakes, ...natural], Date.parse(retrievedAt), true)
    expect(snapshot.coverageNote).toContain('most-read')
    expect(snapshot.coverageNote).toContain('USGS')
    expect(snapshot.coverageNote).toContain('EONET')
    expect(new Set(snapshot.bands.map((band) => band.measurement.kind))).toEqual(
      new Set(['wikimedia-pageviews', 'usgs-earthquake-magnitude', 'nasa-eonet-event']),
    )
    const parsed = parseFieldSnapshot(JSON.stringify(snapshot))
    expect(parsed?.sources.find((source) => source.id === 'wikitop-Kehlsteinhaus')).toMatchObject({
      summary: 'Nazi-era chalet in Obersalzberg, Germany',
      thumbnail: 'https://upload.wikimedia.org/k.jpg',
    })
    expect(parsed?.sources.find((source) => source.id === 'usgs-us1')?.placeLabel).toBe('near Tokyo, Japan')
    expect(parsed?.sources.find((source) => source.id === 'eonet-EONET_1')?.measurement.kind).toBe('nasa-eonet-event')
  })

  it('drops invalid optional details without rejecting the record', () => {
    const [record] = recordsFromEonet(eonetPayload, retrievedAt)
    const tampered = {
      ...publicFieldSnapshot([record!], Date.parse(retrievedAt)),
    }
    const raw = JSON.parse(JSON.stringify(tampered)) as { sources: Record<string, unknown>[] }
    Object.assign(raw.sources[0]!, {
      summary: 'x'.repeat(400),
      placeLabel: 42,
      thumbnail: 'javascript:alert(1)',
      endedAt: 'not a date',
    })
    const parsed = parseFieldSnapshot(JSON.stringify(raw))
    const source = parsed?.sources[0]
    expect(source?.summary).toHaveLength(280)
    expect(source?.placeLabel).toBeUndefined()
    expect(source?.thumbnail).toBeUndefined()
    expect(source?.endedAt).toBeUndefined()
  })
})

describe('EONET shared bulletins', () => {
  it('keeps distinct events that cite the same source page', () => {
    const shared = (id: string, lon: number) => ({
      id, title: `Iceberg ${id}`, link: `https://eonet.gsfc.nasa.gov/api/v3/events/${id}`,
      categories: [{ id: 'seaLakeIce', title: 'Sea and Lake Ice' }],
      sources: [{ id: 'NATICE', url: 'https://usicecenter.gov/pub/Iceberg_Tabular.csv' }],
      geometry: [{ date: '2026-10-20T00:00:00Z', type: 'Point', coordinates: [lon, -70] }],
    })
    const records = recordsFromEonet({ events: [shared('A', 10), shared('B', 20)] }, retrievedAt)
    expect(new Set(records.map((record) => record.url)).size).toBe(2)
    expect(publicFieldSnapshot(records, Date.parse(retrievedAt)).sources).toHaveLength(2)
  })
})
