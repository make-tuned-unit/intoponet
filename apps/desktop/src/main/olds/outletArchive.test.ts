import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coverageOutlet, parseOldsCommand } from '@intoponet/browser-api'
import { articleKeywords, articleTopics, cardDate, chooseTopics, classifyHeadlines, decodeCursor, encodeCursor, extractHeadlines, isStoryTag, outletFor, OutletArchive, parseCdx, storyOverlap } from './outletArchive'

const aljazeera = outletFor('https://www.aljazeera.com/news/2026/11/6/x')!
const bbc = outletFor('https://www.bbc.co.uk/news/articles/c0abc123def')!
const dw = outletFor('https://www.dw.com/en/x/a-1')!

describe('outletFor', () => {
  it('knows the ten outlets and nothing else', () => {
    expect(outletFor('https://www.bbc.com/news/articles/x')?.id).toBe('bbc')
    expect(outletFor('https://www.npr.org/2026/11/05/x/y')?.id).toBe('npr')
    expect(outletFor('https://www.abc.net.au/news/2026-11-06/x/1')?.id).toBe('abc-au')
    expect(outletFor('https://www.theguardian.com/world/sudan')).toBeNull()
    expect(outletFor('https://notbbc.com/news')).toBeNull()
    expect(outletFor('not a url')).toBeNull()
  })
})

describe('the coverage command', () => {
  it('accepts an article, a headline and a cursor, and nothing else', () => {
    expect(parseOldsCommand({ type: 'coverage', query: { url: 'https://www.bbc.com/news/articles/x', headline: '  Sudan  war ', cursor: '0@2024-05-01;1@2023-11-20' } })).toEqual({ type: 'coverage', query: { url: 'https://www.bbc.com/news/articles/x', headline: 'Sudan war', cursor: '0@2024-05-01;1@2023-11-20' } })
    expect(() => parseOldsCommand({ type: 'coverage', query: { url: 'file:///etc/passwd', headline: 'x' } })).toThrow()
    expect(() => parseOldsCommand({ type: 'coverage', query: { url: 'https://www.bbc.com/', headline: '' } })).toThrow()
    expect(() => parseOldsCommand({ type: 'coverage', query: { url: 'https://www.bbc.com/', headline: 'x', cursor: '../../x' } })).toThrow()
  })
  it('names the outlet from the article’s address', () => {
    expect(coverageOutlet('https://www.aljazeera.com/news/2026/1/1/x')).toEqual({ id: 'aljazeera', name: 'Al Jazeera' })
    expect(coverageOutlet('https://www.nytimes.com/2026/01/01/world/x.html')).toBeNull()
  })
})

describe('articleKeywords', () => {
  it('reads metas and JSON-LD, split and de-duplicated', () => {
    const html = `<meta name="keywords" content="News, Sudan, RSF &amp; army"><meta property="article:tag" content="Sudan war"><script type="application/ld+json">{"keywords":["Sudan","Darfur"]}</script>`
    expect(articleKeywords(html)).toEqual(['News', 'Sudan', 'RSF & army', 'Sudan war', 'Darfur'])
  })
  it('reads Euronews-style keyword objects', () => {
    expect(articleKeywords('{"keywords":[{"slug":"west-bank","title":"West Bank"},{"slug":"israel","title":"Israel"}]}')).toEqual(['West Bank', 'Israel'])
  })
})

