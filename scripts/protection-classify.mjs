// Builds Intoponet's own list of ad and tracker hosts (packages/protection-engine/data/blocklist.json)
// and its page-element rules (element-rules.json) from two sources, both the project's own:
//
//   authored  data/authored-services.json: services and hosts written out by hand from knowledge;
//   measured  what scripts/protection-crawl.mjs recorded on real news pages (the raw records stay out
//             of git; --crawl says where they are).
//
// No blocklist or tracker database is read here or anywhere else in this project.
//
//   node scripts/protection-classify.mjs --crawl scratchpad/own-protection/crawl [--write]
//
// Without --write it only prints what it would do. With no --crawl, the list is the authored part
// alone and the evidence already in blocklist.json is kept.
//
// THE RULES (a "publisher" is one independentPublisherGroupId; sister outlets count once)
//
//  0. Never: a host on data/never-block.json's "never" list, or under one, is not listed. A domain on
//     its "handWrittenOnly" list is only touched by an authored rule. A host under a shared hosting
//     or content-network suffix (cloudfront.net, amazonaws.com, …) is never proposed automatically.
//  1. Functional: a host that gave pages stylesheets, fonts, audio or video, or pictures shown
//     outside ad containers, on at least 10% of the publishers that used it (and at least one), is
//     functional. It is not proposed, and if it is authored the report flags it for a look.
//  2. Tracker signals, counted per publisher:
//       id-cookie   it set a cookie lasting 30 days or more with a value of 8+ characters
//       same-id     the same cookie value was sent to it from two or more publishers' pages
//       page        the page's address went to it in the query or the body
//       id-query    a long identifier went to it in the query
//       beacon      most of its answers were 1×1 pictures, empty (204) or it was only sent pings and posts
//     Proposed as a tracker: seen at 3+ publishers, not functional, and (same-id, or id-cookie with
//     page or id-query, or beacon with page) at half or more of them.
//  3. Ad signals:
//       ad-frame    a frame from it had a standard ad size (300×250, 728×90, 970×250, 320×50, 300×600, 160×600, 336×280, 970×90, 320×100)
//       from-ads    most of its requests were made inside frames of hosts already known as ad hosts
//       ad-picture  its pictures were only ever shown inside ad containers
//     Proposed as an ad host: seen at 3+ publishers, not functional, with an ad signal at a third or
//     more of them. An ad signal wins over a tracker signal.
//  4. A proposal is for the whole registrable domain when no host under it is functional, else for
//     the host.
//  5. Nothing proposed is listed until a person has looked at what it did and written a decision in
//     data/reviewed.json (the service, the company, yes or no, and why). Hosts seen at fewer than 3
//     publishers are only listed this way too, when the reviewer recognises the service.
//  6. Every entry carries its evidence: on how many of the measured publishers it was seen and which
//     signals it showed.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = resolve(import.meta.dirname, '..')
const dataDir = join(repo, 'packages/protection-engine/data')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const write = args.includes('--write')
const crawlDir = option('crawl', '')

const temp = mkdtempSync(join(tmpdir(), 'intoponet-classify-'))
execFileSync(join(repo, 'node_modules/.bin/esbuild'), [join(repo, 'packages/protection-engine/src/site.ts'), '--bundle', '--format=esm', `--outfile=${join(temp, 'site.mjs')}`, '--log-level=warning'])
const { siteOfHost } = await import(pathToFileURL(join(temp, 'site.mjs')).href)
rmSync(temp, { recursive: true, force: true })

const readJson = (name, fallback) => (existsSync(join(dataDir, name)) ? JSON.parse(readFileSync(join(dataDir, name), 'utf8')) : fallback)
const authored = readJson('authored-services.json')
const neverBlock = readJson('never-block.json')
const reviewed = readJson('reviewed.json', { hosts: {} })
const previous = readJson('blocklist.json', { entries: [] })

const under = (host, domain) => host === domain || host.endsWith(`.${domain}`)
const neverHosts = neverBlock.never.map(([host]) => host)
const handWritten = neverBlock.handWrittenOnly.map(([host]) => host)
const isNever = (host) => neverHosts.some((domain) => under(host, domain))
const isHandWritten = (host) => handWritten.some((domain) => under(host, domain))
const SHARED = ['cloudfront.net', 'amazonaws.com', 'akamaihd.net', 'akamaized.net', 'azureedge.net', 'windows.net', 'fastly.net', 'b-cdn.net', 'cdn77.org', 'edgekey.net', 'edgesuite.net', 'azurefd.net', 'r2.dev', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'herokuapp.com', 'github.io', 'web.app', 'firebaseapp.com', 'appspot.com', 'digitaloceanspaces.com', 'wpengine.com', 'kxcdn.com', 'imgix.net', 'cloudinary.com', 'blogspot.com', 'wordpress.com']
const isShared = (host) => SHARED.some((domain) => under(host, domain))

