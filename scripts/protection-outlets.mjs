// Which news outlets the protection measurement visits (scripts/protection-crawl.mjs), and which
// 60 are held out: never used to build the list, only to test it afterwards.
//
// The choice is fixed by a hash of each publisher's id, so every run picks the same outlets:
//   hold-out: the 60 publishers with the lowest hash, at most one per country;
//   build:    the rest, taken country by country in turns (each country's publishers in hash
//             order), so the sample is spread over every country before any country gets a
//             second or third outlet.
// A publisher is one independentPublisherGroupId: sister papers of one group count once.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const newsDir = resolve(import.meta.dirname, '../apps/desktop/src/main/news')
export const HOLDOUT_SIZE = 60

const hash = (value) => createHash('sha1').update(`intoponet-protection:${value}`).digest('hex')

/** One outlet per publisher: its id, country, language, name and the feeds it publishes (the first is tried first). */
export function allOutlets() {
  const feeds = [
    ...JSON.parse(readFileSync(resolve(newsDir, 'newsFeeds.json'), 'utf8')).feeds,
    ...JSON.parse(readFileSync(resolve(newsDir, 'internationalFeeds.json'), 'utf8')).feeds,
  ]
  const byGroup = new Map()
  for (const feed of feeds) {
    const group = feed.independentPublisherGroupId || feed.sourceId
    let outlet = byGroup.get(group)
    if (!outlet) {
      outlet = { id: group, country: feed.countryCode, language: (feed.languageTags?.[0] ?? '').split('-')[0], name: feed.publisherName, feeds: [], order: hash(group) }
      byGroup.set(group, outlet)
    }
    if (outlet.feeds.length < 3 && !outlet.feeds.includes(feed.url)) outlet.feeds.push(feed.url)
  }
  return [...byGroup.values()].sort((left, right) => (left.order < right.order ? -1 : 1))
}

export function holdoutOutlets() {
  const seen = new Set()
  const picked = []
  for (const outlet of allOutlets()) {
    if (seen.has(outlet.country)) continue
    seen.add(outlet.country)
    picked.push(outlet)
    if (picked.length === HOLDOUT_SIZE) break
  }
  return picked
}

export function buildOutlets(limit = Infinity) {
  const held = new Set(holdoutOutlets().map((outlet) => outlet.id))
  const byCountry = new Map()
  for (const outlet of allOutlets()) {
    if (held.has(outlet.id)) continue
    if (!byCountry.has(outlet.country)) byCountry.set(outlet.country, [])
    byCountry.get(outlet.country).push(outlet)
  }
  const countries = [...byCountry.keys()].sort((left, right) => (hash(left) < hash(right) ? -1 : 1))
  const picked = []
  for (let round = 0; picked.length < limit; round += 1) {
    let any = false
    for (const country of countries) {
      const outlet = byCountry.get(country)[round]
      if (!outlet) continue
      any = true
      picked.push(outlet)
      if (picked.length >= limit) break
    }
    if (!any) break
  }
  return picked
}