describe('articleTopics and chooseTopics', () => {
  const page = `
    <nav><a href="/en/us-midterm-elections-2026/t-79721845">US midterms</a><a href="/en/artificial-intelligence/t-42133476">AI</a></nav>
    <p>A court in Macau, the <a href="/en/china/t-18480887">Chinese territory's</a> gambling hub, jailed a former lawmaker for subversion in its first national security trial.</p>
    <p>Rights groups said the national security law in Macau mirrors the one in Hong Kong and China, and the trial in Macau was closed.</p>`
  it('keeps topics the text links to, drops site navigation', () => {
    const candidates = articleTopics(page, 'https://www.dw.com/en/x/a-1', dw, [])
    expect(candidates.find((item) => item.url.endsWith('/china/t-18480887'))).toMatchObject({ label: 'China', inText: true })
    const trump = articleTopics('<p>The deal was announced by <a href="/en/us-president-donald-trump-russia-ukraine-israel-gaza-tariffs-trade-war/t-1">US President Donald Trump</a> on Friday after talks.</p>', 'https://www.dw.com/en/x/a-1', dw, [])
    expect(trump[0]?.label).toBe('US President Donald Trump')
    const chosen = chooseTopics(candidates, "Ex-lawmaker jailed in Macau's first national security trial", page.replace(/<[^>]+>/g, ' '), [])
    expect(chosen.map((item) => item.label)).toEqual(['China'])
  })

  it('maps keywords to topic pages (countries to "where" pages) and ranks the story tag first', () => {
    const html = '<meta name="keywords" content="News, Military, US-Israel war on Iran, Iran, Iraq, Middle East">'
    const keywords = articleKeywords(html)
    const candidates = articleTopics(html, 'https://www.aljazeera.com/news/2026/11/6/x', aljazeera, keywords)
    expect(candidates.map((item) => item.url)).toContain('https://www.aljazeera.com/where/iraq/')
    expect(candidates.map((item) => item.url)).toContain('https://www.aljazeera.com/tag/us-israel-war-on-iran/')
    const chosen = chooseTopics(candidates, 'Iraq’s al-Zaidi talks to Trump as Baghdad seeks to stay out of war on Iran', 'Iraq wants to stay out of the war on Iran. The war on Iran has drawn in the region.', keywords)
    expect(chosen.map((item) => item.label)).toEqual(['US-Israel war on Iran', 'Iraq'])
    expect(chosen.some((item) => /News|Military|Middle East/.test(item.label))).toBe(false)
  })
})

describe('topic choice edge cases', () => {
  const abc = outletFor('https://www.abc.net.au/news/2026-11-06/x/1')!
  it('needs a short name ("US") in the story before following a link that the article does not tag', () => {
    const html = '<nav><a href="/news/topic/us-elections">US Elections</a></nav><p>The electoral commission reversed its decision to close the Kaniva polling booth after outrage in the tiny town.</p>'
    const chosen = chooseTopics(articleTopics(html, 'https://www.abc.net.au/news/2026-11-06/x/1', abc, []), 'Outrage from tiny town results in electoral commission backflip', 'The electoral commission reversed its decision to close the Kaniva polling booth after outrage in the tiny town.', [])
    expect(chosen.map((topic) => topic.label)).not.toContain('US Elections')
  })

  it('reads BBC’s own topic data and puts a running story first', () => {
    const html = String.raw`<a href="/news/topics/cmj34zmwm1zt">US midterms</a><script>{"topics":[{"title":"Stock markets","url":"/news/topics/cgdzpg5yvdvt","isEvent":false,"id":"cgdzpg5yvdvt"},{"title":"Sudan war","url":"/news/topics/c1yy8q1re0kt","isEvent":true,"id":"c1yy8q1re0kt"}]}</script>`
    const candidates = articleTopics(html, 'https://www.bbc.co.uk/news/articles/c0abc123def', bbc, [])
    expect(candidates.find((item) => item.label === 'Sudan war')).toMatchObject({ fromKeyword: true, event: true })
    const chosen = chooseTopics(candidates, 'Markets steady as Sudan war talks resume', 'Stock markets were steady. Sudan war talks resumed in Jeddah.', [])
    expect(chosen.map((topic) => topic.label)).toEqual(['Sudan war', 'Stock markets'])
  })

  it('ranks the country a headline names above a broad subject', () => {
    const euronews = outletFor('https://www.euronews.com/2026/11/05/x')!
    const keywords = ['Banking', 'Paraguay', 'Impeachment']
    const chosen = chooseTopics(articleTopics('', 'https://www.euronews.com/2026/11/05/x', euronews, keywords), 'Paraguayan president resigns amid bank collapse in Paraguay', 'Paraguay’s president resigned after the bank collapse. Paraguay is in turmoil.', keywords)
    expect(chosen[0]?.label).toBe('Paraguay')
  })
})

