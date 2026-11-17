#!/usr/bin/env node
// Fetches the public filter lists the app blocks ads and trackers with, exactly as published,
// into packages/protection-engine/lists/, and records where each came from, when, and its
// SHA-256 in manifest.json. The list files are never edited by hand: run this to update them
// (their publishers ask for a refresh every few days; run it before each release).
//
//   node scripts/update-protection-lists.mjs           fetch the lists and rewrite the manifest
//   node scripts/update-protection-lists.mjs --check   only check the files against the manifest
//
// Licence: both lists are used under Creative Commons Attribution-ShareAlike 3.0 Unported (or
// later), one of the two licences their authors offer (https://easylist.to/pages/licence.html).
// The fetch stops if that page no longer says so. See THIRD_PARTY_NOTICES.md.

import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const listsDir = join(root, 'packages/protection-engine/lists')
const manifestPath = join(listsDir, 'manifest.json')

const LICENCE_PAGE = 'https://easylist.to/pages/licence.html'
const LICENCE = 'CC BY-SA 3.0 Unported or later (offered with GPL-3.0-or-later; used under CC BY-SA)'
const LICENCE_URL = 'https://creativecommons.org/licenses/by-sa/3.0/'
const ATTRIBUTION = 'The EasyList authors (https://easylist.to/)'

const LISTS = [
  { file: 'easylist.txt', title: 'EasyList', blocks: 'ads', url: 'https://easylist.to/easylist/easylist.txt' },
  { file: 'easyprivacy.txt', title: 'EasyPrivacy', blocks: 'trackers', url: 'https://easylist.to/easylist/easyprivacy.txt' },
]

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The value of a "! Name: value" line in a list's header. */
function headerField(text, name) {
  return text.slice(0, 4000).match(new RegExp(`^! ${name}: (.+)$`, 'm'))?.[1]?.trim() ?? null
}

/** What must be true of a list file, fetched or on disk: it is the list named, whole, with its header. */
function listProblems(list, bytes) {
  const text = bytes.toString('utf8')
  const problems = []
  if (!text.startsWith('[Adblock Plus')) problems.push('does not start with the "[Adblock Plus …]" line')
  if (headerField(text, 'Title') !== list.title) problems.push(`its header title is "${headerField(text, 'Title')}", not "${list.title}"`)
  if (headerField(text, 'Licence') !== LICENCE_PAGE) problems.push(`its header names the licence "${headerField(text, 'Licence')}", not ${LICENCE_PAGE}`)
  if (!headerField(text, 'Version')) problems.push('its header has no version')
  if (bytes.length < 500_000) problems.push(`it is only ${bytes.length} bytes (cut short?)`)
  return problems
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'filter-list-fetch' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function check() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const problems = []
  for (const list of LISTS) {
    const entry = manifest.lists.find((item) => item.file === list.file)
    const bytes = await readFile(join(listsDir, list.file))
    if (!entry) problems.push(`${list.file}: not in manifest.json`)
    else if (entry.sha256 !== sha256(bytes) || entry.bytes !== bytes.length) problems.push(`${list.file}: differs from manifest.json (edited by hand? run this script to fetch it again)`)
    for (const problem of listProblems(list, bytes)) problems.push(`${list.file}: ${problem}`)
  }
  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`The ${LISTS.length} lists match manifest.json (fetched ${manifest.fetchedAt}).`)
}

async function update() {
  // The licence first: nothing is written if the lists are no longer offered under CC BY-SA.
  const licencePage = (await fetchBytes(LICENCE_PAGE)).toString('utf8').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
  const statement = licencePage.match(/Unless otherwise noted, the contents of the EasyList repository.*?are included in the repository\./)?.[0]
  if (!statement || !/Creative Commons Attribution-ShareAlike 3\.0 Unported, or \(at your option\) any later version/.test(statement)) {
    throw new Error(`${LICENCE_PAGE} no longer states the CC BY-SA 3.0 licence as before. Read it, and review THIRD_PARTY_NOTICES.md, before shipping these lists.`)
  }
  const fetchedAt = new Date().toISOString()
  const entries = []
  const fetched = []
  for (const list of LISTS) {
    const bytes = await fetchBytes(list.url)
    const problems = listProblems(list, bytes)
    if (problems.length) throw new Error(`${list.url}: ${problems.join('; ')}`)
    const text = bytes.toString('utf8')
    fetched.push([list.file, bytes])
    entries.push({
      file: list.file,
      title: list.title,
      blocks: list.blocks,
      sourceUrl: list.url,
      fetchedAt,
      version: headerField(text, 'Version'),
      lastModified: headerField(text, 'Last modified'),
      commit: headerField(text, 'Commit'),
      bytes: bytes.length,
      sha256: sha256(bytes),
    })
  }
  await mkdir(listsDir, { recursive: true })
  for (const [file, bytes] of fetched) await writeFile(join(listsDir, file), bytes)
  const manifest = {
    about: 'Written by scripts/update-protection-lists.mjs. The list files are exactly as published; do not edit them or this file by hand.',
    fetchedAt,
    licence: LICENCE,
    licenceUrl: LICENCE_URL,
    licencePage: LICENCE_PAGE,
    licenceStatement: statement,
    attribution: ATTRIBUTION,
    lists: entries,
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(listsDir, 'NOTICE.txt'), notice(manifest))
  for (const entry of entries) console.log(`${entry.file}: version ${entry.version}, ${entry.bytes} bytes, sha256 ${entry.sha256}`)
}

/** The attribution that goes with the lists wherever they go (it is shipped beside them in the app). */
function notice(manifest) {
  return [
    'EasyList and EasyPrivacy',
    '',
    `${manifest.lists.map((entry) => `${entry.file} (${entry.title}, version ${entry.version})`).join(' and ')} in this folder are the work of`,
    `${manifest.attribution}. They are copied here exactly as published, fetched ${manifest.fetchedAt.slice(0, 10)} from`,
    ...manifest.lists.map((entry) => `  ${entry.sourceUrl}`),
    'and are used under the Creative Commons Attribution-ShareAlike 3.0 Unported licence, or (at your',
    `option) any later version: ${manifest.licenceUrl} (legal text: ${manifest.licenceUrl}legalcode).`,
    `The authors' licence statement is at ${manifest.licencePage}:`,
    '',
    `  "${manifest.licenceStatement}"`,
    '',
    'engine.bin in this folder is an adaptation of the two lists: their rules, compiled by',
    "Intoponet's build into the form its blocker loads. No rule is added or reworded; rules of kinds",
    'the blocker does not use (scriptlets, HTML filtering, Content-Security-Policy rules) are left out. It is',
    'offered under the same licence, CC BY-SA 3.0 Unported or later, with the same attribution. You may',
    'copy, share and adapt these three files under that licence. The licence covers these files only,',
    'not Intoponet, which reads them as data.',
    '',
    'The lists are provided by their authors as they are, without warranty of any kind.',
    '',
  ].join('\n')
}

try {
  await (process.argv.includes('--check') ? check() : update())
} catch (error) {
  console.error(`update-protection-lists: ${error.message}`)
  process.exitCode = 1
}