// ---- The authored rules ----------------------------------------------------------------------------

function parseAuthored() {
  const entries = new Map()
  for (const [company, service, kind, category, hosts] of authored.services) {
    for (const item of hosts.split(/\s+/).filter(Boolean)) {
      const entry = { host: item, category, service, company, kind, source: 'authored' }
      const slash = item.indexOf('/')
      const tilde = item.indexOf('~')
      if (tilde > 0) Object.assign(entry, { host: item.slice(0, tilde), pathIncludes: [item.slice(tilde + 1)] })
      else if (slash > 0) Object.assign(entry, { host: item.slice(0, slash), paths: [item.slice(slash)] })
      const key = `${entry.host}|${category}|${service}`
      const existing = entries.get(key)
      if (existing && (existing.paths || existing.pathIncludes) && (entry.paths || entry.pathIncludes)) {
        if (entry.paths) existing.paths = [...new Set([...(existing.paths ?? []), ...entry.paths])]
        if (entry.pathIncludes) existing.pathIncludes = [...new Set([...(existing.pathIncludes ?? []), ...entry.pathIncludes])]
      } else if (!existing) entries.set(key, entry)
    }
  }
  return [...entries.values()]
}
const authoredEntries = parseAuthored()
const authoredWhole = authoredEntries.filter((entry) => !entry.paths && !entry.pathIncludes)
const authoredFor = (host) => authoredWhole.find((entry) => under(host, entry.host))

// ---- The measurement -------------------------------------------------------------------------------

const AD_SIZES = new Set(['300x250', '728x90', '970x250', '320x50', '300x600', '160x600', '336x280', '970x90', '320x100'])
let measurement = null
const hosts = new Map() // host → what it did, per publisher
const containers = new Map() // name → per publisher
let pagesRead = 0

function hostStats(host) {
  let stats = hosts.get(host)
  if (!stats) hosts.set(host, (stats = { host, publishers: new Map(), cookieValues: new Map(), samples: new Set(), frameHosts: new Map() }))
  return stats
}

