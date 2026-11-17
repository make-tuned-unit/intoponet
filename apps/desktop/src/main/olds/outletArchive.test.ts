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

describe('stress-test regressions: topic choice', () => {
  const abc = outletFor('https://www.abc.net.au/news/2026-11-06/x/1')!
  const npr = outletFor('https://www.npr.org/2026/11/05/nx-s1-1/x')!

  it('takes ABC’s own tag chips, not the chips on related-story cards', () => {
    // A murder-trial story: its "Related topics" chips and headline chip, then cards for other stories with their own chips.
    const html = `<a data-component="SubjectTag" class="Tag_link ArticleHeadlineTitle_tag CardTag_pill" href="/news/topic/homicide">Homicide</a>
      <p>Beau Lamarre-Condon told the jury in Paddington that the first shot was intentional, in the Paddington murder trial.</p>
      <a href="/news/2026-11-06/us-midterms/1">Trump moves to protect Oval Office after midterms</a><a data-component="SubjectTag" class="Tag_link CardTag_slim" href="/news/topic/us-elections">US Elections</a>
      <a href="/news/2026-11-06/bondi/2">Woman shot in Bondi attack dies</a><a data-component="SubjectTag" class="Tag_link CardTag_slim" href="/news/topic/terrorism">Terrorism</a>
      <h2>Related topics</h2><a data-component="Tag" href="/news/topic/paddington-2021">Paddington</a><a data-component="Tag" href="/news/topic/courts">Courts</a>`
    const candidates = articleTopics(html, 'https://www.abc.net.au/news/2026-11-06/x/1', abc, [])
    expect(candidates.find((item) => item.label === 'US Elections')?.fromKeyword).toBe(false)
    expect(candidates.find((item) => item.label === 'Terrorism')?.fromKeyword).toBe(false)
    expect(candidates.find((item) => item.label === 'Homicide')?.fromKeyword).toBe(true)
    expect(candidates.find((item) => item.label === 'Paddington')?.fromKeyword).toBe(true)
    const chosen = chooseTopics(candidates, "Lamarre-Condon tells jury first shot at ex-partner was 'intentional'", 'Beau Lamarre-Condon told the jury in Paddington that the first shot was intentional, in the Paddington murder trial.', [])
    expect(chosen.map((topic) => topic.label)).not.toContain('US Elections')
    expect(chosen.map((topic) => topic.label)).not.toContain('Terrorism')
  })

  it('reads NPR’s newer tag addresses and its story tags, and capitalises lower-case labels', () => {
    const html = '<div class="tags"><ul><li><a class="tag tag--story"href="https://www.npr.org/tags/g-s1-100949/2026-midterms">2026 midterms</a></li><li><a class="tag tag--story"href="https://www.npr.org/tags/134965593/redistricting">redistricting</a></li></ul></div>'
    const candidates = articleTopics(html, 'https://www.npr.org/2026/11/05/nx-s1-1/x', npr, [])
    expect(candidates.map((item) => [item.url, item.fromKeyword])).toEqual([['https://www.npr.org/tags/g-s1-100949/2026-midterms', true], ['https://www.npr.org/tags/134965593/redistricting', true]])
    const chosen = chooseTopics(candidates, 'How North Carolina Democrats flipped House seats in redrawn districts', 'Redistricting gave Democrats a chance. The 2026 midterms were a wave. Redistricting in North Carolina.', [])
    expect(chosen.map((topic) => topic.label)).toEqual(['2026 midterms', 'Redistricting'])
  })

  it('does not put a running story the text merely links to ahead of the story’s own subjects', () => {
    // DW: a Ukraine ceasefire piece mentions the US midterms once; "war" in a headline does not name "War on Iran".
    const html = '<p>The ceasefire in Oleshky was brokered by <a href="/en/melania-trump/t-1">Melania Trump</a>, days after the <a href="/en/us-midterm-elections-2026/t-2">US midterms</a>, as the <a href="/en/russias-war-in-ukraine/t-3">war in Ukraine</a> goes on.</p><p>Melania Trump hosted the talks on the ceasefire. Melania Trump said the war in Ukraine must end and that Ukraine needs peace.</p>'
    const chosen = chooseTopics(articleTopics(html, 'https://www.dw.com/en/x/a-1', dw, []), 'Does the Oleshky ceasefire signal progress to come in Ukraine?', html.replace(/<[^>]+>/g, ' '), [])
    expect(chosen.map((topic) => topic.label)).toEqual(['War in Ukraine', 'Melania Trump'])
    const mee = outletFor('https://www.middleeasteye.net/news/x')!
    const sahara = '<nav><a href="/topics/war-on-iran">War on Iran</a></nav><p>The Polisario Front said the collapse of the UN mission in <a href="/topics/western-sahara">Western Sahara</a> left war as the alternative. Western Sahara has been contested since 1975, and Western Sahara talks have stalled.</p>'
    expect(chooseTopics(articleTopics(sahara, 'https://www.middleeasteye.net/news/x', mee, []), "'The alternative to diplomacy is war': Polisario warns after collapse of Western Sahara UN mission", sahara.replace(/<[^>]+>/g, ' '), [])[0]?.label).toBe('Western Sahara')
  })

  it('skips a bare "War" tag and counts a person’s surname as a mention', () => {
    const rfi = outletFor('https://www.rfi.fr/en/africa/20261101-x')!
    const keywords = ['Sudan', 'War', 'War crimes']
    const chosen = chooseTopics(articleTopics('', 'https://www.rfi.fr/en/africa/20261101-x', rfi, keywords), "A year after the fall of El Fasher, Sudan's war has left a ghost town", 'Sudan has been at war since 2023. War crimes were reported in El Fasher, Sudan.', keywords)
    expect(chosen.map((topic) => topic.label)).not.toContain('War')
    const page = '<p>Police arrested allies of <a href="/en/aleksandar-vucic/t-1">Former President Aleksandar Vucic</a> as <a href="/en/serbia/t-2">Serbia</a> began its clean-up. Officials in <a href="/en/moscow/t-3">Moscow</a> said nothing.</p><p>Vucic lost the election. Vucic allies face charges, and Vucic himself may be questioned next week by prosecutors.</p>'
    const serbia = chooseTopics(articleTopics(page, 'https://www.dw.com/en/x/a-1', dw, []), 'Arrests and investigations as Serbia begins post-election clean-up', page.replace(/<[^>]+>/g, ' '), [])
    expect(serbia.map((topic) => topic.label)).toEqual(['Serbia', 'Former President Aleksandar Vucic'])
  })
})

