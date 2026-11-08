import { describe, expect, it } from 'vitest'
import { buildGlobalStories, storyTokens } from './globalStories'
import type { NewsItemInput, NewsSourceMeta } from './newsDigest'
import { parseNewsEntry as parseInTheNews } from '../../main/news/inTheNews'

const now = Date.parse('2026-10-27T00:00:00Z')
const source = (id: string, country: string, language = 'en', scope: NewsSourceMeta['scope'] = 'national'): NewsSourceMeta =>
  ({ sourceId: id, countryCode: country, publisherName: id.toUpperCase(), publisherGroupId: id, scope, language })
const item = (sourceId: string, title: string, hoursAgo = 2): NewsItemInput =>
  ({ sourceId, title, url: `https://${sourceId}.example/${encodeURIComponent(title)}`, publishedAt: new Date(now - hoursAgo * 3_600_000).toISOString(), discoveredAt: new Date(now).toISOString() })

describe('global stories', () => {
  const sources = [
    source('ke-nation', 'KE'), source('za-news24', 'ZA'), source('in-hindu', 'IN'), source('ph-inquirer', 'PH'), source('ng-punch', 'NG'),
    source('es-pais', 'ES', 'es'), source('intl-bbc', 'GB', 'en', 'international'), source('intl-dw', 'DE', 'en', 'international'), source('us-local', 'US'),
  ]
  const items: NewsItemInput[] = [
    item('ke-nation', 'Pope Leo calls for ceasefire in Sudan during Kenya visit'),
    item('za-news24', 'In Nairobi, Pope Leo urges Sudan ceasefire'),
    item('in-hindu', 'Pope Leo appeals for Sudan peace from Nairobi'),
    item('ph-inquirer', 'Pope Leo, in Kenya, urges an end to Sudan war'),
    item('es-pais', 'El papa León pide un alto el fuego en Sudán desde Nairobi'),
    item('intl-bbc', 'Pope Leo urges Sudan ceasefire on first Africa trip'),
    item('intl-dw', 'Pope Leo in Kenya: calls for Sudan truce'),
    item('ng-punch', 'Pope Leo arrives in Nairobi for Africa tour'),
    // A local-only story: many headlines but one country.
    ...Array.from({ length: 6 }, (_, i) => item('us-local', `Springfield council approves Maple Street budget plan ${i}`)),
    // Background noise
    item('ke-nation', 'Nairobi traffic jams worsen ahead of holidays'),
    item('za-news24', 'Springbok squad named for November tests'),
    item('in-hindu', 'Monsoon rains flood parts of Chennai'),
    item('ph-inquirer', 'Typhoon warning raised for Luzon provinces'),
    item('ng-punch', 'Naira steadies against dollar'),
    item('es-pais', 'Madrid aprueba nuevos presupuestos'),
    item('intl-bbc', 'Old story about Mars rover', 40),
  ]
  const stories = buildGlobalStories({ sources, items, now })

  it('finds the story many countries covered, and ranks it first', () => {
    expect(stories.length).toBeGreaterThanOrEqual(1)
    const [top] = stories
    expect(top!.terms).toEqual(expect.arrayContaining(['pope', 'sudan']))
    expect(top!.countries.length).toBeGreaterThanOrEqual(6)
    expect(top!.internationalDesks).toBe(2)
    // English headline with the story's words, from an international desk if possible.
    expect(top!.title).toMatch(/Pope Leo/)
    expect(new Set(top!.headlines.map((headline) => headline.publisher)).size).toBe(top!.headlines.length)
  })

  it('ignores stories from one country and old headlines', () => {
    expect(stories.some((story) => story.terms.includes('springfield'))).toBe(false)
    expect(stories.some((story) => story.title.includes('Mars'))).toBe(false)
  })

  it('keeps the story’s own headline among its sources, even when its outlet has a newer one', () => {
    // France 24 has an English and a Spanish desk (one outlet): the English headline is the title, the Spanish one is newer.
    const desk = (id: string, language: string): NewsSourceMeta => ({ sourceId: id, countryCode: 'FR', publisherName: id === 'f24-en' ? 'France 24' : 'France 24 (ES)', publisherGroupId: 'france24', scope: 'international', language })
    const paraguay = [
      source('py-abc', 'PY', 'es'), source('ar-clarin', 'AR', 'es'), source('br-folha', 'BR', 'pt'), source('uy-pais', 'UY', 'es'), source('cl-tercera', 'CL', 'es'),
      desk('f24-en', 'en'), desk('f24-es', 'es'),
    ]
    const news = [
      item('py-abc', 'La fiscalía imputa a Santiago Peña por el colapso de Ueno Bank y pide su prisión preventiva', 3),
      item('ar-clarin', 'El expresidente paraguayo Santiago Peña fue imputado por la caída del banco Ueno Bank', 3),
      item('br-folha', 'Ex-presidente Santiago Peña é acusado pelo colapso do Ueno Bank e pode ser preso', 3),
      item('uy-pais', 'Imputaron al expresidente Santiago Peña por el escándalo del banco Ueno Bank', 3),
      item('cl-tercera', 'La justicia paraguaya imputa a Santiago Peña por la quiebra de Ueno Bank', 3),
      item('f24-en', 'Paraguay’s prosecutors charge Santiago Peña and seek his detention over the Ueno Bank collapse', 4),
      item('f24-es', 'El expresidente Santiago Peña queda en prisión preventiva por el caso Ueno Bank', 1),
      ...['Lluvias en Lima', 'Inflación en Chile', 'Elecciones en Bolivia', 'Fútbol: Peñarol campeón', 'Sequía en Uruguay', 'Precio del dólar hoy'].map((title, i) => item(['py-abc', 'ar-clarin', 'cl-tercera', 'uy-pais', 'br-folha', 'f24-es'][i]!, title)),
    ]
    const story = buildGlobalStories({ sources: paraguay, items: news, now }).find((entry) => entry.terms.includes('ueno'))!
    expect(story.title).toMatch(/^Paraguay’s prosecutors charge/)
    // The sources carousel translates its title as one of its cards (and The history behind it reads its language).
    const own = story.headlines.find((headline) => headline.url === story.url)
    expect(own?.title).toBe(story.title)
    expect(own?.lang).toBe('en')
    expect(new Set(story.headlines.map((headline) => headline.publisher)).size).toBe(story.headlines.length)
  })

  it('tokenises without stop words or accents', () => {
    expect(storyTokens('El papa León pide un alto el fuego en Sudán')).toEqual(expect.arrayContaining(['papa', 'leon', 'sudan']))
    expect(storyTokens('The president says he will resign')).toEqual(['resign'])
  })

  it('parses Wikipedia In the news entries', () => {
    const entry = parseInTheNews({
      story: '<!--Oct 25-->In <b id="x"><a rel="mw:WikiLink" href="./2026_Serbian_parliamentary_election" title="2026 Serbian parliamentary election">the Serbian parliamentary election</a></b>, the &amp; list wins.',
      links: [{ normalizedtitle: '2026 Serbian parliamentary election', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/2026_Serbian_parliamentary_election' } } }, { title: 'Evil', content_urls: { desktop: { page: 'https://evil.example/' } } }],
    })
    expect(entry).toEqual({
      date: 'Oct 25',
      story: 'In the Serbian parliamentary election, the & list wins.',
      mainTitle: '2026 Serbian parliamentary election',
      links: [{ title: '2026 Serbian parliamentary election', url: 'https://en.wikipedia.org/wiki/2026_Serbian_parliamentary_election' }],
    })
  })
})