if (crawlDir) {
  const lines = readFileSync(join(resolve(repo, crawlDir), 'pages.jsonl'), 'utf8').split('\n').filter(Boolean)
  const publishers = new Set()
  const countries = new Set()
  const languages = new Set()
  let first = ''
  let last = ''
  for (const line of lines) {
    const page = JSON.parse(line)
    if (!page.dom || page.dom.textLength < 800) continue // an error page or a bot wall says nothing about the site
    pagesRead += 1
    publishers.add(page.outlet)
    if (page.country) countries.add(page.country)
    if (page.language) languages.add(page.language)
    if (!first || page.startedAt < first) first = page.startedAt
    if (page.startedAt > last) last = page.startedAt
    const dom = page.dom
    const framesByHost = new Map()
    for (const frame of dom.frames ?? []) if (frame.host) framesByHost.set(frame.host, [...(framesByHost.get(frame.host) ?? []), frame])
    for (const [host, record] of Object.entries(page.hosts)) {
      if (!record.n) continue
      const stats = hostStats(host)
      let seen = stats.publishers.get(page.outlet)
      if (!seen) stats.publishers.set(page.outlet, (seen = { n: 0, functional: 0, beacons: 0, idCookie: false, page: false, idQuery: false, adFrame: false, fromFrames: 0, adPicture: false, shownPicture: false, cookieDays: 0, bytes: 0 }))
      const types = record.types
      seen.n += record.n
      seen.bytes += record.bytes
      seen.functional += (types.stylesheet ?? 0) + (types.font ?? 0) + (types.media ?? 0)
      seen.beacons += Math.min(record.n, record.tiny + record.noContent + (types.ping ?? 0) + record.post)
      for (const cookie of record.setCookies) {
        if (cookie.days >= 30 && cookie.length >= 8) {
          seen.idCookie = true
          seen.cookieDays = Math.max(seen.cookieDays, cookie.days)
        }
      }
      for (const cookie of record.sentCookies) {
        if (!stats.cookieValues.has(cookie)) stats.cookieValues.set(cookie, new Set())
        stats.cookieValues.get(cookie).add(page.outlet)
      }
      if (record.pageInQuery || record.pageInBody) seen.page = true
      if (record.idInQuery) seen.idQuery = true
      for (const [frameHost, count] of Object.entries(record.frames)) {
        seen.fromFrames += count
        stats.frameHosts.set(frameHost, (stats.frameHosts.get(frameHost) ?? 0) + count)
      }
      for (const frame of framesByHost.get(host) ?? []) if (AD_SIZES.has(`${frame.size[0]}x${frame.size[1]}`)) seen.adFrame = true
      const pictures = dom.pictures?.[host]
      if (pictures?.shown) seen.shownPicture = true
      else if (pictures?.inAd) seen.adPicture = true
      if ((dom.video ?? []).includes(host) || (dom.styles ?? []).includes(host)) seen.functional += 1
      for (const sample of record.samples) if (stats.samples.size < 8) stats.samples.add(sample)
    }
    for (const container of dom.containers ?? []) {
      const adOnly = container.text === 0 && container.ownLinks === 0 && (container.images === 0 || container.frames.length > 0)
      const empty = adOnly && container.frames.length === 0 && container.images === 0 && container.otherLinks === 0
      for (const name of container.named) {
        // "#div-gpt-ad-1234-0" and "#div-gpt-ad-5678-1" are one name: the part before the first number.
        const key = name.startsWith('#') ? `#${name.slice(1).replace(/[-_]?\d.*$/, '')}*` : name
        if (key.length < 4) continue
        let entry = containers.get(key)
        if (!entry) containers.set(key, (entry = { publishers: new Map() }))
        const seen = entry.publishers.get(page.outlet) ?? { adOnly: 0, other: 0, withAd: 0, empty: 0 }
        if (adOnly) seen.adOnly += 1
        else seen.other += 1
        if (adOnly && !empty) seen.withAd += 1
        if (empty) seen.empty += 1
        entry.publishers.set(page.outlet, seen)
      }
    }
  }
  measurement = { publishers: publishers.size, pages: pagesRead, countries: countries.size, languages: languages.size, from: first.slice(0, 10), to: last.slice(0, 10) }
}

function signals(stats, adHost) {
  const total = stats.publishers.size
  const count = (test) => [...stats.publishers.values()].filter(test).length
  const sameId = [...stats.cookieValues.values()].some((outlets) => outlets.size >= 2)
  const functional = count((seen) => seen.functional > 0 || seen.shownPicture)
  const requests = [...stats.publishers.values()].reduce((sum, seen) => sum + seen.n, 0)
  const fromAdFrames = [...stats.frameHosts.entries()].filter(([host]) => adHost(host)).reduce((sum, [, n]) => sum + n, 0)
  const found = {
    publishers: total,
    requests,
    functional,
    idCookie: count((seen) => seen.idCookie),
    sameId,
    page: count((seen) => seen.page),
    idQuery: count((seen) => seen.idQuery),
    beacon: count((seen) => seen.beacons * 2 >= seen.n),
    adFrame: count((seen) => seen.adFrame),
    adPicture: count((seen) => seen.adPicture),
    fromAds: requests ? fromAdFrames / requests : 0,
    cookieDays: Math.max(0, ...[...stats.publishers.values()].map((seen) => seen.cookieDays)),
  }
  found.isFunctional = functional >= 1 && functional >= total * 0.1
  const half = total / 2
  found.tracker = (found.sameId && found.idCookie + found.page + found.idQuery > 0) || (found.idCookie >= half && (found.page >= half || found.idQuery >= half)) || (found.beacon >= half && found.page >= half)
  found.ad = found.adFrame >= total / 3 || found.adPicture >= total / 3 || found.fromAds >= 0.5
  return found
}

function evidenceOf(found) {
  const shown = []
  if (found.sameId) shown.push('same-id')
  if (found.idCookie) shown.push(`id-cookie ${found.idCookie}`)
  if (found.page) shown.push(`page ${found.page}`)
  if (found.idQuery) shown.push(`id-query ${found.idQuery}`)
  if (found.beacon) shown.push(`beacon ${found.beacon}`)
  if (found.adFrame) shown.push(`ad-frame ${found.adFrame}`)
  if (found.adPicture) shown.push(`ad-picture ${found.adPicture}`)
  if (found.fromAds >= 0.5) shown.push('from-ads')
  if (found.functional) shown.push(`functional ${found.functional}`)
  return { publishers: found.publishers, of: measurement.publishers, requests: found.requests, signals: shown, ...(found.cookieDays ? { cookieDays: Math.round(found.cookieDays) } : {}) }
}