describe('stress-test regressions: same story or not', () => {
  it('does not call a headline the same story for sharing only places, offices or keyword names', () => {
    const headline = 'MPs unanimously reject 2027 French budget as political deadlock continues'
    const keywords = ['Budget', 'Parliament', 'French politics', 'Sébastien Lecornu', 'National Rally', 'Socialist Party', 'France']
    expect(classifyHeadlines([
      'Orléans tightens security ahead of far-right National Rally party congress',
      'French Socialist party primary vote extended due to cyberattack',
      'MPs reject French budget again as deadlock over spending deepens',
    ], headline, keywords, ['French politics'])).toEqual(['related', 'related', 'story'])
    // "Asian" and Japan (a keyword) are places, not this story about a tech-stock rout.
    expect(classifyHeadlines(['Wrong national anthems played three times at Asian Para Games in Japan'], 'Tech stock rout, driven by US AI fears, continues in Asian trading', ['Financial Markets', 'Japan', 'South Korea'], ['South Korea'])).toEqual(['related'])
  })

  it('on a broad running-story tag, needs more than the country in common', () => {
    const headline = '‘Helpless’: The families facing winter in tents on the beach in Gaza'
    expect(classifyHeadlines([
      'Could the US midterms further isolate Israel in Washington?',
      'Former Israeli generals help Palestinian olive farmers',
      'Israel restricting treatment for 1,100 child amputees in Gaza: NGO',
    ], headline, ['Gaza', 'Israel', 'Palestine'], ['Israel-Palestine conflict'], [true, true, true])).toEqual(['related', 'related', 'story'])
    // On a war's own page, the war itself is the story.
    expect(classifyHeadlines(['Russian bombing kills 31 people at Ukraine aid centre, Kyiv says'], 'Melania Trump calls for lasting Ukraine truce as she hosts Russian and Ukrainian officials', [], ['War in Ukraine'], [true])).toEqual(['story'])
    expect(isStoryTag('Israeli Elections')).toBe(true)
  })

  it('does not halve the story’s own name when the page is full of it', () => {
    const titles = Array.from({ length: 8 }, (_, i) => `Lamarre-Condon trial hears from witness number ${i + 1} on the stand`)
    titles.push('Lamarre-Condon told ex-colleague goodbye before handing himself in, jury told')
    expect(classifyHeadlines(titles, "Lamarre-Condon tells jury first shot at ex-partner was 'intentional'", [], ['Paddington']).at(-1)).toBe('story')
  })
})

