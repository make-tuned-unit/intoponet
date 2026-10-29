#!/usr/bin/env node
'use strict'

const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { readFileSync, statSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { normalizeMacUpdateUrl } = require('./update-config.cjs')

const root = path.resolve(__dirname, '..')

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function setReproducibleBomMetadata(bom, sourceDateEpoch = process.env.SOURCE_DATE_EPOCH) {
  if (sourceDateEpoch !== undefined) {
    if (!/^\d+$/.test(String(sourceDateEpoch))) throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer')
    bom.metadata ??= {}
    bom.metadata.timestamp = new Date(Number(sourceDateEpoch) * 1000).toISOString()
  }
  const material = { ...bom }
  delete material.serialNumber
  if (material.metadata) {
    material.metadata = { ...material.metadata }
    delete material.metadata.timestamp
  }
  const digest = createHash('sha256').update(stableStringify(material)).digest('hex').slice(0, 32).split('')
  digest[12] = '5'
  digest[16] = ((parseInt(digest[16], 16) & 0x3) | 0x8).toString(16)
  const hex = digest.join('')
  bom.serialNumber = `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  return bom
}

function addBundledRuntimes(bom, { electronVersion, chromiumVersion, electronToChromiumVersion }) {
  if (!electronVersion || !chromiumVersion || !electronToChromiumVersion) {
    throw new Error('Electron, Chromium, and mapping package versions are required')
  }
  const electronRef = `pkg:npm/electron@${electronVersion}`
  const chromiumRef = `pkg:generic/chromium@${chromiumVersion}`
  const components = bom.components ?? (bom.components = [])
  components.push({
    type: 'framework',
    'bom-ref': electronRef,
    name: 'electron',
    version: electronVersion,
    purl: electronRef,
    scope: 'required',
    description: 'Electron runtime shipped in the macOS app bundle.',
  })
  components.push({
    type: 'framework',
    'bom-ref': chromiumRef,
    name: 'Chromium',
    version: chromiumVersion,
    purl: chromiumRef,
    scope: 'required',
    description: 'Chromium runtime embedded by the shipped Electron version.',
    properties: [
      { name: 'intoponet:version-evidence', value: `electron-to-chromium@${electronToChromiumVersion} full-versions mapping` },
      { name: 'intoponet:runtime-component', value: 'bundled with Electron; not a separately installed package' },
    ],
  })
  const dependencies = bom.dependencies ?? (bom.dependencies = [])
  const desktopDependency = dependencies.find((dependency) => dependency.ref.startsWith('@intoponet/desktop@'))
  if (desktopDependency) desktopDependency.dependsOn = [...new Set([...desktopDependency.dependsOn, electronRef])]
  dependencies.push({ ref: electronRef, dependsOn: [chromiumRef] })
  return bom
}

function writeReleaseInventory({ outputDir, dmg, zip, updateUrl, mode, arch, version, bom, runtime }) {
  if (!['preview', 'release'].includes(mode)) throw new Error(`Unsupported package mode: ${mode}`)
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported architecture: ${arch}`)
  if (!path.isAbsolute(outputDir) || !path.isAbsolute(dmg)) throw new Error('Output directory and DMG path must be absolute')
  const resolvedOut = path.resolve(outputDir)
  const resolvedDmg = path.resolve(dmg)
  if (path.dirname(resolvedDmg) !== resolvedOut || path.extname(resolvedDmg).toLowerCase() !== '.dmg') {
    throw new Error('DMG must be a direct child of the mode-specific output directory')
  }
  const dmgStat = statSync(resolvedDmg)
  if (!dmgStat.isFile()) throw new Error('DMG artifact must be a regular file')

  let resolvedZip = null
  let zipStat = null
  if (zip !== undefined) {
    if (!path.isAbsolute(zip)) throw new Error('Update ZIP path must be absolute')
    resolvedZip = path.resolve(zip)
    if (path.dirname(resolvedZip) !== resolvedOut || path.extname(resolvedZip).toLowerCase() !== '.zip') {
      throw new Error('Update ZIP must be a direct child of the mode-specific output directory')
    }
    zipStat = statSync(resolvedZip)
    if (!zipStat.isFile()) throw new Error('Update ZIP must be a regular file')
  }

  const normalizedUpdateUrl = updateUrl ? normalizeMacUpdateUrl(updateUrl) : null
  if (updateUrl && !normalizedUpdateUrl) throw new Error('Update feed URL must be a trusted HTTPS host/path without credentials, query, or fragment')
  if (normalizedUpdateUrl && !resolvedZip) throw new Error('A configured update feed requires the macOS update ZIP')

  const sbomPath = path.join(resolvedOut, `Intoponet-${version}-${arch}.cdx.json`)
  const inventoryPath = path.join(resolvedOut, `Intoponet-${version}-${arch}.inventory.json`)
  const checksumsPath = path.join(resolvedOut, 'SHA256SUMS.txt')
  writeFileSync(sbomPath, `${JSON.stringify(bom, null, 2)}\n`)
  const artifacts = [
    { file: path.basename(resolvedDmg), bytes: dmgStat.size, sha256: sha256File(resolvedDmg) },
  ]
  if (resolvedZip && zipStat) artifacts.push({ file: path.basename(resolvedZip), bytes: zipStat.size, sha256: sha256File(resolvedZip) })
  let updateManifestPath = null
  if (normalizedUpdateUrl && resolvedZip && zipStat) {
    updateManifestPath = path.join(resolvedOut, 'releases.json')
    const sourceEpoch = process.env.SOURCE_DATE_EPOCH
    if (sourceEpoch !== undefined && !/^\d+$/.test(String(sourceEpoch))) throw new Error('SOURCE_DATE_EPOCH must be a non-negative integer')
    const pubDate = new Date(sourceEpoch === undefined ? Date.now() : Number(sourceEpoch) * 1000).toISOString()
    const release = {
      version,
      updateTo: {
        version,
        name: 'Intoponet',
        pub_date: pubDate,
        url: `${normalizedUpdateUrl}/${encodeURIComponent(path.basename(resolvedZip))}`,
        sha256: sha256File(resolvedZip),
        size: zipStat.size,
      },
    }
    writeFileSync(updateManifestPath, `${JSON.stringify({ currentRelease: version, releases: [release] }, null, 2)}\n`)
    artifacts.push({ file: path.basename(updateManifestPath), bytes: statSync(updateManifestPath).size, sha256: sha256File(updateManifestPath) })
  }
  artifacts.push({ file: path.basename(sbomPath), bytes: statSync(sbomPath).size, sha256: sha256File(sbomPath) })
  const inventory = {
    schemaVersion: 1,
    product: 'Intoponet',
    version,
    platform: 'macOS',
    architecture: arch,
    mode,
    artifacts,
    updates: {
      enabled: Boolean(normalizedUpdateUrl),
      protocol: normalizedUpdateUrl ? 'Electron native autoUpdater / Squirrel.Mac JSON feed' : null,
      feedUrl: normalizedUpdateUrl ? `${normalizedUpdateUrl}/releases.json` : null,
      manifest: updateManifestPath ? path.basename(updateManifestPath) : null,
      checks: 'manual only; check and download are one explicit user action',
      persistentUpdaterIdentifier: false,
    },
    runtime: {
      electron: runtime.electronVersion,
      chromium: runtime.chromiumVersion,
      chromiumVersionEvidence: `electron-to-chromium@${runtime.electronToChromiumVersion} full-versions mapping for Electron ${runtime.electronVersion}`,
    },
    dependencyTreatment: {
      productionDependencyGraph: 'npm lockfile graph for @intoponet/desktop; workspace TypeScript packages are bundled into app.asar by electron-vite',
      licenseReview: 'Package license metadata is inventory input only; no exhaustive license review is asserted.',
    },
  }
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)
  const checksumFiles = [resolvedDmg, ...(resolvedZip ? [resolvedZip] : []), ...(updateManifestPath ? [updateManifestPath] : []), sbomPath, inventoryPath]
  writeFileSync(checksumsPath, `${checksumFiles.map((file) => `${sha256File(file)}  ${path.basename(file)}`).join('\n')}\n`)
  return { sbomPath, inventoryPath, checksumsPath, updateManifestPath, inventory }
}

