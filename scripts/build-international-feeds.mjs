#!/usr/bin/env node
/**
 * Verifies international news desks' public RSS/Atom feeds and writes the
 * ones that pass to:
 *   apps/desktop/src/main/news/internationalFeeds.json  (bundled registry)
 *   docs/data/international-feeds.json                  (with evidence)
 *
 * These feeds are only used to find stories covered across many countries
 * ("World" in the app). They are never counted as a country's local news.
 * Only headline, link and time are read, as for local feeds.
 *
 * Admission: HTTP 200, parses as RSS/Atom with at least 5 items, newest item
 * within the last 3 days.
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const UA = 'Intoponet/0.1 (+https://github.com/make-tuned-unit/intoponet; feed verification)'

/** Candidates: international desks of public broadcasters, wires' public feeds, and major papers, across regions and languages. */
const CANDIDATES = [
  // Public broadcasters and international services
  { id: 'bbc-world', name: 'BBC News', country: 'GB', lang: 'en', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', type: 'public-broadcaster' },
  { id: 'dw-en', name: 'Deutsche Welle', country: 'DE', lang: 'en', url: 'https://rss.dw.com/xml/rss-en-all', type: 'public-broadcaster' },
  { id: 'dw-es', name: 'DW Español', country: 'DE', lang: 'es', url: 'https://rss.dw.com/xml/rss-es-all', type: 'public-broadcaster' },
  { id: 'france24-en', name: 'France 24', country: 'FR', lang: 'en', url: 'https://www.france24.com/en/rss', type: 'public-broadcaster' },
  { id: 'france24-fr', name: 'France 24 (FR)', country: 'FR', lang: 'fr', url: 'https://www.france24.com/fr/rss', type: 'public-broadcaster' },
  { id: 'france24-es', name: 'France 24 (ES)', country: 'FR', lang: 'es', url: 'https://www.france24.com/es/rss', type: 'public-broadcaster' },
  { id: 'france24-ar', name: 'France 24 (AR)', country: 'FR', lang: 'ar', url: 'https://www.france24.com/ar/rss', type: 'public-broadcaster' },
  { id: 'rfi-en', name: 'RFI', country: 'FR', lang: 'en', url: 'https://www.rfi.fr/en/rss', type: 'public-broadcaster' },
  { id: 'npr-world', name: 'NPR World', country: 'US', lang: 'en', url: 'https://feeds.npr.org/1004/rss.xml', type: 'public-broadcaster' },
  { id: 'cbc-world', name: 'CBC World', country: 'CA', lang: 'en', url: 'https://www.cbc.ca/webfeed/rss/rss-world', type: 'public-broadcaster' },
  { id: 'abc-au-world', name: 'ABC News (Australia)', country: 'AU', lang: 'en', url: 'https://www.abc.net.au/news/feed/52278/rss.xml', type: 'public-broadcaster' },
  { id: 'rnz-world', name: 'RNZ World', country: 'NZ', lang: 'en', url: 'https://www.rnz.co.nz/rss/world.xml', type: 'public-broadcaster' },
  { id: 'nhk-world', name: 'NHK (国際)', country: 'JP', lang: 'ja', url: 'https://www3.nhk.or.jp/rss/news/cat6.xml', type: 'public-broadcaster' },
  { id: 'sbs-world', name: 'SBS News World', country: 'AU', lang: 'en', url: 'https://www.sbs.com.au/news/topic/world/feed', type: 'public-broadcaster' },
  { id: 'cna-world', name: 'CNA', country: 'SG', lang: 'en', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311', type: 'broadcaster' },
  { id: 'aljazeera-en', name: 'Al Jazeera English', country: 'QA', lang: 'en', url: 'https://www.aljazeera.com/xml/rss/all.xml', type: 'broadcaster' },
  { id: 'euronews-en', name: 'Euronews', country: 'FR', lang: 'en', url: 'https://www.euronews.com/rss?format=mrss&level=theme&name=news', type: 'broadcaster' },
  { id: 'africanews-en', name: 'Africanews', country: 'CG', lang: 'en', url: 'https://www.africanews.com/feed/rss', type: 'broadcaster' },
  { id: 'sky-world', name: 'Sky News World', country: 'GB', lang: 'en', url: 'https://feeds.skynews.com/feeds/rss/world.xml', type: 'broadcaster' },
  // International organisations
  { id: 'un-news', name: 'UN News', country: 'US', lang: 'en', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', type: 'international-organisation' },
  // Newspapers' international desks
  { id: 'guardian-world', name: 'The Guardian World', country: 'GB', lang: 'en', url: 'https://www.theguardian.com/world/rss', type: 'newspaper' },
  { id: 'nyt-world', name: 'The New York Times World', country: 'US', lang: 'en', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', type: 'newspaper' },
  { id: 'wapo-world', name: 'The Washington Post World', country: 'US', lang: 'en', url: 'https://feeds.washingtonpost.com/rss/world', type: 'newspaper' },
  { id: 'lemonde-intl', name: 'Le Monde International', country: 'FR', lang: 'fr', url: 'https://www.lemonde.fr/international/rss_full.xml', type: 'newspaper' },
  { id: 'elpais-intl', name: 'El País Internacional', country: 'ES', lang: 'es', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada', type: 'newspaper' },
  { id: 'spiegel-ausland', name: 'Der Spiegel Ausland', country: 'DE', lang: 'de', url: 'https://www.spiegel.de/ausland/index.rss', type: 'newspaper' },
  { id: 'folha-mundo', name: 'Folha Mundo', country: 'BR', lang: 'pt', url: 'https://feeds.folha.uol.com.br/mundo/rss091.xml', type: 'newspaper' },
  { id: 'scmp-world', name: 'South China Morning Post World', country: 'HK', lang: 'en', url: 'https://www.scmp.com/rss/91/feed', type: 'newspaper' },
  { id: 'hindu-intl', name: 'The Hindu International', country: 'IN', lang: 'en', url: 'https://www.thehindu.com/news/international/feeder/default.rss', type: 'newspaper' },
  { id: 'toi-world', name: 'Times of India World', country: 'IN', lang: 'en', url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', type: 'newspaper' },
  { id: 'dawn-world', name: 'Dawn World', country: 'PK', lang: 'en', url: 'https://www.dawn.com/feeds/world', type: 'newspaper' },
  { id: 'japantimes', name: 'The Japan Times', country: 'JP', lang: 'en', url: 'https://www.japantimes.co.jp/feed/', type: 'newspaper' },
  { id: 'yonhap-en', name: 'Yonhap News', country: 'KR', lang: 'en', url: 'https://en.yna.co.kr/RSS/news.xml', type: 'news-agency' },
  { id: 'ansa-en', name: 'ANSA English', country: 'IT', lang: 'en', url: 'https://www.ansa.it/english/news/english_nr_rss.xml', type: 'news-agency' },
  { id: 'mee', name: 'Middle East Eye', country: 'GB', lang: 'en', url: 'https://www.middleeasteye.net/rss', type: 'online' },
  { id: 'premium-times', name: 'Premium Times', country: 'NG', lang: 'en', url: 'https://www.premiumtimesng.com/feed', type: 'newspaper' },
  { id: 'mercopress', name: 'MercoPress', country: 'UY', lang: 'en', url: 'https://en.mercopress.com/rss/', type: 'online' },
  { id: 'globo-mundo', name: 'g1 Mundo', country: 'BR', lang: 'pt', url: 'https://g1.globo.com/rss/g1/mundo/', type: 'online' },
  { id: 'infobae-america', name: 'Infobae América', country: 'AR', lang: 'es', url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/america/', type: 'online' },
]

function countItems(xml) {
  const items = (xml.match(/<item[\s>]/g) ?? []).length + (xml.match(/<entry[\s>]/g) ?? []).length
  const format = /<feed[\s>][^>]*xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/.test(xml) || (/<entry[\s>]/.test(xml) && !/<item[\s>]/.test(xml)) ? 'atom' : 'rss'
  const dates = [...xml.matchAll(/<(?:pubDate|updated|published|dc:date)>([^<]+)</g)].map((m) => Date.parse(m[1].trim())).filter(Number.isFinite)
  const titles = [...xml.matchAll(/<title>(?:<!\[CDATA\[)?([^<\]]{8,200})/g)].map((m) => m[1].trim()).slice(1, 3)
  return { items, format, newest: dates.length ? new Date(Math.max(...dates)).toISOString() : null, titles }
}

const checkedAt = new Date().toISOString().slice(0, 10)
const results = await Promise.all(CANDIDATES.map(async (candidate) => {
  try {
    const response = await fetch(candidate.url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    const text = response.ok ? (await response.text()).slice(0, 4_000_000) : ''
    const parsed = countItems(text)
    const fresh = parsed.newest ? Date.now() - Date.parse(parsed.newest) < 3 * 86_400_000 : false
    const passed = response.status === 200 && parsed.items >= 5 && fresh
    return { ...candidate, finalUrl: response.url, status: response.status, ...parsed, passed, reason: passed ? null : response.status !== 200 ? `HTTP ${response.status}` : parsed.items < 5 ? `${parsed.items} items` : 'not updated in 3 days' }
  } catch (error) {
    return { ...candidate, status: 0, items: 0, passed: false, reason: error instanceof Error ? error.message.slice(0, 80) : 'failed' }
  }
}))

const passed = results.filter((result) => result.passed)
const feeds = passed.map((result) => ({
  sourceId: `intl-${result.id}`,
  countryCode: result.country,
  url: result.url,
  format: result.format,
  publisherName: result.name,
  publisherType: result.type,
  section: 'World',
  languageTags: [result.lang],
  geographicScope: 'international',
  regionName: null,
  cityName: null,
  independentPublisherGroupId: result.id.replace(/-(en|es|fr|ar|world|intl)$/, ''),
  termsUrl: null,
}))
writeFileSync(join(repo, 'apps/desktop/src/main/news/internationalFeeds.json'), `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: checkedAt,
  note: 'International desks used only to find stories covered across many countries. Never counted as a country\'s local news. Generated by scripts/build-international-feeds.mjs.',
  feeds,
}, null, 1)}\n`)
writeFileSync(join(repo, 'docs/data/international-feeds.json'), `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: checkedAt,
  admission: 'HTTP 200, RSS/Atom with at least 5 items, newest item within 3 days. Headline, link and time only.',
  passed: passed.length,
  candidates: results.map(({ id, name, country, lang, url, type, status, items, newest, titles, passed: ok, reason }) => ({ id, name, country, lang, url, type, status, items, newest, sampleTitles: titles, passed: ok, reason })),
}, null, 1)}\n`)
console.log(`${passed.length}/${results.length} passed`)
for (const result of results) console.log(`${result.passed ? 'ok  ' : 'FAIL'} ${result.id.padEnd(18)} ${String(result.status).padEnd(4)} items=${String(result.items).padEnd(4)} newest=${result.newest ?? '-'} ${result.reason ?? ''}`)
