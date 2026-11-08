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

  // Live headlines from 8 November 2026 (country or desk, language, outlet, headline).
  const live = (rows: Array<[string, string, string, string]>): { sources: NewsSourceMeta[]; items: NewsItemInput[] } => {
    const sources = new Map<string, NewsSourceMeta>()
    const items = rows.map(([where, language, outlet, title], i) => {
      if (!sources.has(outlet)) sources.set(outlet, where === 'intl' ? source(outlet, 'GB', language, 'international') : source(outlet, where, language))
      return item(outlet, title, 1 + (i % 6))
    })
    return { sources: [...sources.values()], items }
  }
  const paraguay: Array<[string, string, string, string]> = [
    // Told as the bank's collapse…
    ['intl', 'en', 'bbc', "Paraguay's former president charged after bank collapse"],
    ['GH', 'en', 'gbc-ghana', 'Paraguay’s president impeached and under house arrest after bank collapse'],
    ['GT', 'es', 'la-hora-gt', 'Ueno Bank: cerca de 1.2 millones de clientes reciben la devolución de sus fondos en Paraguay'],
    ['PA', 'es', 'corprensa', 'Cerca de 1.2 millones de clientes de Ueno bank en Paraguay han recibido sus fondos'],
    ['PA', 'es', 'tvn-media', "'Perdí 16 años de trabajo': el desconsuelo de los ahorristas de Ueno Bank en Paraguay"],
    ['US', 'en', 'pbs', "Paraguay's ousted president charged with crimes linked to collapse of major bank"],
    ['CO', 'es', 'co-elheraldo', 'Cerca de 1,2 millones de clientes de Ueno bank en Paraguay han recibido ya sus fondos'],
    ['SA', 'en', 'okaz', 'Paraguay’s ousted president ordered detained over bank collapse as financial crisis deepens'],
    // …as the former president's arrest…
    ['intl', 'fr', 'france24', 'Paraguay: le président destitué Santiago Peña placé en détention préventive'],
    ['intl', 'pt', 'globo-mundo', 'Justiça do Paraguai decreta prisão preventiva de ex-presidente Santiago Peña'],
    ['AG', 'en', 'antigua-news', 'Paraguay President Santiago Peña Impeached and Arrested Amid Massive Banking Scandal'],
    ['CR', 'es', 'grupo-nacion', 'Expresidente de Paraguay Santiago Peña queda detenido, imputado por crisis bancaria'],
    ['DO', 'es', 'diario-libre', 'Santiago Peña prisión preventiva por crisis bancaria en Paraguay'],
    ['PY', 'es', 'grupo-zuccolillo', 'Santiago Peña se expone a 15 años de cárcel, según hechos imputados por Fiscalía'],
    ['PY', 'es', 'grupo-zuccolillo', 'Santiago Peña: por razones de seguridad, su declaración se traslada a la Fiscalía General del Estado'],
    ['intl', 'es', 'infobae-america', 'Crisis en Paraguay: Santiago Peña permanecerá en prisión preventiva en el Regimiento Escolta Presidencial de Asunción'],
    // …and as both.
    ['BO', 'es', 'opinion-bo', 'Paraguay: Santiago Peña comparece ante la Fiscalía por el caso Ueno bank'],
    ['NI', 'es', 'confidencial-ni', 'Expresidente Santiago Peña comparece ante la Fiscalía de Paraguay por el caso Ueno bank'],
    ['PA', 'es', 'corprensa', 'Fiscalía de Paraguay pide prisión preventiva contra Santiago Peña por el caso Ueno bank'],
    ['BJ', 'fr', 'benin-web-tv', 'Paraguay : Santiago Peña placé en détention provisoire dans l’affaire Ueno Bank'],
    ['DO', 'es', 'n-digital', 'Expresidente de Paraguay Santiago Peña queda en prisión preventiva por caso Ueno Bank'],
    ['HN', 'es', 'proceso-digital-hn', 'La Fiscalía de Paraguay pide prisión preventiva contra Santiago Peña por el caso Ueno bank'],
    ['CL', 'es', 'grupo-copesa', 'Paraguay: Defensa de Peña cuestiona prisión preventiva y descarta responsabilidad del exmandatario en crisis de Ueno Bank'],
    ['PE', 'es', 'pe-eltiempo-piura', 'Paraguay: Santiago Peña es destituido por el Congreso y detenido por investigación vinculada a Ueno Bank'],
  ]
  const football: Array<[string, string, string, string]> = [
    ['UG', 'en', 'nile-post', 'Real Madrid beat Valencia to move level on points with leaders Barcelona'],
    ['BA', 'bs', 'united-media-n1', 'Real Madrid upisao nova tri boda na Mestalli i izjednačio se sa vodećom Barcelonom (VIDEO)'],
    ['BH', 'en', 'daily-tribune-bh', 'Real Madrid deliver emphatic 3–0 win over Valencia'],
    ['HN', 'es', 'proceso-digital-hn', '0-3. El Real Madrid sigue con su racha triunfal en Mestalla y acecha al liderato'],
    ['OM', 'en', 'muscat-media-group', 'La Liga: Valverde, Guler and Mbappe fire Real Madrid to 3-0 win over Valencia'],
    ['PA', 'es', 'tvn-media', 'LaLiga| Real Madrid alcanza al Barcelona con tres puntos sacados de Valencia'],
    ['GH', 'en', 'multimedia-group-ghana', 'Real Madrid beat Valencia to move level on points with leaders Barcelona'],
    ['PA', 'es', 'epasa', 'Real Madrid derrota 3-0 al Valencia y suma ocho triunfos consecutivos'],
    ['intl', 'fr', 'france24', "Espagne : pluie d'hommages au joueur Jesus de Miguel, décédé après un choc violent sur le terrain"],
    ['DO', 'es', 'n-digital', 'Fútbol español despide a Jesús de Miguel con emotivo homenaje en Tenerife'],
    ['NI', 'es', 'despacho-505', 'El mundo del fútbol despide a Jesús de Miguel en un acto multitudinario en el Heliodoro'],
    ['PR', 'es', 'metro-pr', 'El mundo del fútbol despide a Jesús de Miguel en acto multitudinario'],
    ['VE', 'es', 've-lanacionweb', 'El mundo del fútbol despide a Jesús de Miguel en un acto multitudinario'],
    ['ES', 'es', 'elespanol', 'Granada y Tenerife se unen en un emotivo homenaje a Jesús de Miguel en Los Cármenes'],
    // Two headlines name both: a tribute at a match is not the match.
    ['CR', 'es', 'grupo-nacion', 'El Real Madrid alcanza al Barcelona en una jornada de homenajes a Jesús de Miguel'],
    ['PR', 'es', 'metro-pr', 'Valencia y Real Madrid homenajean a Jesús de Miguel en Mestalla'],
  ]

  it('lists a story told two ways (the bank’s collapse, the former president’s arrest) once', () => {
    const { sources: outlets, items: news } = live([...paraguay, ...football])
    const stories = buildGlobalStories({ sources: outlets, items: news, now })
    const about = stories.filter((story) => story.terms.some((term) => ['ueno', 'pena', 'santiago', 'paraguay', 'bank'].includes(term)))
    expect(about).toHaveLength(1)
    const titles = about[0]!.headlines.map((headline) => headline.title)
    expect(titles.some((title) => /bank collapse|clientes de Ueno/i.test(title) && !/Peña/.test(title))).toBe(true)
    expect(titles.some((title) => /Peña/.test(title) && !/Ueno/i.test(title))).toBe(true)
    expect(new Set(stories.map((story) => story.title)).size).toBe(stories.length)
  })

  it('keeps two stories apart when only a couple of headlines name both', () => {
    const { sources: outlets, items: news } = live([...paraguay, ...football])
    const stories = buildGlobalStories({ sources: outlets, items: news, now })
    const match = stories.filter((story) => story.terms.includes('madrid'))
    const tribute = stories.filter((story) => story.terms.includes('miguel'))
    expect(match).toHaveLength(1)
    expect(tribute).toHaveLength(1)
    expect(match[0]).not.toBe(tribute[0])
    expect(stories.some((story) => story.terms.includes('madrid') && story.terms.includes('ueno'))).toBe(false)
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