describe('cardDate', () => {
  it('reads datetime, written dates and relative dates against the page date', () => {
    expect(cardDate('<time datetime="2024-03-19T10:00:00Z">', '2024-04-01')).toBe('2024-03-19')
    expect(cardDate('<span>19 Mar 2026</span>', '2026-04-01')).toBe('2026-03-19')
    expect(cardDate('<span>March 5, 2025</span>', '2025-04-01')).toBe('2025-03-05')
    expect(cardDate('<span>2 days ago</span>', '2026-10-25')).toBe('2026-10-23')
    expect(cardDate('<span>5 hrs ago</span>', '2026-10-25')).toBe('2026-10-25')
    expect(cardDate('<span>No date</span>', '2026-10-25')).toBeNull()
  })
})

describe('extractHeadlines', () => {
  it('takes the heading inside a BBC card and the card date', () => {
    const html = `<a href="/news/articles/c0mjn0g708ro"><div><h2 data-testid="card-headline">Chad warns Sudan it will retaliate after drone strike</h2><p>Summary text here that is long.</p><span>19 Mar 2026</span></div></a>
      <a href="/news/world-africa-59364349"><h3>Sudan's military reinstates ousted civilian PM</h3></a><span>21 Nov 2021</span>
      <a href="/news/topics/c1yy8q1re0kt">Sudan crisis topic link should be ignored</a>
      <a href="https://www.bbc.com/sport/football/123">Football is not a news article on this page</a>`
    expect(extractHeadlines(html, 'https://www.bbc.com/news/topics/c1yy8q1re0kt', bbc, '2026-10-25')).toEqual([
      { title: 'Chad warns Sudan it will retaliate after drone strike', url: 'https://www.bbc.com/news/articles/c0mjn0g708ro', date: '2026-03-19', dated: 'published' },
      { title: "Sudan's military reinstates ousted civilian PM", url: 'https://www.bbc.com/news/world-africa-59364349', date: '2021-11-21', dated: 'published' },
    ])
  })

  it('dates Al Jazeera links from their paths, strips soft hyphens, drops short links and wayback prefixes', () => {
    const html = `<a href="https://web.archive.org/web/20230420000000/https://www.aljazeera.com/news/2023/4/19/thousands-flee">Thou­sands flee as new ceasefire attempt fails in Sudan</a>
      <a href="/news/2023/4/18/short">Short</a>
      <a href="/news/2023/4/19/thousands-flee?traffic_source=x"><img alt=""></a>`
    expect(extractHeadlines(html, 'https://www.aljazeera.com/where/sudan/', aljazeera, '2023-04-20')).toEqual([
      { title: 'Thousands flee as new ceasefire attempt fails in Sudan', url: 'https://www.aljazeera.com/news/2023/4/19/thousands-flee', date: '2023-04-19', dated: 'published' },
    ])
  })

  it('falls back to the capture date for undated links, and never dates after the capture', () => {
    const html = '<a href="/en/sudan-war-enters-third-year/a-123"><h3>Sudan war enters its third year with no end in sight</h3></a>'
    expect(extractHeadlines(html, 'https://www.dw.com/en/sudan/t-1', dw, '2025-04-15')[0]).toMatchObject({ date: '2025-04-15', dated: 'seen' })
  })
})

