'use strict'

const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { addBundledRuntimes, setReproducibleBomMetadata, sha256File, writeReleaseInventory } = require('./release-inventory.cjs')
const { macUpdateBuildSetting, normalizeMacUpdateUrl } = require('./update-config.cjs')
const { assertReleaseBom, buildReleaseBom, generateReleaseBom, licenceChoice, readBundledPackages, SENTINELS } = require('./release-bom.cjs')

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

// ---- The SBOM describes the application that ships (release-bom.cjs) ----

const runtime = { electronVersion: '45.0.0', chromiumVersion: '156.0.8078.48', electronToChromiumVersion: '1.5.463' }
const mit = [{ license: { id: 'MIT' } }]
const npmComponent = (name, version, extra = {}) => ({ 'bom-ref': `${name}@${version}`, type: 'library', name, version, scope: 'required', purl: `pkg:npm/${name.replace(/^@/, '%40')}@${version}`, licenses: mit, ...extra })

/** What `npm sbom --omit=dev` gives for a small app: the monorepo as root, the desktop workspace, and production dependencies. */
function npmBomFixture() {
  return addBundledRuntimes({
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    metadata: { tools: [{ vendor: 'npm', name: 'cli', version: '11' }], component: { 'bom-ref': 'intoponet@0.1.0', type: 'library', name: 'some-folder', version: '0.1.0' } },
    components: [
      { 'bom-ref': '@intoponet/desktop@0.1.25', type: 'library', name: 'desktop', version: '0.1.25', purl: 'pkg:npm/%40intoponet/desktop@0.1.25' },
      { 'bom-ref': '@intoponet/browser-api@0.1.0', type: 'library', name: 'browser-api', version: '0.1.0', purl: 'pkg:npm/%40intoponet/browser-api@0.1.0' },
      npmComponent('react', '19.3.1'),
      npmComponent('react-dom', '19.3.1'),
      npmComponent('three', '0.172.0'),
      npmComponent('buffer', '6.0.3'),
    ],
    dependencies: [
      { ref: 'intoponet@0.1.0', dependsOn: ['@intoponet/browser-api@0.1.0'] },
      { ref: '@intoponet/desktop@0.1.25', dependsOn: ['@intoponet/browser-api@0.1.0', 'react@19.3.1', 'react-dom@19.3.1', 'three@0.172.0'] },
      { ref: 'react-dom@19.3.1', dependsOn: ['react@19.3.1'] },
      { ref: 'three@0.172.0', dependsOn: ['buffer@6.0.3'] },
      { ref: 'buffer@6.0.3', dependsOn: [] },
    ],
  }, runtime)
}
const bundledFixture = () => [
  { target: 'main', files: ['index.js'], packages: [
    { name: '@cantoo/pdf-lib', version: '2.11.1', license: 'MIT', modules: 176 },
    { name: 'fflate', version: '0.8.3', license: 'MIT', modules: 1 },
    { name: '@mozilla/readability', version: '0.6.0', license: 'Apache-2.0', modules: 2 },
    { name: 'dompurify', version: '3.4.17', license: '(MPL-2.0 OR Apache-2.0)', modules: 1 },
  ] },
  { target: 'preload', files: ['index.js'], packages: [] },
  { target: 'renderer', files: ['index.html'], packages: [
    { name: 'react', version: '19.3.1', license: 'MIT', modules: 10 },
    { name: 'react-dom', version: '19.3.1', license: 'MIT', modules: 10 },
    { name: 'three', version: '0.172.0', license: 'MIT', modules: 2 },
    { name: '@fontsource-variable/inter', version: '5.3.0', license: 'OFL-1.1', modules: 17 },
  ] },
]
const lockFixture = { packages: {
  'node_modules/@cantoo/pdf-lib': { version: '2.11.1', resolved: 'https://registry.npmjs.org/@cantoo/pdf-lib/-/pdf-lib-2.11.1.tgz', integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`, dependencies: { fflate: '^0.8.2' } },
  'node_modules/fflate': { version: '0.8.3' },
} }
const glueFile = { type: 'file', 'bom-ref': 'intoponet:file:bergamot-translator.js', name: 'bergamot-translator.js', hashes: [{ alg: 'SHA-256', content: 'a'.repeat(64) }], licenses: [{ license: { id: 'MPL-2.0' } }] }
const fixtureBom = () => buildReleaseBom({ npmBom: npmBomFixture(), bundled: bundledFixture(), version: '0.1.25', lockfile: lockFixture, filesAndData: [glueFile] })

test('the SBOM is rooted at the application with the app version, not at the npm workspace', () => {
  const bom = fixtureBom()
  assert.deepEqual(
    { type: bom.metadata.component.type, name: bom.metadata.component.name, version: bom.metadata.component.version },
    { type: 'application', name: 'Intoponet', version: '0.1.25' },
  )
  assert.deepEqual(bom.metadata.lifecycles, [{ phase: 'build' }])
  // The desktop workspace is the application itself, not one of its components.
  assert.equal(bom.components.some((component) => component['bom-ref'] === '@intoponet/desktop@0.1.25'), false)
  const rootGraph = bom.dependencies.find((dependency) => dependency.ref === bom.metadata.component['bom-ref'])
  for (const ref of ['react@19.3.1', 'three@0.172.0', '@intoponet/browser-api@0.1.0', 'pkg:npm/electron@45.0.0', '@cantoo/pdf-lib@2.11.1', 'dompurify@3.4.17', 'intoponet:file:bergamot-translator.js']) {
    assert.ok(rootGraph.dependsOn.includes(ref), `the application does not depend on ${ref}`)
  }
  assert.doesNotThrow(() => assertReleaseBom(bom, { version: '0.1.25' }))
})

test('libraries compiled into the app are listed even when npm calls them development dependencies', () => {
  const bom = fixtureBom()
  const byRef = new Map(bom.components.map((component) => [component['bom-ref'], component]))
  const pdf = byRef.get('@cantoo/pdf-lib@2.11.1')
  assert.equal(pdf.purl, 'pkg:npm/%40cantoo/pdf-lib@2.11.1')
  assert.equal(pdf.scope, 'required')
  assert.deepEqual(pdf.licenses, mit)
  assert.equal(pdf.hashes[0].alg, 'SHA-512')
  assert.match(pdf.properties[0].value, /compiled into the app by the build \(main\)/)
  assert.deepEqual(byRef.get('dompurify@3.4.17').licenses, [{ expression: '(MPL-2.0 OR Apache-2.0)' }])
  // fflate came in through pdf-lib: it hangs off pdf-lib, not off the application.
  assert.deepEqual(bom.dependencies.find((dependency) => dependency.ref === '@cantoo/pdf-lib@2.11.1').dependsOn, ['fflate@0.8.3'])
  assert.equal(bom.dependencies[0].dependsOn.includes('fflate@0.8.3'), false)
  // A production dependency with no module in the app stays on the list, marked as not shipped.
  assert.equal(byRef.get('buffer@6.0.3').scope, 'excluded')
  assert.equal(byRef.get('react@19.3.1').scope, 'required')
  assert.match(byRef.get('react@19.3.1').properties.at(-1).value, /renderer/)
  // Intoponet's own packages, Electron and Chromium all carry a licence.
  for (const component of bom.components) assert.ok(component.licenses?.length, `${component.name} has no licence`)
  assert.equal(new Set(bom.components.map((component) => component['bom-ref'])).size, bom.components.length)
})

test('the release stops when a library known to ship is missing, the root is wrong or a component has no licence', () => {
  assert.deepEqual(SENTINELS.filter((name) => ['react', 'three', 'dompurify', '@cantoo/pdf-lib', '@mozilla/readability'].includes(name)).length, 5)
  for (const name of ['react', 'three', 'dompurify', '@cantoo/pdf-lib', '@mozilla/readability', '@fontsource-variable/inter']) {
    const bundled = bundledFixture().map((record) => ({ ...record, packages: record.packages.filter((item) => item.name !== name) }))
    const npmBom = npmBomFixture()
    const bom = buildReleaseBom({ npmBom, bundled, version: '0.1.25', lockfile: lockFixture, filesAndData: [glueFile] })
    // (react and three stay on the list from the lock file, but only as "excluded": that is not shipping.)
    assert.throws(() => assertReleaseBom(bom, { version: '0.1.25' }), new RegExp(`${name.replace('/', '\\/')} ships in the app but is not listed as shipped`))
  }
  // What `npm sbom` alone produced: the workspace as root, no bundled development dependencies, no licences on Intoponet's own packages.
  assert.throws(() => assertReleaseBom(npmBomFixture(), { version: '0.1.25' }), /root component is library "some-folder".*dompurify ships in the app/s)
  assert.throws(() => assertReleaseBom(fixtureBom(), { version: '0.1.26' }), /root component's version is 0\.1\.25, not the app's 0\.1\.26/)
  const unlicensed = fixtureBom()
  delete unlicensed.components.find((component) => component.name === 'fflate').licenses
  assert.throws(() => assertReleaseBom(unlicensed, { version: '0.1.25' }), /fflate@0\.8\.3 has no licence/)
  const emptyLicence = fixtureBom()
  emptyLicence.components.find((component) => component.name === 'three').licenses = [{ license: {} }]
  assert.throws(() => assertReleaseBom(emptyLicence, { version: '0.1.25' }), /three@0\.172\.0 has no licence/)
  const dangling = fixtureBom()
  dangling.dependencies[0].dependsOn.push('gone@1.0.0')
  assert.throws(() => assertReleaseBom(dangling, { version: '0.1.25' }), /depends on gone@1\.0\.0, which is not a component/)
  const unhashed = fixtureBom()
  delete unhashed.components.find((component) => component.type === 'file').hashes
  assert.throws(() => assertReleaseBom(unhashed, { version: '0.1.25' }), /bergamot-translator\.js has no checksum/)
  assert.deepEqual(licenceChoice('UNLICENSED'), null)
  assert.deepEqual(licenceChoice('SEE LICENSE IN LICENSE.txt'), [{ license: { name: 'SEE LICENSE IN LICENSE.txt' } }])
})

test('a missing record of what a build bundled, or one from another build, stops the SBOM', (t) => {
  const desktop = tempDir(t)
  assert.throws(() => readBundledPackages(desktop), /no record of what the main build bundled/)
  mkdirSync(path.join(desktop, '.bundled-packages'))
  for (const target of ['main', 'preload', 'renderer']) {
    mkdirSync(path.join(desktop, 'out', target), { recursive: true })
    writeFileSync(path.join(desktop, 'out', target, 'index.js'), '')
    writeFileSync(path.join(desktop, '.bundled-packages', `${target}.json`), JSON.stringify({ target, files: ['index.js'], packages: [] }))
  }
  assert.equal(readBundledPackages(desktop).length, 3)
  // The record names a chunk the build output no longer has: it was written by an earlier build.
  writeFileSync(path.join(desktop, '.bundled-packages', 'main.json'), JSON.stringify({ target: 'main', files: ['index.js', 'worker-OLD.js'], packages: [] }))
  assert.throws(() => readBundledPackages(desktop), /from another build than apps\/desktop\/out \(no out\/main\/worker-OLD\.js\)/)
  writeFileSync(path.join(desktop, '.bundled-packages', 'main.json'), JSON.stringify({ target: 'renderer', files: ['index.js'], packages: [] }))
  assert.throws(() => readBundledPackages(desktop), /not a record of the main build/)
})

// On a real build (npm run test:build builds first). Plain `npm test` does not depend on what is in out/.
const needsBuild = process.env.INTOPONET_REQUIRE_BUILD === '1' ? {} : { skip: 'reads a real build: run npm run test:build' }

test('the SBOM generated from the built app lists what the build compiled in, the shipped files and data, each with a licence', needsBuild, () => {
  const root = path.resolve(__dirname, '..')
  const version = JSON.parse(readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).version
  const bom = generateReleaseBom({ root, addRuntimes: (npmBom) => addBundledRuntimes(npmBom, runtime) })
  assert.doesNotThrow(() => assertReleaseBom(bom, { version }))
  assert.deepEqual({ type: bom.metadata.component.type, name: bom.metadata.component.name, version: bom.metadata.component.version }, { type: 'application', name: 'Intoponet', version })
  const shipped = bom.components.filter((component) => component.scope !== 'excluded')
  const names = new Set(shipped.map((component) => component.name))
  for (const name of [...SENTINELS, 'react-dom', 'fflate', 'jpeg-js', 'culori', 'node-html-better-parser', 'html-entities', 'tslib', 'lucide-react', 'motion']) assert.ok(names.has(name), `${name} is missing`)
  for (const component of bom.components) assert.ok(component.licenses?.length, `${component.name} has no licence`)
  const byType = (type) => bom.components.filter((component) => component.type === type).map((component) => component.name).sort()
  assert.deepEqual(byType('file'), ['bergamot-translator.js', 'earth-day.jpg', 'earth-night.jpg'])
  assert.deepEqual(byType('data'), ['GeoNames place directory', 'Intoponet ad and tracker list', 'Intoponet news feed directory', 'Natural Earth country shapes', 'Unicode CLDR region names'])
  const glue = bom.components.find((component) => component.name === 'bergamot-translator.js')
  assert.deepEqual(glue.licenses, [{ license: { id: 'MPL-2.0' } }])
  assert.equal(glue.hashes[0].content, 'faff1ef6285b0d26f01787776fd49299dfb756ecb9688aa990c250e66797b47d')
  assert.equal(bom.components.find((component) => component.name === 'earth-day.jpg').hashes[0].content, sha256File(path.join(root, 'apps/desktop/src/renderer/assets/earth-day.jpg')))
  // Stable when a source epoch is given, as the release sets it.
  const again = generateReleaseBom({ root, addRuntimes: (npmBom) => addBundledRuntimes(npmBom, runtime) })
  assert.equal(JSON.stringify(setReproducibleBomMetadata(bom, '1793251200')), JSON.stringify(setReproducibleBomMetadata(again, '1793251200')))
})