// ---- Putting the list together ---------------------------------------------------------------------

const entries = []
const report = { authoredSeen: 0, authoredFunctional: [], proposals: [], unreviewed: [], accepted: 0, rejected: 0 }
const previousEvidence = new Map(previous.entries.map((entry) => [`${entry.host}|${(entry.paths ?? []).join(',')}|${(entry.pathIncludes ?? []).join(',')}`, entry.evidence]))

if (!measurement) {
  for (const entry of authoredEntries) {
    const evidence = previousEvidence.get(`${entry.host}|${(entry.paths ?? []).join(',')}|${(entry.pathIncludes ?? []).join(',')}`)
    entries.push(evidence ? { ...entry, source: 'authored, measured', evidence } : entry)
  }
} else {
  // By registrable domain and by host.
  const byDomain = new Map()
  for (const stats of hosts.values()) {
    const domain = siteOfHost(stats.host)
    if (!byDomain.has(domain)) byDomain.set(domain, [])
    byDomain.get(domain).push(stats)
  }
  const merged = (list, name) => {
    const all = { host: name, publishers: new Map(), cookieValues: new Map(), samples: new Set(), frameHosts: new Map() }
    for (const stats of list) {
      for (const [outlet, seen] of stats.publishers) {
        const into = all.publishers.get(outlet)
        if (!into) all.publishers.set(outlet, { ...seen })
        else {
          for (const key of ['n', 'functional', 'beacons', 'fromFrames', 'bytes']) into[key] += seen[key]
          for (const key of ['idCookie', 'page', 'idQuery', 'adFrame', 'adPicture', 'shownPicture']) into[key] ||= seen[key]
          into.cookieDays = Math.max(into.cookieDays, seen.cookieDays)
        }
      }
      for (const [cookie, outlets] of stats.cookieValues) {
        if (!all.cookieValues.has(cookie)) all.cookieValues.set(cookie, new Set())
        for (const outlet of outlets) all.cookieValues.get(cookie).add(outlet)
      }
      for (const sample of stats.samples) if (all.samples.size < 8) all.samples.add(`${stats.host} ${sample}`)
      for (const [host, n] of stats.frameHosts) all.frameHosts.set(host, (all.frameHosts.get(host) ?? 0) + n)
    }
    return all
  }
  const knownAd = new Set(authoredWhole.filter((entry) => entry.category === 'ad').map((entry) => entry.host))
  for (const [host, decision] of Object.entries(reviewed.hosts)) if (decision.list === 'ad') knownAd.add(host)
  const adHost = (host) => [...knownAd].some((domain) => under(host, domain))

  // Authored entries, with what the measurement saw of them.
  for (const entry of authoredEntries) {
    const list = [...hosts.values()].filter((stats) => under(stats.host, entry.host))
    if (!list.length || entry.paths || entry.pathIncludes) {
      entries.push(entry)
      continue
    }
    const found = signals(merged(list, entry.host), adHost)
    report.authoredSeen += 1
    if (found.isFunctional) report.authoredFunctional.push(`${entry.host} (${entry.service}): functional at ${found.functional} of ${found.publishers} publishers`)
    entries.push({ ...entry, source: 'authored, measured', evidence: evidenceOf(found) })
  }

  // Proposals from the measurement.
  const listed = (host) => !!authoredFor(host)
  for (const [domain, list] of byDomain) {
    if (isNever(domain) || isHandWritten(domain)) continue
    const candidates = []
    const whole = signals(merged(list, domain), adHost)
    const shared = isShared(domain) || list.some((stats) => isShared(stats.host))
    if (!shared && !whole.isFunctional && !listed(domain)) candidates.push([domain, merged(list, domain), whole])
    else for (const stats of list) if (!listed(stats.host) && !isNever(stats.host)) candidates.push([stats.host, stats, signals(stats, adHost)])
    for (const [host, stats, found] of candidates) {
      const decision = reviewed.hosts[host]
      // A host under a domain the reviewer listed whole is covered by that entry.
      if (!decision && Object.entries(reviewed.hosts).some(([parent, item]) => parent !== host && under(host, parent) && (item.list === 'ad' || item.list === 'tracker'))) continue
      const proposal = found.isFunctional || isShared(host) ? '' : found.publishers >= 3 && found.ad ? 'ad' : found.publishers >= 3 && found.tracker ? 'tracker' : ''
      if (decision) {
        if (decision.list === 'ad' || decision.list === 'tracker') {
          report.accepted += 1
          entries.push({
            host, category: decision.list, service: decision.service, company: decision.company ?? decision.service, kind: decision.kind ?? (decision.list === 'ad' ? 'advertising' : 'tracking'),
            source: proposal ? 'measured' : 'measured, listed on review', evidence: evidenceOf(found), ...(decision.note ? { note: decision.note } : {}),
          })
        } else report.rejected += 1
        continue
      }
      const line = { host, proposal, ...evidenceOf(found), samples: [...stats.samples].slice(0, 5) }
      if (proposal) report.proposals.push(line)
      else if (found.publishers >= 2 || found.sameId || found.adFrame) report.unreviewed.push(line)
    }
  }
}