describe('listRegion', () => {
  const page = (main: string) => `<header><a href="/news/2026/11/1/sitewide-top-story"><h3>Sitewide top story that is not on the topic</h3></a></header><main>${main}<aside><a href="/news/2026/11/2/most-read"><h3>Most read story from somewhere else entirely</h3></a></aside></main><footer>x</footer>`
  it('reads the <main> list without asides', () => {
    const items = extractHeadlines(page('<a href="/news/2026/10/30/sudan-talks"><h3>Sudan war talks resume in Jeddah after pause</h3></a>'), 'https://www.euronews.com/tag/x', outletFor('https://www.euronews.com/x')!, '2026-11-05')
    expect(items.map((item) => item.title)).toEqual(['Sudan war talks resume in Jeddah after pause'])
  })
  it('follows an outlet’s own markers (Al Jazeera’s feed sits after <main>, before its sidebar)', () => {
    const html = '<main><ul class="themed-featured-posts-list"><a href="/news/2026/11/1/falklands-claim"><h3>Falklands claim: Can Argentina’s Milei use Trump ties</h3></a></ul></main><section class="section-feed"><a href="/news/2026/10/30/iran-talks"><h3>Iran and US envoys hold indirect talks in Doha</h3></a></section><div class="sidebar"><a href="/news/2026/11/2/most-read"><h3>Most read story from somewhere else entirely</h3></a></div>'
    expect(extractHeadlines(html, 'https://www.aljazeera.com/tag/x/', aljazeera, '2026-11-05').map((item) => item.title)).toEqual(['Iran and US envoys hold indirect talks in Doha'])
  })
  it('reads an older layout without markers whole', () => {
    const html = '<div><a href="/news/2016/6/1/old-story"><h3>Bashir back in Sudan despite court order</h3></a></div>'
    expect(extractHeadlines(html, 'https://www.aljazeera.com/topics/country/sudan.html', aljazeera, '2016-06-02')).toHaveLength(1)
  })
})

describe('storyOverlap and classifyHeadlines', () => {
  it('scores shared words, names double', () => {
    expect(storyOverlap('Sudan army retakes Khartoum airport', 'RSF drones strike Khartoum as Sudan war grinds on', []).score).toBeGreaterThanOrEqual(3)
    expect(storyOverlap('Kenya holds general election', 'RSF drones strike Khartoum as Sudan war grinds on', []).score).toBe(0)
  })

  it('does not count the topic’s own words, and halves words the whole page shares', () => {
    const headline = 'Mass protests sweep France as workers and students demand higher pay and funding'
    const titles = [
      'France braces for fresh protests as students resume school blockades',
      'Mass protests sweep Somalia after Israel recognises Somaliland',
      'French unions call fresh rallies and nationwide strike over pay',
      'Turkey’s youth rise up over mayor’s jailing',
      'Mali dissolves all political parties',
      'France reports 1,314 arrests after protests in France',
      'France launches probe after petrol bomb attack on police in France',
      'Paris march ends in clashes as France protests spread',
    ]
    expect(classifyHeadlines(titles, headline, ['France', 'Protests', 'Students', 'Salaries'], ['Protests'])).toEqual(['story', 'related', 'related', 'unrelated', 'unrelated', 'related', 'related', 'related'])
  })

  it('treats a running story’s own tag page as the story', () => {
    expect(isStoryTag('Sudan war')).toBe(true)
    expect(isStoryTag('US Midterm Elections 2026')).toBe(true)
    expect(isStoryTag('War in Ukraine')).toBe(true)
    expect(isStoryTag('US-Israel war on Iran')).toBe(true)
    expect(isStoryTag('Banking')).toBe(false)
    expect(isStoryTag('Protests')).toBe(false)
    expect(isStoryTag('Paraguay')).toBe(false)
    expect(isStoryTag('New Tech Economy')).toBe(false)
    expect(isStoryTag('US President Donald Trump')).toBe(false)
    expect(isStoryTag('Russias war in ukraine')).toBe(true)
    const headline = 'RSF drones strike Khartoum as Sudan war grinds on'
    expect(classifyHeadlines(['RSF shells El Fasher as Sudan war spreads west', 'Kenya votes in a tight race'], headline, [], ['Sudan war'], [true, true])).toEqual(['story', 'unrelated'])
  })
})