describe('stress-test regressions: pages', () => {
  it('reads dotted day-first dates and keeps them out of the title (DW’s older cards)', () => {
    const html = '<div><a href="/en/melania-trump-lawsuit-threat-forces-billboards-down/a-40600000">Melania Trump lawsuit threat forces Zagreb language school to remove billboards 20.09.2017</a></div>'
    expect(extractHeadlines(html, 'https://www.dw.com/en/melania-trump/t-19414296', dw, '2020-08-28')).toEqual([
      { title: 'Melania Trump lawsuit threat forces Zagreb language school to remove billboards', url: 'https://www.dw.com/en/melania-trump-lawsuit-threat-forces-billboards-down/a-40600000', date: '2017-09-20', dated: 'published' },
    ])
    expect(cardDate('<span>05.11.2026</span>', '2026-11-06')).toBe('2026-11-05')
  })

  it('does not tie headlines together by a common verb', () => {
    expect(classifyHeadlines(['Russia in Africa: What does the Kremlin hope to achieve?'], 'Does the Oleshky ceasefire signal progress to come in Ukraine?', [], ['Ukraine war'], [true])).toEqual(['unrelated'])
  })


  it('drops guide cards whose own heading is short instead of reading the whole card', () => {
    const html = `<a href="/news/world-asia-pacific-20425530"><div><h2 data-testid="card-headline">Macau profile</h2><p data-testid="card-description">Provides an overview Macau, including key facts about this region of China.</p><span data-testid="card-metadata-lastupdated">7 Jan 2025</span></div></a>
      <a href="/news/articles/c0abc123def"><h2 data-testid="card-headline">Macau facing increased restrictions under new law</h2></a>`
    expect(extractHeadlines(html, 'https://www.bbc.com/news/topics/clm1wxp5pp7t', bbc, '2026-11-06').map((item) => item.title)).toEqual(['Macau facing increased restrictions under new law'])
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

  it('shows only the headlines touching the story from a page mostly about other things (a person\u2019s page)', async () => {
    const url = 'https://www.aljazeera.com/news/2026/11/6/trump-makes-stephen-miller-chief-of-staff'
    const title = 'Trump makes adviser Stephen Miller White House chief of staff'
    const html = '<meta name="keywords" content="News, Donald Trump"><p>Donald Trump said Stephen Miller would replace Susie Wiles as chief of staff.</p>'
    const page = topicPage([
      ['/news/2026/11/5/tariffs', 'Trump doubles tariffs on Canadian lumber'],
      ['/news/2026/11/5/paris', 'What is the Paris Agreement and why does Trump reject it?'],
      ['/news/2026/11/4/shares', 'Trump says share prices will recover'],
      ['/news/2026/11/3/wiles', 'Susie Wiles under pressure as Trump weighs staff shake-up'],
      ['/news/2026/11/2/arch', 'Judge blocks construction of Trump arch'],
    ])
    const fetchImpl = (async (input: string | URL) => {
      const address = String(input)
      if (address === url) return new Response(html)
      if (address.startsWith('https://www.aljazeera.com/tag/donald-trump/')) return new Response(page)
      return new Response('', { status: 404 })
    }) as typeof fetch
    const archive = new OutletArchive({ cacheDir: mkdtempSync(join(tmpdir(), 'outlet-archive-')), fetchImpl, spacingMs: 0, now: () => Date.parse('2026-11-06T12:00:00Z') })
    const coverage = await archive.coverage({ url, headline: title })
    expect(coverage.topics.map((topic) => topic.label)).toEqual(['Donald Trump'])
    expect(coverage.items.map((item) => item.title)).toEqual(['Susie Wiles under pressure as Trump weighs staff shake-up'])
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

  it('keeps its place when neither the live topic page nor the archive can be read, and carries on once they can', async () => {
    let down = true
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input)
      if (url === articleUrl) return new Response(articleHtml)
      if (down && url.startsWith('https://www.aljazeera.com/')) return new Response('', { status: 503 })
      if (url.includes('/cdx/search/cdx')) {
        if (down) return new Response('upstream error', { status: 500 })
        return new Response(url.includes('tag%2Fsudan-war') ? '20260910000000 https://www.aljazeera.com/tag/sudan-war/ 200\n' : '')
      }
      if (url.includes('20260910000000id_')) return new Response(capture2026)
      return new Response('<p>Nothing dated</p>')
    }) as typeof fetch
    const archive = new OutletArchive({ cacheDir: mkdtempSync(join(tmpdir(), 'outlet-archive-')), fetchImpl, spacingMs: 0, now: () => Date.parse('2026-11-06T12:00:00Z') })
    const first = await archive.coverage({ url: articleUrl, headline })
    // Not "ok" with nothing to show and nowhere to go: that renders as an empty panel.
    expect(first.status).toBe('busy')
    expect(first.items).toEqual([])
    expect(first.cursor).not.toBeNull()
    down = false
    const again = await archive.coverage({ url: articleUrl, headline, cursor: first.cursor! })
    expect(again.status).toBe('ok')
    expect(again.items.map((item) => item.date)).toEqual(['2026-09-02', '2026-06-15'])
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

  it('rejects when the article cannot be read, rather than saying it has no topics', async () => {
    const fetchImpl = (async () => new Response('', { status: 406 })) as unknown as typeof fetch
    const archive = new OutletArchive({ cacheDir: mkdtempSync(join(tmpdir(), 'outlet-archive-')), fetchImpl, spacingMs: 0 })
    await expect(archive.coverage({ url: articleUrl, headline })).rejects.toThrow()
  })

  it('keeps only this story’s headlines from a suburb or city page beside another topic', async () => {
    const url = 'https://www.abc.net.au/news/2026-11-06/lamarre-condon-trial/107353670'
    const story = "Lamarre-Condon tells jury first shot at ex-partner was 'intentional'"
    const html = '<h2>Related topics</h2><a data-component="Tag" href="/news/topic/paddington-2021">Paddington</a><a data-component="Tag" href="/news/topic/sydney-2000">Sydney</a><p>Beau Lamarre-Condon told the jury in Sydney he shot his ex-partner in Paddington, Sydney.</p>'
    const pages: Record<string, string> = {
      'https://www.abc.net.au/news/topic/paddington-2021': '<main><a href="/news/2026-11-05/a/1"><h3>Lamarre-Condon tells jury he went through Baird’s phone</h3></a><a href="/news/2026-11-01/b/2"><h3>Sale of Victoria Barracks in Paddington is mind-boggling</h3></a></main>',
      'https://www.abc.net.au/news/topic/sydney-2000': '<main><a href="/news/2026-11-04/c/3"><h3>Sydney Mardi Gras party returns for a queer celebration</h3></a><a href="/news/2026-10-20/d/4"><h3>Lamarre-Condon took photos of Jesse Baird, jury told</h3></a></main>',
    }
    const fetchImpl = (async (input: string | URL) => new Response(String(input) === url ? html : pages[String(input)] ?? '', { status: String(input) === url || pages[String(input)] ? 200 : 404 })) as typeof fetch
    const archive = new OutletArchive({ cacheDir: mkdtempSync(join(tmpdir(), 'outlet-archive-')), fetchImpl, spacingMs: 0, now: () => Date.parse('2026-11-06T12:00:00Z') })
    const result = await archive.coverage({ url, headline: story })
    expect(result.topics.map((topic) => topic.label).sort()).toEqual(['Paddington', 'Sydney'])
    expect(result.items.map((item) => [item.title, item.story])).toEqual([
      ['Lamarre-Condon tells jury he went through Baird’s phone', true],
      ['Lamarre-Condon took photos of Jesse Baird, jury told', true],
    ])
  })

  it('shows a report filed twice under different addresses once', async () => {
    const url = 'https://www.rfi.fr/en/africa/20261101-el-fasher-ghost-town'
    const html = '<meta name="keywords" content="Sudan war"><p>The Sudan war has left El Fasher a ghost town, a year after it fell to the RSF.</p>'
    const tag = '<main><a href="/en/video/20260423-sudan-three-years-of-war"><h3>Sudan: Three years of war and new reports of meddling by Ethiopia</h3></a><a href="/en/podcasts/spotlight-on-africa/20260414-sudan-three-years-of-war"><h3>Sudan: Three years of war and new reports of meddling by Ethiopia</h3></a></main>'
    const fetchImpl = (async (input: string | URL) => new Response(String(input) === url ? html : String(input).includes('/en/tag/sudan-war/') ? tag : '', { status: String(input) === url || String(input).includes('/en/tag/') ? 200 : 404 })) as typeof fetch
    const archive = new OutletArchive({ cacheDir: mkdtempSync(join(tmpdir(), 'outlet-archive-')), fetchImpl, spacingMs: 0, now: () => Date.parse('2026-11-06T12:00:00Z') })
    const result = await archive.coverage({ url, headline: "A year after the fall of El Fasher, Sudan's war has left a ghost town" })
    expect(result.items.map((item) => item.date)).toEqual(['2026-04-23'])
  })

  it('does not list the story itself as earlier coverage when the topic page uses another address for it', async () => {
    // Live, 16 November 2026: DW's feed said /en/france-s-philippe-diallo-…/a-79962843, its topic page /en/frances-philippe-diallo-…/a-79962843.
    const url = 'https://www.dw.com/en/france-s-philippe-diallo-to-challenge-infantino-for-fifa-presidency/a-79962843?maca=en-rss-en-all-1573-xml-mrss'
    const title = "France's Philippe Diallo to challenge Infantino for FIFA presidency"
    const html = '<meta name="keywords" content="Gianni Infantino"><a href="/en/gianni-infantino/t-19023372">Gianni Infantino</a><p>Philippe Diallo will challenge Gianni Infantino for the FIFA presidency with the backing of UEFA.</p>'
    const page = '<main><a href="/en/klopp-wants-infantino-out-as-fifa-candidate-deadline-looms/a-79990001"><h3>Klopp wants Infantino out as FIFA candidate deadline looms</h3></a><a href="/en/frances-philippe-diallo-to-challenge-infantino-for-fifa-presidency/a-79962843"><h3>France\'s Philippe Diallo to challenge Infantino for FIFA presidency</h3></a></main>'
    const fetchImpl = (async (input: string | URL) => {
      const address = String(input)
      if (address === url) return new Response(html)
      if (address.includes('/en/gianni-infantino/')) return new Response(page)
      return new Response('', { status: 404 })
    }) as typeof fetch
    const archive = new OutletArchive({ cacheDir: mkdtempSync(join(tmpdir(), 'outlet-archive-')), fetchImpl, spacingMs: 0, now: () => Date.parse('2026-11-16T12:00:00Z') })
    const result = await archive.coverage({ url, headline: title })
    expect(result.topics.map((topic) => topic.label)).toEqual(['Gianni Infantino'])
    expect(result.items.map((item) => item.title)).toEqual(['Klopp wants Infantino out as FIFA candidate deadline looms'])
  })

  it('does nothing for outlets it does not know', async () => {
    const { archive, requests } = setup()
    expect((await archive.coverage({ url: 'https://www.theguardian.com/world/2026/x', headline })).status).toBe('unsupported')
    expect(requests).toEqual([])
  })
})
