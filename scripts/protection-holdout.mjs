// The hold-out check: how much the list misses on outlets it was not built from.
//
// The 60 hold-out outlets (scripts/protection-outlets.mjs) are visited twice by
// scripts/protection-crawl.mjs, once with blocking off and once with --protect, each outlet with a
// cookie jar of its own (--isolate). This script puts the two runs side by side:
//
//   node scripts/protection-holdout.mjs [--off DIR] [--on DIR] [--judgement FILE] [--write]
//
// For every host of another site that a page still reached with blocking on, a person writes a
// verdict in the judgement file ({ "host": "ad" | "tracker" | "no" | "unsure" }), after looking at
// what the host did (the script prints what it saw). The numbers it then reports:
//
//   miss rate (hosts)    = missed ÷ (blocked + missed), counting each ad or tracker host once per
//                          outlet it appeared at. "missed" = reached with blocking on and judged an
//                          ad or tracker host ("unsure" counts as missed); "blocked" = stopped by the list.
//   miss rate (requests) = the same, counting requests.
//   cookies from other sites left after each outlet's two pages, blocking off and on.
//
// With --write the summary goes to docs/data/protection-holdout.json.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const read = (dir) => readFileSync(join(resolve(repo, dir), 'pages.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
const off = read(option('off', 'scratchpad/own-protection/holdout-off'))
const on = read(option('on', 'scratchpad/own-protection/holdout-on'))
const judgementFile = resolve(repo, option('judgement', 'docs/data/protection-holdout-judgement.json'))
const judgement = existsSync(judgementFile) ? JSON.parse(readFileSync(judgementFile, 'utf8')).hosts : {}

const usable = (page) => page.dom && page.dom.textLength >= 800
const outletsOn = new Set(on.filter(usable).map((page) => page.outlet))
const outletsOff = new Set(off.filter(usable).map((page) => page.outlet))
const outlets = [...outletsOn].filter((outlet) => outletsOff.has(outlet))

function tally(pages) {
  const perOutlet = new Map()
  for (const page of pages) {
    if (!outlets.includes(page.outlet) || !usable(page)) continue
    const entry = perOutlet.get(page.outlet) ?? { hosts: new Map(), cookies: 0, cookieSites: 0 }
    for (const [host, record] of Object.entries(page.hosts)) {
      const seen = entry.hosts.get(host) ?? { reached: 0, blocked: 0, record }
      seen.reached += record.n
      seen.blocked += record.blocked
      entry.hosts.set(host, seen)
    }
    // The jar is the outlet's own: what is there after its last page is what its pages left.
    if (page.cookies) Object.assign(entry, { cookies: page.cookies.other, cookieSites: page.cookies.otherSites })
    perOutlet.set(page.outlet, entry)
  }
  return perOutlet
}
const before = tally(off)
const after = tally(on)

const reached = new Map() // host → { outlets, requests, sample }
let blockedHosts = 0
let blockedRequests = 0
for (const [outlet, entry] of after) {
  for (const [host, seen] of entry.hosts) {
    if (seen.blocked) {
      blockedHosts += 1
      blockedRequests += seen.blocked
    }
    if (!seen.reached) continue
    const item = reached.get(host) ?? { outlets: new Set(), requests: 0, record: seen.record }
    item.outlets.add(outlet)
    item.requests += seen.reached
    reached.set(host, item)
  }
}

let missedHosts = 0
let missedRequests = 0
let unsure = 0
const missed = []
const unjudged = []
for (const [host, item] of [...reached].sort((left, right) => right[1].outlets.size - left[1].outlets.size)) {
  const verdict = judgement[host]
  if (!verdict) {
    const record = item.record
    unjudged.push(`${host}  outlets ${item.outlets.size}  requests ${item.requests}  types ${JSON.stringify(record.types)}  set-cookie ${record.setCookies.map((cookie) => `${cookie.name}:${cookie.days}d`).slice(0, 3).join(',')}  page ${record.pageInQuery + record.pageInBody} id ${record.idInQuery} tiny ${record.tiny}  ${record.samples.slice(0, 2).join(' | ')}`)
    continue
  }
  if (verdict === 'no') continue
  if (verdict === 'unsure') unsure += 1
  missedHosts += item.outlets.size
  missedRequests += item.requests
  missed.push({ host, verdict, outlets: item.outlets.size, requests: item.requests })
}

const sum = (map, key) => [...map.values()].reduce((total, entry) => total + entry[key], 0)
const hostCount = (map) => [...map.values()].reduce((total, entry) => total + [...entry.hosts.values()].filter((seen) => seen.reached).length, 0)
const summary = {
  outlets: outlets.length,
  outletsAttempted: new Set(on.map((page) => page.outlet)).size,
  pages: on.filter((page) => outlets.includes(page.outlet) && usable(page)).length,
  otherSiteHostsReached: { blockingOff: hostCount(before), blockingOn: hostCount(after) },
  distinctHostsStillReached: reached.size,
  judged: { adOrTracker: missed.length, ofWhichUnsure: unsure, notAdOrTracker: [...reached.keys()].filter((host) => judgement[host] === 'no').length, unjudged: unjudged.length },
  blocked: { hostsPerOutlet: blockedHosts, requests: blockedRequests },
  missed: { hostsPerOutlet: missedHosts, requests: missedRequests },
  missRate: { byHost: Math.round((missedHosts / Math.max(1, missedHosts + blockedHosts)) * 1000) / 10, byRequest: Math.round((missedRequests / Math.max(1, missedRequests + blockedRequests)) * 1000) / 10 },
  cookiesFromOtherSites: { blockingOff: sum(before, 'cookies'), blockingOn: sum(after, 'cookies'), sitesOff: sum(before, 'cookieSites'), sitesOn: sum(after, 'cookieSites') },
  missedHosts: missed,
}
const { missedHosts: list, ...numbers } = summary
console.log(JSON.stringify(numbers, null, 1))
console.log(`missed: ${list.map((item) => `${item.host} (${item.verdict}, ${item.outlets})`).join(', ')}`)
if (unjudged.length) console.log(`\n${unjudged.length} hosts without a verdict:\n${unjudged.join('\n')}`)
if (args.includes('--write')) {
  writeFileSync(join(repo, 'docs/data/protection-holdout.json'), `${JSON.stringify({ about: 'Written by scripts/protection-holdout.mjs. The verdicts are in protection-holdout-judgement.json.', measured: on[0]?.startedAt?.slice(0, 10), ...summary }, null, 1)}\n`)
  console.log('Wrote docs/data/protection-holdout.json')
}
