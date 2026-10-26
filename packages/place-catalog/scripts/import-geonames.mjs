#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, open, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const MAX_FEATURE_ROWS = 20_000_000
const MAX_METADATA_ROWS = 500_000
const MAX_LINE_BYTES = 1_000_000
if (process.argv.includes('--help')) {
  process.stdout.write('Usage: npm run import:geonames --workspace @intoponet/place-catalog -- --countries countryInfo.txt --admin1 admin1CodesASCII.txt --admin2 admin2Codes.txt --places allCountries.txt --snapshot-date YYYY-MM-DD --scope allCountries|cities15000 --out NEW_OUTPUT_DIRECTORY\n')
  process.exit(0)
}

function args(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!key?.startsWith('--') || !argv[i + 1]) throw new Error(`Expected --option value; got ${key ?? ''}`)
    result[key.slice(2)] = argv[i + 1]
  }
  for (const key of ['countries', 'admin1', 'admin2', 'places', 'snapshot-date', 'scope', 'out']) {
    if (!result[key]) throw new Error(`Missing required --${key}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result['snapshot-date']) || new Date(`${result['snapshot-date']}T00:00:00Z`).toISOString().slice(0, 10) !== result['snapshot-date']) throw new Error('--snapshot-date must be a valid UTC YYYY-MM-DD date')
  if (!['allCountries', 'cities15000'].includes(result.scope)) throw new Error('--scope must be allCountries or cities15000')
  return result
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function* rows(path, maxRows) {
  let count = 0
  const input = createReadStream(path)
  const rl = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line || line.startsWith('#')) continue
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) throw new Error(`${basename(path)} has line longer than ${MAX_LINE_BYTES} bytes`)
      if (++count > maxRows) throw new Error(`${basename(path)} exceeds bounded row limit ${maxRows}`)
      yield line
    }
  } finally {
    rl.close()
    input.destroy()
  }
}

function requiredId(value, file) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid GeoNames ID in ${file}: ${value ?? ''}`)
  return id
}

async function loadMetadata(path, kind) {
  const data = new Map()
  const ids = new Map()
  for await (const line of rows(path, MAX_METADATA_ROWS)) {
    const c = line.split('\t')
    let key, name, asciiName, id
    if (kind === 'country') {
      key = c[0]?.trim().toUpperCase(); name = c[4]?.trim(); asciiName = name; id = requiredId(c[16], path)
    } else {
      key = c[0]?.trim(); name = c[1]?.trim(); asciiName = c[2]?.trim(); id = requiredId(c[3], path)
    }
    if (!key || !name || !asciiName) throw new Error(`Malformed ${kind} row in ${path}`)
    if (data.has(key)) throw new Error(`Duplicate ${kind} key ${key}`)
    if (ids.has(id)) throw new Error(`Duplicate GeoNames ID ${id} in ${path}`)
    data.set(key, { key, name, asciiName, geonameId: id })
    ids.set(id, key)
  }
  return { data, ids }
}

