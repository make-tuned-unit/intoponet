#!/usr/bin/env node
/**
 * Builds apps/desktop/src/main/translate/catalog.json: the pinned list of
 * on-device translation models Intoponet may download.
 *
 * Source: Mozilla's Firefox Translations models (MPL-2.0), as published in
 * Firefox Remote Settings (bucket main, collections translations-models and
 * translations-wasm). Every file is pinned by size and SHA-256 here, so the
 * app never trusts the server at download time.
 *
 * Selection mirrors desktop Firefox on the release channel: records whose
 * filter expression excludes desktop release are skipped, alphas are skipped,
 * and the highest version per language pair wins.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SETTINGS = 'https://firefox.settings.services.mozilla.com/v1'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../apps/desktop/src/main/translate/catalog.json')
/** Model major versions the pinned engine (bergamot-translator 3.0 / glue v0.6.0) runs. */
const MODEL_MAJORS = new Set([1, 2])
const ENGINE = { name: 'bergamot-translator', version: '3.0', glueVersion: 'v0.6.0+eea6e5a8' }

const FILTERS_FOR_DESKTOP_RELEASE = new Map([
  ['', true],
  ["env.appinfo.OS != 'Android' || env.channel != 'release'", true],
  ["env.appinfo.OS == 'Android' ", false],
  ["env.channel == 'default' || env.channel == 'nightly'", false],
  ["env.channel == 'default' || env.channel == 'nightly' || env.channel == 'beta'", false],
])

async function records(collection) {
  const response = await fetch(`${SETTINGS}/buckets/main/collections/${collection}/records`)
  if (!response.ok) throw new Error(`${collection}: HTTP ${response.status}`)
  return (await response.json()).data
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)$/.exec(value ?? '')
  return match ? [Number(match[1]), Number(match[2])] : null
}

function desktopRelease(record) {
  const expression = record.filter_expression ?? ''
  if (!FILTERS_FOR_DESKTOP_RELEASE.has(expression)) throw new Error(`Unknown filter expression: ${expression}`)
  return FILTERS_FOR_DESKTOP_RELEASE.get(expression)
}

/** Remote Settings codes → BCP 47. */
const code = (value) => (value === 'zh_hant' ? 'zh-Hant' : value)

const [modelRecords, wasmRecords, server] = await Promise.all([
  records('translations-models'),
  records('translations-wasm'),
  fetch(`${SETTINGS}/`).then((response) => response.json()),
])

const byPair = new Map()
for (const record of modelRecords) {
  const version = parseVersion(record.version)
  if (!version || !MODEL_MAJORS.has(version[0]) || !desktopRelease(record)) continue
  const key = `${code(record.fromLang)}>${code(record.toLang)}>${record.version}`
  const entry = byPair.get(key) ?? { from: code(record.fromLang), to: code(record.toLang), version: record.version, rank: version, files: [] }
  entry.files.push({
    type: record.fileType,
    name: record.attachment.filename,
    bytes: record.attachment.size,
    sha256: record.attachment.hash,
    location: record.attachment.location,
  })
  byPair.set(key, entry)
}

const pairs = {}
for (const entry of byPair.values()) {
  const types = new Set(entry.files.map((file) => file.type))
  const complete = types.has('model') && types.has('lex') && (types.has('vocab') || (types.has('srcvocab') && types.has('trgvocab')))
  if (!complete) continue
  const id = `${entry.from}-${entry.to}`
  const current = pairs[id]
  if (current && (current.rank[0] > entry.rank[0] || (current.rank[0] === entry.rank[0] && current.rank[1] >= entry.rank[1]))) continue
  pairs[id] = entry
}

const engine = wasmRecords.find((record) => record.name === ENGINE.name && record.version === ENGINE.version)
if (!engine) throw new Error('Pinned engine record not found.')

const catalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: 'Mozilla Firefox Translations — Firefox Remote Settings (main/translations-models, main/translations-wasm)',
  licence: 'MPL-2.0',
  licenceUrl: 'https://mozilla.org/MPL/2.0/',
  attachmentsBase: server.capabilities.attachments.base_url,
  engine: {
    ...ENGINE,
    file: { name: engine.attachment.filename, bytes: engine.attachment.size, sha256: engine.attachment.hash, location: engine.attachment.location },
  },
  pairs: Object.fromEntries(
    Object.entries(pairs)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, { from, to, version, files }]) => [id, { from, to, version, files: files.sort((a, b) => a.type.localeCompare(b.type)) }]),
  ),
}

writeFileSync(OUT, `${JSON.stringify(catalog, null, 1)}\n`)
const ids = Object.keys(catalog.pairs)
console.log(`${ids.length} pairs · into English ${ids.filter((id) => id.endsWith('-en')).length} · from English ${ids.filter((id) => id.startsWith('en-')).length}`)
console.log(`engine ${ENGINE.name} ${ENGINE.version} ${catalog.engine.file.bytes} bytes`)
