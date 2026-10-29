'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { addBundledRuntimes, setReproducibleBomMetadata, sha256File, writeReleaseInventory } = require('./release-inventory.cjs')

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
})