// A reviewed host that was not a candidate by itself (a host under a domain that was judged as a
// whole, such as an ad host of a portal) is listed with what the crawl saw of it. One this crawl
// did not see keeps its place and its earlier evidence (a host can be quiet for one run).
for (const [host, decision] of Object.entries(reviewed.hosts)) {
  if ((decision.list !== 'ad' && decision.list !== 'tracker') || entries.some((entry) => entry.host === host && !entry.paths && !entry.pathIncludes)) continue
  if (authoredFor(host)) continue
  const before = previous.entries.find((entry) => entry.host === host)
  const seen = measurement ? [...hosts.values()].filter((stats) => under(stats.host, host)) : []
  let evidence = before?.evidence
  if (seen.length) {
    const all = { host, publishers: new Map(), cookieValues: new Map(), samples: new Set(), frameHosts: new Map() }
    for (const stats of seen) {
      for (const [outlet, item] of stats.publishers) if (!all.publishers.has(outlet)) all.publishers.set(outlet, { ...item })
      for (const [cookie, outlets] of stats.cookieValues) all.cookieValues.set(cookie, new Set([...(all.cookieValues.get(cookie) ?? []), ...outlets]))
      for (const [frameHost, n] of stats.frameHosts) all.frameHosts.set(frameHost, (all.frameHosts.get(frameHost) ?? 0) + n)
    }
    evidence = evidenceOf(signals(all, () => false))
    report.accepted += 1
  }
  if (!evidence) continue // never seen: a reviewed host has to have been measured once
  entries.push({ host, category: decision.list, service: decision.service, company: decision.company ?? decision.service, kind: decision.kind ?? (decision.list === 'ad' ? 'advertising' : 'tracking'), source: 'measured, listed on review', evidence, ...(decision.note ? { note: decision.note } : {}) })
}

entries.sort((left, right) => (left.host < right.host ? -1 : left.host > right.host ? 1 : 0))
const count = (test) => entries.filter(test).length
const services = new Set(entries.map((entry) => `${entry.company}|${entry.service}`))
const summary = {
  entries: entries.length,
  hosts: new Set(entries.map((entry) => entry.host)).size,
  services: services.size,
  companies: new Set(entries.map((entry) => entry.company)).size,
  ad: count((entry) => entry.category === 'ad'),
  tracker: count((entry) => entry.category === 'tracker'),
  authoredOnly: count((entry) => entry.source === 'authored'),
  authoredMeasured: count((entry) => entry.source === 'authored, measured'),
  measured: count((entry) => entry.source.startsWith('measured')),
}

// ---- Page-element rules ------------------------------------------------------------------------------

let elementReport = []
if (measurement) {
  for (const [name, entry] of containers) {
    const publishers = entry.publishers.size
    if (publishers < 3) continue
    const all = [...entry.publishers.values()]
    elementReport.push({
      name, publishers,
      adOnlyAtAll: all.filter((seen) => seen.other === 0).length,
      withAd: all.filter((seen) => seen.withAd > 0).length,
      mixed: all.filter((seen) => seen.other > 0).length,
    })
  }
  elementReport.sort((left, right) => right.publishers - left.publishers)
}

