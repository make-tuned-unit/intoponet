// Check candidate feeds live and add the ones that pass to the bundled news registry.
// Usage: node scripts/add-news-feeds.mjs docs/research/<candidates>.json [--dry-run]
// A candidate is admitted only if it answers 200 with a parseable RSS/Atom feed, has at least
// three items, and its newest item is no more than 7 days old. Existing feeds are kept as they are.
// Admission terms are unchanged: headline, link, id and publish time only (see docs/data/news-feeds.json).
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const source = resolve(process.argv[2] ?? '')
const dryRun = process.argv.includes('--dry-run')
const research = JSON.parse(readFileSync(source, 'utf8'))
const evidencePath = join(repo, 'docs/data/news-feeds.json')
const bundlePath = join(repo, 'apps/desktop/src/main/news/newsFeeds.json')
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
const checkedAt = new Date().toISOString().slice(0, 10)
const now = Date.now()
const USER_AGENT = 'Intoponet/0.1 (+https://intoponet.com)'

// A city or regional feed is only useful if its place is on the globe: the app places it by
// matching cityName ?? regionName against the bundled gazetteer (see declaredPlace in newsDigest.ts).
const { CITY_ROWS, REGION_ROWS } = await import(join(repo, 'apps/desktop/src/shared/places/placeData.ts'))
const fold = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const knownPlaces = new Set([...CITY_ROWS.map((row) => `${row[2]}|${fold(row[1])}`), ...REGION_ROWS.map((row) => `${row[2]}|${fold(row[1])}`)])
const placeOf = (candidate) => candidate.geographicScope === 'local' ? candidate.cityName ?? candidate.regionName : candidate.regionName

const decode = (text) => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&#8217;/g, '’').replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8211;|&#8212;/g, '–').replace(/\s+/g, ' ').trim()

async function check(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  const text = await response.text()
  const atom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text)
  const blocks = text.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? []
  const dates = blocks.map((block) => Date.parse(decode((block.match(/<(?:pubDate|published|updated|dc:date)>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i) ?? [])[1] ?? ''))).filter(Number.isFinite)
  const titles = blocks.map((block) => decode((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '')).filter(Boolean)
  const newest = dates.length ? Math.max(...dates) : null
  return { status: response.status, finalUrl: response.url, format: atom ? 'atom' : blocks.length ? 'rss' : null, items: blocks.length, newest: newest ? new Date(newest).toISOString() : null, ageDays: newest ? (now - newest) / 86_400_000 : null, sampleTitles: titles.slice(0, 2) }
}

const seenIds = new Set(evidence.feeds.map((feed) => feed.sourceId))
const seenUrls = new Set(evidence.feeds.map((feed) => feed.url))
const added = [], rejected = []
const results = await Promise.all(research.candidates.map(async (candidate) => {
  try { return { candidate, result: await check(candidate.url) } } catch (error) { return { candidate, error: String(error?.cause?.code ?? error?.name ?? error).slice(0, 60) } }
}))
for (const { candidate, result, error } of results) {
  const reason = error ?? (result.status !== 200 ? `HTTP ${result.status}`
    : !result.format ? 'not RSS/Atom'
    : result.items < 3 ? `${result.items} items`
    : result.ageDays === null ? 'no item dates'
    : result.ageDays > 7 ? `newest item ${Math.round(result.ageDays)} days old` : null)
  const place = candidate.geographicScope === 'national' ? null : placeOf(candidate)
  if (!reason && place && !knownPlaces.has(`${candidate.countryCode ?? 'US'}|${fold(place)}`)) { rejected.push(`${candidate.sourceId}: place "${place}" not in gazetteer for ${candidate.countryCode ?? 'US'}`); continue }
  if (reason) { rejected.push(`${candidate.sourceId}: ${reason}`); continue }
  if (seenIds.has(candidate.sourceId) || seenUrls.has(candidate.url)) { rejected.push(`${candidate.sourceId}: already present`); continue }
  seenIds.add(candidate.sourceId); seenUrls.add(candidate.url)
  added.push({
    sourceId: candidate.sourceId,
    countryCode: candidate.countryCode ?? 'US',
    url: candidate.url,
    format: result.format,
    publisherName: candidate.publisherName,
    publisherType: candidate.publisherType ?? 'newspaper',
    section: candidate.section ?? (candidate.geographicScope === 'national' ? 'national news' : `${candidate.regionName ?? ''} news`.trim()),
    languageTags: candidate.languageTags ?? ['en-US'],
    geographicScope: candidate.geographicScope ?? 'national',
    regionName: candidate.regionName ?? null,
    // Statewide outlets are placed on their state, not their capital; local outlets on their city.
    cityName: candidate.geographicScope === 'local' ? candidate.cityName ?? null : null,
    independentPublisherGroupId: candidate.group ?? candidate.sourceId,
    termsUrl: candidate.termsUrl ?? null,
    evidence: { checkedAt, status: result.status, items: result.items, newest: result.newest, termsNote: candidate.termsNote ?? 'not reviewed; admitted on the same terms as existing feeds', sampleTitles: result.sampleTitles },
  })
}

console.log(`admitted ${added.length}, rejected ${rejected.length}`)
for (const line of rejected) console.log(`  rejected ${line}`)
if (dryRun || !added.length) process.exit(0)

const feeds = [...evidence.feeds, ...added].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.sourceId.localeCompare(b.sourceId))
const countries = new Set(feeds.map((feed) => feed.countryCode))
writeFileSync(evidencePath, `${JSON.stringify({ ...evidence, generatedAt: checkedAt, countryCount: countries.size, feedCount: feeds.length, feeds }, null, 1)}\n`)
writeFileSync(bundlePath, `${JSON.stringify({ ...bundle, generatedAt: checkedAt, feeds: feeds.map(({ evidence: _evidence, ...feed }) => feed) }, null, 1)}\n`)
console.log(`registry now ${feeds.length} feeds across ${countries.size} countries`)