describe('parseCdx and the cursor', () => {
  it('parses index lines', () => {
    expect(parseCdx('20230416095328 https://www.aljazeera.com/where/sudan/ 200\nbad line\n20230501000000 https://www.aljazeera.com/where/sudan/ 200\n')).toEqual([
      { timestamp: '20230416095328', original: 'https://www.aljazeera.com/where/sudan/' },
      { timestamp: '20230501000000', original: 'https://www.aljazeera.com/where/sudan/' },
    ])
  })
  it('round-trips and rejects junk', () => {
    expect(decodeCursor(encodeCursor([{ topic: '0', before: '2024-05-01' }, { topic: '1', before: '2023-11-20' }]) ?? undefined)).toEqual([{ topic: '0', before: '2024-05-01' }, { topic: '1', before: '2023-11-20' }])
    expect(encodeCursor([])).toBeNull()
    expect(decodeCursor('x@2024')).toBeNull()
  })
})

describe('OutletArchive.coverage', () => {
  const articleUrl = 'https://www.aljazeera.com/news/2026/11/6/rsf-drones-strike-khartoum'
  const headline = 'RSF drones strike Khartoum as Sudan war grinds on'
  const articleHtml = '<meta name="keywords" content="News, Sudan war, Sudan, Africa"><p>The Sudan war has killed tens of thousands since fighting began between the army and the RSF.</p>'
  const topicPage = (items: Array<[string, string]>): string => items.map(([path, title]) => `<a href="${path}"><h3>${title}</h3></a>`).join('\n')
  const live = topicPage([
    ['/news/2026/11/1/rsf-shells-el-fasher', 'RSF shells El Fasher as Sudan war spreads west'],
    ['/news/2026/10/20/kenya-vote', 'Kenya votes in a tight general election race'],
  ])
  const capture2026 = topicPage([
    ['/news/2026/9/2/army-retakes-khartoum-airport', 'Sudan army retakes Khartoum airport from RSF'],
    ['/news/2026/6/15/sudan-talks', 'Sudan war talks in Jeddah collapse again'],
  ])
  const capture2025 = topicPage([['/news/2025/12/1/khartoum-siege', 'Khartoum siege enters its third month in Sudan war']])

  function setup(options: { cdxStatus?: number; refuse?: boolean } = {}) {
    const requests: string[] = []
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === articleUrl) return new Response(articleHtml)
      if (url.startsWith('https://www.aljazeera.com/tag/sudan-war/')) return new Response(live)
      if (url.startsWith('https://www.aljazeera.com/where/sudan/')) return new Response('<p>Nothing dated</p>')
      if (url.includes('/cdx/search/cdx')) {
        if (options.refuse) throw new TypeError('fetch failed')
        if (options.cdxStatus) return new Response('requires authorization', { status: options.cdxStatus })
        return new Response(url.includes('tag%2Fsudan-war') ? '20250105000000 https://www.aljazeera.com/tag/sudan-war/ 200\n20260910000000 https://www.aljazeera.com/tag/sudan-war/ 200\n' : '')
      }
      if (url.includes('20260910000000id_')) return new Response(capture2026)
      if (url.includes('20250105000000id_')) return new Response(capture2025)
      return new Response('', { status: 404 })
    }) as typeof fetch
    const archive = new OutletArchive({ cacheDir: mkdtempSync(join(tmpdir(), 'outlet-archive-')), fetchImpl, spacingMs: 0, now: () => Date.parse('2026-11-06T12:00:00Z') })
    return { archive, requests }
  }

  it('starts from the live topic page, then walks back through captures without gaps', async () => {
    const { archive, requests } = setup()
    const first = await archive.coverage({ url: articleUrl, headline })
    expect(first.status).toBe('ok')
    expect(first.topics[0]).toEqual({ label: 'Sudan war', url: 'https://www.aljazeera.com/tag/sudan-war/' })
    // The Kenya headline shares nothing with the story or its topics (a sidebar): left out.
    expect(first.items.map((item) => [item.date, item.story])).toEqual([['2026-11-01', true]])
    expect(requests.some((url) => url.includes('archive.org'))).toBe(false)
    // The live page reached back to 20 Oct, so the archive picks up before then: the September capture.
    const second = await archive.coverage({ url: articleUrl, headline, cursor: first.cursor! })
    expect(second.items.map((item) => item.date)).toEqual(['2026-09-02', '2026-06-15'])
    expect(second.items[0]!.archiveUrl).toBe('https://web.archive.org/web/20260902/https://www.aljazeera.com/news/2026/9/2/army-retakes-khartoum-airport')
    const third = await archive.coverage({ url: articleUrl, headline, cursor: second.cursor! })
    expect(third.items.map((item) => item.title)).toEqual(['Khartoum siege enters its third month in Sudan war'])
    expect(third.cursor).toBeNull()
  })

  it('reads each capture once', async () => {
    const { archive, requests } = setup()
    const first = await archive.coverage({ url: articleUrl, headline })
    await archive.coverage({ url: articleUrl, headline, cursor: first.cursor! })
    await archive.coverage({ url: articleUrl, headline, cursor: first.cursor! })
    expect(requests.filter((url) => url.includes('20260910000000id_'))).toHaveLength(1)
    // One index lookup per topic page ("Sudan" is left out beside "Sudan war"), however often it is read.
    expect(requests.filter((url) => url.includes('/cdx/'))).toHaveLength(1)
  })

  it('says the archive is busy (and keeps its place) when it refuses connections', async () => {
    const { archive } = setup({ refuse: true })
    const first = await archive.coverage({ url: articleUrl, headline })
    const second = await archive.coverage({ url: articleUrl, headline, cursor: first.cursor! })
    expect(second.status).toBe('busy')
    expect(second.cursor).toBe(first.cursor)
  })

  it('makes at most 25 archive requests in ten minutes, then rests', async () => {
    let clock = Date.parse('2026-11-06T12:00:00Z')
    let archiveCalls = 0
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input)
      if (url === articleUrl) return new Response(articleHtml)
      if (url.includes('web.archive.org')) {
        archiveCalls += 1
        if (url.includes('/cdx/')) return new Response(Array.from({ length: 120 }, (_, i) => `${2016 + Math.floor(i / 12)}${String(1 + (i % 12)).padStart(2, '0')}01000000 https://www.aljazeera.com/tag/sudan-war/ 200`).join('\n'))
        const stamp = url.match(/\/web\/(\d{8})/)?.[1] ?? '20200101'
        return new Response(`<a href="/news/${stamp.slice(0, 4)}/${Number(stamp.slice(4, 6))}/1/sudan-war-${stamp}"><h3>Sudan war fighting continues in month ${stamp}</h3></a>`)
      }
      return new Response('<p>Nothing</p>')
    }) as typeof fetch
    const archive = new OutletArchive({ cacheDir: mkdtempSync(join(tmpdir(), 'outlet-archive-')), fetchImpl, spacingMs: 0, now: () => clock })
    let cursor = (await archive.coverage({ url: articleUrl, headline })).cursor
    let status = 'ok'
    for (let page = 0; page < 40 && cursor && status !== 'busy'; page += 1) {
      const result = await archive.coverage({ url: articleUrl, headline, cursor })
      status = result.status
      cursor = result.cursor
      clock += 1_000
    }
    expect(status).toBe('busy')
    expect(archiveCalls).toBe(25)
  })

  it('reports an outlet that opted out of the archive index', async () => {
    const { archive } = setup({ cdxStatus: 403 })
    const first = await archive.coverage({ url: articleUrl, headline })
    const second = await archive.coverage({ url: articleUrl, headline, cursor: first.cursor! })
    expect(second.items).toEqual([])
    expect(second.cursor).toBeNull()
    expect(second.status).toBe('blocked')
  })

  it('does nothing for outlets it does not know', async () => {
    const { archive, requests } = setup()
    expect((await archive.coverage({ url: 'https://www.theguardian.com/world/2026/x', headline })).status).toBe('unsupported')
    expect(requests).toEqual([])
  })
})