// A name becomes a rule only when a person has accepted it in data/reviewed.json ("elements"):
//   hide       hidden always. Only for a name that held nothing but ads at every publisher where it was seen (5 or more).
//   whenEmpty  hidden once nothing but an ad label is left in it (the empty-slot cleanup). For a name that held only ads at 80% or more of 3+ publishers.
const selectorOf = (name) => (name.startsWith('#') ? `[id^="${name.slice(1, -1)}"]` : `[class~="${name.slice(1)}"]`)
const previousElements = readJson('element-rules.json', { hide: [], whenEmpty: [] })
const elementRules = { hide: [], whenEmpty: [] }
for (const kind of ['hide', 'whenEmpty']) {
  for (const name of reviewed.elements?.[kind] ?? []) {
    const seen = elementReport.find((item) => item.name === name)
    const before = previousElements[kind].find((rule) => rule.name === name)
    if (seen) elementRules[kind].push({ selector: selectorOf(name), name, publishers: seen.publishers, onlyAds: seen.adOnlyAtAll, withAnAd: seen.withAd, of: measurement.publishers })
    else if (before) elementRules[kind].push(before)
  }
}
if (measurement) {
  for (const rule of elementRules.hide) if (rule.onlyAds !== rule.publishers || rule.publishers < 5) throw new Error(`"${rule.name}" can not be hidden always: it held only ads at ${rule.onlyAds} of ${rule.publishers} publishers (all of 5 or more are needed).`)
  for (const rule of elementRules.whenEmpty) if (rule.onlyAds < rule.publishers * 0.8 || rule.publishers < 3) throw new Error(`"${rule.name}" can not be an ad slot: it held only ads at ${rule.onlyAds} of ${rule.publishers} publishers.`)
}

const out = {
  about: "Intoponet's own list of ad and tracker hosts. Every entry was either written by hand from knowledge (authored-services.json) or found by Intoponet's own measurement of news pages and listed after a person looked at what the host did (reviewed.json). It is not copied or derived from any filter list, hosts file or tracker database. Generated by scripts/protection-classify.mjs; do not edit by hand.",
  fields: "host: the host and every host under it. paths / pathIncludes: only requests whose path starts with / contains one of these. category: ad or tracker. service, company, kind: what it is. source: authored (from knowledge, not seen in the measurement), 'authored, measured' (from knowledge, and seen), measured (proposed by the classification rules and accepted on review), 'measured, listed on review' (seen, below the rules' thresholds, listed because the reviewer recognised the service). evidence: publishers = how many of the measured publishers' pages asked this host for something, of = how many publishers were measured, requests, signals = the classification signals with the number of publishers showing each.",
  generated: new Date().toISOString().slice(0, 10),
  measurement: measurement ?? previous.measurement ?? null,
  summary,
  entries,
}

console.log(JSON.stringify({ measurement: out.measurement, summary, authoredSeen: report.authoredSeen, accepted: report.accepted, rejected: report.rejected, proposals: report.proposals.length, unreviewed: report.unreviewed.length }, null, 1))
if (report.authoredFunctional.length) console.log(`\nAuthored hosts that looked functional (check them):\n  ${report.authoredFunctional.join('\n  ')}`)
if (crawlDir) {
  const reviewFile = join(resolve(repo, crawlDir), 'review.json')
  writeFileSync(reviewFile, JSON.stringify({ proposals: report.proposals.sort((a, b) => b.publishers - a.publishers), unreviewed: report.unreviewed.sort((a, b) => b.publishers - a.publishers), elements: elementReport }, null, 1))
  console.log(`\nTo review: ${reviewFile}`)
}
if (write) {
  writeFileSync(join(dataDir, 'blocklist.json'), `${JSON.stringify(out, null, 1)}\n`)
  writeFileSync(join(dataDir, 'element-rules.json'), `${JSON.stringify({ about: "Page-element rules found by Intoponet's own measurement (scripts/protection-crawl.mjs) and accepted by a person (reviewed.json). hide: containers that held nothing but ads at every publisher where they were seen. whenEmpty: ad slots, hidden once nothing but an ad label is left in them. publishers = at how many measured publishers the name was seen, onlyAds = at how many of those every instance held only ads, withAnAd = at how many an ad was in it at the time. Generated by scripts/protection-classify.mjs.", ...elementRules }, null, 1)}\n`)
  console.log(`Wrote ${join(dataDir, 'blocklist.json')}`)
}