async function run() {
  const option = args(process.argv.slice(2))
  const sources = Object.fromEntries(['countries', 'admin1', 'admin2', 'places'].map(key => [key, resolve(option[key])]))
  for (const [key, path] of Object.entries(sources)) {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`${key} input is not a regular file: ${path}`)
  }
  const output = resolve(option.out)
  try { await stat(output); throw new Error(`Output already exists: ${output}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const parentDir = dirname(output)
  await mkdir(parentDir, { recursive: true })
  const stage = await mkdtemp(join(parentDir, `.${basename(output)}.stage-`))
  const seenIds = new Set()
  let outputHandle
  try {
    const [country, admin1, admin2] = await Promise.all([
      loadMetadata(sources.countries, 'country'), loadMetadata(sources.admin1, 'admin1'), loadMetadata(sources.admin2, 'admin2'),
    ])
    const hashes = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([key, path]) => [key, { file: basename(path), sha256: await sha256(path) }])))
    const outputPath = join(stage, 'places.ndjson')
    outputHandle = await open(outputPath, 'wx')
    const writeNode = async node => { await outputHandle.write(`${JSON.stringify(node)}\n`) }
    const claimId = id => {
      if (seenIds.has(id)) throw new Error(`Duplicate/conflicting GeoNames ID ${id} in imported records`)
      seenIds.add(id)
    }
    for (const row of country.data.values()) {
      claimId(row.geonameId)
      await writeNode({ id: `geonames:${row.geonameId}`, geonameId: row.geonameId, kind: 'country', name: row.name, asciiName: row.asciiName, countryCode: row.key, precision: 'country' })
    }
    for (const row of admin1.data.values()) {
      claimId(row.geonameId)
      const countryCode = row.key.split('.')[0].toUpperCase()
      const parent = country.data.get(countryCode)
      await writeNode({ id: `geonames:${row.geonameId}`, geonameId: row.geonameId, kind: 'admin1', name: row.name, asciiName: row.asciiName, countryCode, ...(parent ? { parentId: `geonames:${parent.geonameId}` } : {}), precision: 'admin1-point' })
    }
    for (const row of admin2.data.values()) {
      claimId(row.geonameId)
      const [countryCode, admin1Code] = row.key.split('.')
      const parent = admin1.data.get(`${countryCode}.${admin1Code}`) ?? country.data.get(countryCode)
      await writeNode({ id: `geonames:${row.geonameId}`, geonameId: row.geonameId, kind: 'admin2', name: row.name, asciiName: row.asciiName, countryCode: countryCode.toUpperCase(), ...(parent ? { parentId: `geonames:${parent.geonameId}` } : {}), precision: 'admin2-point' })
    }
    let populatedCount = 0
    for await (const line of rows(sources.places, MAX_FEATURE_ROWS)) {
      const c = line.split('\t')
      if (c.length < 19) throw new Error('Malformed populated places input: expected GeoNames 19-column rows')
      if (c[6] !== 'P') continue
      const id = requiredId(c[0], sources.places)
      claimId(id)
      const countryCode = c[8]?.trim().toUpperCase()
      if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) continue
      if (!c[4]?.trim() || !c[5]?.trim()) throw new Error(`Missing coordinates in GeoNames record ${id}`)
      const latitude = Number(c[4]); const longitude = Number(c[5]); const population = Number(c[14])
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error(`Invalid coordinates in GeoNames record ${id}`)
      const name = c[1]?.trim(); const asciiName = c[2]?.trim()
      if (!name || !asciiName) throw new Error(`Missing name in GeoNames record ${id}`)
      const admin1Code = c[10]?.trim(); const admin2Code = c[11]?.trim()
      const admin2Key = admin2Code ? `${countryCode}.${admin1Code ?? ''}.${admin2Code}` : ''
      const admin1Key = admin1Code ? `${countryCode}.${admin1Code}` : ''
      const parent = (admin2Key && admin2.data.get(admin2Key)) || (admin1Key && admin1.data.get(admin1Key)) || country.data.get(countryCode)
      await writeNode({
        id: `geonames:${id}`, geonameId: id, kind: 'populated-place', name, asciiName, countryCode,
        ...(parent ? { parentId: `geonames:${parent.geonameId}` } : {}), ...(admin1Code ? { admin1Code } : {}), ...(admin2Code ? { admin2Code } : {}),
        ...(c[7]?.trim() ? { featureCode: c[7].trim() } : {}), latitude, longitude,
        ...(Number.isFinite(population) && population >= 0 ? { population } : {}), precision: 'populated-place-point',
      })
      populatedCount++
    }
    await outputHandle.sync()
    await outputHandle.close()
    outputHandle = undefined
    for (const [key, path] of Object.entries(sources)) {
      if (await sha256(path) !== hashes[key].sha256) throw new Error(`Source changed during import: ${basename(path)}`)
    }
    const outputSha256 = await sha256(outputPath)
    const manifest = {
      formatVersion: 1,
      dataset: 'GeoNames place catalog',
      snapshotDate: option['snapshot-date'],
      sourceScope: option.scope === 'allCountries' ? 'allCountries-populated-features' : 'cities15000-subset',
      coverageNote: option.scope === 'allCountries' ? 'Populated feature (P) records in this GeoNames snapshot; not a guarantee of all real-world settlements or service coverage.' : 'GeoNames cities15000 subset (population >15000 or capitals); not all populated places.',
      sourceFiles: hashes,
      counts: { countries: country.data.size, admin1: admin1.data.size, admin2: admin2.data.size, populatedPlaces: populatedCount },
      output: { file: 'places.ndjson', sha256: outputSha256 },
      license: 'CC-BY-4.0',
      attribution: 'GeoNames (https://www.geonames.org/)',
      generatedAt: new Date().toISOString(),
    }
    const manifestHandle = await open(join(stage, 'manifest.json'), 'wx')
    await manifestHandle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`)
    await manifestHandle.sync()
    await manifestHandle.close()
    await rename(stage, output)
    process.stdout.write(`${JSON.stringify({ output, counts: manifest.counts, sourceFiles: Object.keys(hashes) })}\n`)
  } catch (error) {
    if (outputHandle) await outputHandle.close().catch(() => {})
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

run().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