function main(args) {
  const [mode, arch, dmg, zip, updateUrl] = args
  if (!['preview', 'release'].includes(mode) || !['arm64', 'x64'].includes(arch) || !dmg) {
    throw new Error('usage: node scripts/release-inventory.cjs <preview|release> <arm64|x64> <absolute-dmg-path>')
  }
  const desktopPackage = JSON.parse(readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8'))
  const electronPackage = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8'))
  const e2cPackage = JSON.parse(readFileSync(path.join(root, 'node_modules/electron-to-chromium/package.json'), 'utf8'))
  const lockfile = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  if (lockfile.packages?.['node_modules/electron']?.version !== electronPackage.version
    || lockfile.packages?.['node_modules/electron-to-chromium']?.version !== e2cPackage.version) {
    throw new Error('Installed Electron runtime metadata differs from the package lockfile; run npm ci before packaging')
  }
  const chromiumVersion = require(path.join(root, 'node_modules/electron-to-chromium/full-versions.js'))[electronPackage.version]
  if (!chromiumVersion) throw new Error(`No Chromium version mapping for Electron ${electronPackage.version}`)
  const sbomText = execFileSync('npm', [
    'sbom', '--workspace', '@intoponet/desktop', '--omit=dev', '--sbom-format=cyclonedx', '--package-lock-only',
  ], { cwd: root, encoding: 'utf8' })
  const bom = addBundledRuntimes(JSON.parse(sbomText), {
    electronVersion: electronPackage.version,
    chromiumVersion,
    electronToChromiumVersion: e2cPackage.version,
  })
  setReproducibleBomMetadata(bom)
  const outputDir = path.dirname(path.resolve(dmg))
  const result = writeReleaseInventory({
    outputDir,
    dmg: path.resolve(dmg),
    ...(zip ? { zip: path.resolve(zip) } : {}),
    ...(updateUrl ? { updateUrl } : {}),
    mode,
    arch,
    version: desktopPackage.version,
    bom,
    runtime: {
      electronVersion: electronPackage.version,
      chromiumVersion,
      electronToChromiumVersion: e2cPackage.version,
    },
  })
  console.log(`Wrote CycloneDX SBOM: ${result.sbomPath}`)
  console.log(`Wrote release inventory and SHA-256 checksums: ${result.inventoryPath}`)
}

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`release inventory: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { addBundledRuntimes, setReproducibleBomMetadata, sha256File, writeReleaseInventory }
