'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { addBundledRuntimes, setReproducibleBomMetadata, sha256File, writeReleaseInventory } = require('./release-inventory.cjs')
const { macUpdateBuildSetting, normalizeMacUpdateUrl } = require('./update-config.cjs')

function tempDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'intoponet-release-inventory-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('CycloneDX explicitly describes the shipped Electron and embedded Chromium versions', () => {
  const bom = { components: [], dependencies: [{ ref: '@intoponet/desktop@0.1.0', dependsOn: [] }] }
  addBundledRuntimes(bom, {
    electronVersion: '45.0.0',
    chromiumVersion: '156.0.8078.48',
    electronToChromiumVersion: '1.5.463',
  })
  assert.deepEqual(bom.components.map((component) => component.version), ['45.0.0', '156.0.8078.48'])
  assert.ok(bom.dependencies.some((dependency) => dependency.ref === '@intoponet/desktop@0.1.0'
    && dependency.dependsOn.includes('pkg:npm/electron@45.0.0')))
  assert.deepEqual(bom.dependencies.find((dependency) => dependency.ref === 'pkg:npm/electron@45.0.0').dependsOn,
    ['pkg:generic/chromium@156.0.8078.48'])
  assert.match(bom.components[1].properties[0].value, /electron-to-chromium@1\.5\.463/)
})

test('SBOM metadata is byte-stable when a source epoch is supplied', () => {
  const makeBom = () => ({ metadata: { timestamp: 'volatile' }, components: [{ name: 'runtime', version: '1' }] })
  const first = setReproducibleBomMetadata(makeBom(), '1793251200')
  const second = setReproducibleBomMetadata(makeBom(), '1793251200')
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.equal(first.metadata.timestamp, new Date(1793251200 * 1000).toISOString())
  assert.match(first.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/)
  assert.throws(() => setReproducibleBomMetadata(makeBom(), 'invalid'), /SOURCE_DATE_EPOCH/)
})

test('inventory and sums identify exact DMG and SBOM bytes in a mode-specific directory', (t) => {
  const outputDir = tempDir(t)
  const dmg = path.join(outputDir, 'Intoponet-0.1.0-arm64.dmg')
  writeFileSync(dmg, 'final stapled artifact bytes')
  const result = writeReleaseInventory({
    outputDir,
    dmg,
    mode: 'release',
    arch: 'arm64',
    version: '0.1.0',
    bom: { bomFormat: 'CycloneDX', specVersion: '1.5', components: [], dependencies: [] },
    runtime: { electronVersion: '45.0.0', chromiumVersion: '156.0.8078.48', electronToChromiumVersion: '1.5.463' },
  })
  const sums = readFileSync(result.checksumsPath, 'utf8')
  assert.equal(result.inventory.artifacts[0].sha256, sha256File(dmg))
  assert.equal(result.inventory.artifacts[1].sha256, sha256File(result.sbomPath))
  for (const file of [path.basename(dmg), path.basename(result.sbomPath), path.basename(result.inventoryPath)]) {
    assert.match(sums, new RegExp(`^[a-f0-9]{64}  ${file}$`, 'm'))
  }
  assert.equal(JSON.parse(readFileSync(result.inventoryPath, 'utf8')).mode, 'release')
  assert.equal(result.inventory.dependencyTreatment.licenseReview.includes('no exhaustive'), true)
  assert.equal(result.inventory.updates.enabled, false)
})

test('configured native macOS updater inventory hashes final ZIP and feed manifest bytes', (t) => {
  const outputDir = tempDir(t)
  const dmg = path.join(outputDir, 'Intoponet-0.1.0-arm64.dmg')
  const zip = path.join(outputDir, 'Intoponet-0.1.0-arm64-mac.zip')
  writeFileSync(dmg, 'final stapled DMG')
  writeFileSync(zip, 'final stapled app ZIP')
  const result = writeReleaseInventory({
    outputDir,
    dmg,
    zip,
    updateUrl: 'https://updates.example.org/mac',
    mode: 'release',
    arch: 'arm64',
    version: '0.1.0',
    bom: { bomFormat: 'CycloneDX', specVersion: '1.5', components: [], dependencies: [] },
    runtime: { electronVersion: '45.0.0', chromiumVersion: '156.0.8078.48', electronToChromiumVersion: '1.5.463' },
  })
  const feed = JSON.parse(readFileSync(result.updateManifestPath, 'utf8'))
  assert.equal(feed.currentRelease, '0.1.0')
  assert.equal(feed.releases[0].updateTo.url, 'https://updates.example.org/mac/Intoponet-0.1.0-arm64-mac.zip')
  assert.equal(feed.releases[0].updateTo.sha256, sha256File(zip))
  assert.equal(feed.releases[0].updateTo.size, Buffer.byteLength('final stapled app ZIP'))
  assert.equal(result.inventory.updates.enabled, true)
  assert.equal(result.inventory.updates.feedUrl, 'https://updates.example.org/mac/releases.json')
  assert.equal(result.inventory.artifacts.find((artifact) => artifact.file.endsWith('.zip')).sha256, sha256File(zip))
  assert.match(readFileSync(result.checksumsPath, 'utf8'), new RegExp(`^[a-f0-9]{64}  ${path.basename(result.updateManifestPath)}$`, 'm'))
})

test('update URL configuration accepts HTTPS host paths and rejects embedded tokens or local endpoints', () => {
  assert.equal(normalizeMacUpdateUrl('https://updates.example.org/releases/'), 'https://updates.example.org/releases')
  for (const value of ['http://updates.example.org', 'https://u:p@updates.example.org', 'https://updates.example.org?token=x', 'https://localhost', 'https://10.0.0.2', 'https://updates.local']) {
    assert.equal(normalizeMacUpdateUrl(value), null)
  }
  assert.equal(macUpdateBuildSetting('preview', { INTOPONET_MAC_UPDATE_URL: 'https://updates.example.org' }), '')
  assert.equal(macUpdateBuildSetting('release', { INTOPONET_MAC_UPDATE_URL: 'https://updates.example.org' }), 'https://updates.example.org')
  assert.throws(() => macUpdateBuildSetting('release', { INTOPONET_MAC_UPDATE_URL: 'http://updates.example.org' }), /INTOPONET_MAC_UPDATE_URL/)
})

test('rejects invalid mode, architecture, and DMG outside the selected artifact directory', (t) => {
  const outputDir = tempDir(t)
  const dmg = path.join(outputDir, 'artifact.dmg')
  writeFileSync(dmg, 'dmg')
  const options = {
    outputDir,
    dmg,
    mode: 'preview',
    arch: 'arm64',
    version: '0.1.0',
    bom: { components: [] },
    runtime: { electronVersion: '45', chromiumVersion: '156', electronToChromiumVersion: '1.5' },
  }
  assert.throws(() => writeReleaseInventory({ ...options, mode: 'other' }), /Unsupported package mode/)
  assert.throws(() => writeReleaseInventory({ ...options, arch: 'universal' }), /Unsupported architecture/)
  assert.throws(() => writeReleaseInventory({ ...options, dmg: path.join(outputDir, 'nested', 'artifact.dmg') }), /direct child/)
  assert.throws(() => writeReleaseInventory({ ...options, updateUrl: 'https://updates.example.org' }), /requires the macOS update ZIP/)
  const zip = path.join(outputDir, 'artifact.zip')
  writeFileSync(zip, 'zip')
  assert.throws(() => writeReleaseInventory({ ...options, zip: path.join(outputDir, 'nested', 'artifact.zip') }), /direct child/)
})
