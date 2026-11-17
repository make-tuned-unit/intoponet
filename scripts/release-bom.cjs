'use strict'

// The release SBOM (CycloneDX) describes the application that ships:
//   - its root is the application, Intoponet, at the desktop app's version;
//   - its libraries are the npm packages the build compiled into the app, as recorded by the build
//     itself (apps/desktop/bundledPackages.ts writes apps/desktop/.bundled-packages/*.json). A
//     production dependency in the lock file that left no module in the app is kept, marked
//     "excluded", so the list never says less than `npm sbom --omit=dev` did;
//   - Electron and Chromium are added by hand (release-inventory.cjs), and so are the files and
//     data sets that ship without being npm packages: the MPL-2.0 translation glue, the two Earth
//     textures, the place, country-name and country-shape data, the news feed directory and the
//     ad and tracker list.
// assertReleaseBom is the gate: the release fails if a library known to ship is missing, if the
// root is wrong or if any component has no licence.

const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const BUILD_TARGETS = ['main', 'preload', 'renderer']
/** Libraries the app cannot be built without. If one is missing from the SBOM, the SBOM is wrong. */
const SENTINELS = ['react', 'react-dom', 'three', 'dompurify', '@cantoo/pdf-lib', '@mozilla/readability', '@fontsource-variable/inter', 'electron', 'Chromium']
const PROPRIETARY = "Proprietary: Intoponet's own, all rights reserved (see LICENSE)"

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const npmRef = (name, version) => `${name}@${version}`
const npmPurl = (name, version) => `pkg:npm/${name.replace(/^@/, '%40')}@${version}`
/** The full name of an npm component: npm's SBOM keeps a scope in `group`, or only in the bom-ref. */
function fullName(component) {
  if (component.group) return `${component.group}/${component.name}`
  const ref = String(component['bom-ref'] ?? '')
  const scoped = /^(@[^/]+\/[^@]+)@/.exec(ref)
  return scoped && scoped[1].endsWith(`/${component.name}`) ? scoped[1] : component.name
}

/** A package.json licence string as a CycloneDX licence choice. */
function licenceChoice(licence) {
  const text = String(licence ?? '').trim()
  if (!text || text === 'UNLICENSED') return null
  if (/\s(OR|AND|WITH)\s/.test(text)) return [{ expression: text }]
  if (/^[A-Za-z0-9.+-]+$/.test(text)) return [{ license: { id: text } }]
  return [{ license: { name: text } }]
}

function hasLicence(component) {
  return Array.isArray(component.licenses) && component.licenses.length > 0
    && component.licenses.every((entry) => Boolean(entry && (entry.expression || entry.license?.id || entry.license?.name)))
}

/** What each build compiled in, read from the files the build wrote; every file a build listed must still be in out/. */
function readBundledPackages(desktopDir = path.join(repoRoot, 'apps/desktop')) {
  return BUILD_TARGETS.map((target) => {
    const file = path.join(desktopDir, '.bundled-packages', `${target}.json`)
    if (!existsSync(file)) throw new Error(`no record of what the ${target} build bundled (${file}); run npm run build`)
    const record = JSON.parse(readFileSync(file, 'utf8'))
    if (record.target !== target || !Array.isArray(record.packages) || !Array.isArray(record.files) || !record.files.length) {
      throw new Error(`${file} is not a record of the ${target} build`)
    }
    const missing = record.files.filter((name) => !existsSync(path.join(desktopDir, 'out', target, name)))
    if (missing.length) throw new Error(`${file} is from another build than apps/desktop/out (no out/${target}/${missing[0]}); run npm run build`)
    return record
  })
}

/** The files and data sets that ship inside the app without being npm packages. Hashes are of the source files. */
function shippedFilesAndData(root = repoRoot) {
  const file = (relative) => {
    const absolute = path.join(root, relative)
    if (!existsSync(absolute)) throw new Error(`a shipped file is missing: ${relative}`)
    return { relative, sha256: sha256(absolute) }
  }
  const component = ({ type, name, version, description, licenses, files, source, supplier, properties = [] }) => {
    const hashed = files.map(file)
    return {
      type,
      'bom-ref': `intoponet:${type}:${name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`,
      ...(supplier ? { supplier: { name: supplier } } : {}),
      name,
      ...(version ? { version } : {}),
      scope: 'required',
      description,
      // One file: its hash is the component's. Several: each is listed in the properties.
      ...(hashed.length === 1 ? { hashes: [{ alg: 'SHA-256', content: hashed[0].sha256 }] } : {}),
      licenses,
      ...(source ? { externalReferences: source.map(([kind, url]) => ({ type: kind, url })) } : {}),
      properties: [
        ...hashed.map((entry) => ({ name: 'intoponet:source-file', value: `${entry.relative} sha256:${entry.sha256}` })),
        ...properties.map(([key, value]) => ({ name: `intoponet:${key}`, value })),
      ],
    }
  }
  const nasaTerms = [{ license: { name: 'NASA Media Usage Guidelines (NASA content, generally not subject to copyright in the United States; NASA to be acknowledged as the source)', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/' } }]
  return [
    component({
      type: 'file',
      name: 'bergamot-translator.js',
      version: 'v0.6.0+eea6e5a8',
      supplier: 'Mozilla',
      description: "Mozilla's bergamot-translator JavaScript glue, unmodified. Ships as its own file, out/main/vendor/bergamot-translator.js in app.asar.",
      licenses: [{ license: { id: 'MPL-2.0' } }],
      files: ['apps/desktop/src/main/translate/vendor/bergamot-translator.js'],
      source: [
        ['vcs', 'https://github.com/mozilla/translations/commit/eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d'],
        ['license', 'https://mozilla.org/MPL/2.0/'],
      ],
      properties: [['modified', 'no'], ['shipped-as', 'out/main/vendor/bergamot-translator.js'], ['licence-text', 'LICENSES/MPL-2.0.txt in the app resources']],
    }),
    component({
      type: 'file',
      name: 'earth-day.jpg',
      version: '2004-10',
      supplier: 'NASA Earth Observatory',
      description: 'Blue Marble: Next Generation, October 2004, with topography and bathymetry, resized to 4096x2048. Credit: NASA Earth Observatory. NASA does not endorse Intoponet.',
      licenses: nasaTerms,
      files: ['apps/desktop/src/renderer/assets/earth-day.jpg'],
      source: [['distribution', 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/october/world.topo.bathy.200410.3x21600x10800.jpg'], ['website', 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/']],
      properties: [['provenance', 'apps/desktop/src/renderer/assets/earth-day.jpg.license']],
    }),
    component({
      type: 'file',
      name: 'earth-night.jpg',
      version: '2016',
      supplier: 'NASA Earth Observatory',
      description: 'Earth at Night (Black Marble) 2016, colour map, resized to 4096x2048. Credit: NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Román, NASA GSFC. NASA does not endorse Intoponet.',
      licenses: nasaTerms,
      files: ['apps/desktop/src/renderer/assets/earth-night.jpg'],
      source: [['distribution', 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg'], ['website', 'https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/']],
      properties: [['provenance', 'apps/desktop/src/renderer/assets/earth-night.jpg.license']],
    }),
    component({
      type: 'data',
      name: 'GeoNames place directory',
      supplier: 'GeoNames',
      description: 'Countries, first-level regions, and cities of 250,000 people or more and capitals, taken from GeoNames. Place data © GeoNames, CC BY 4.0. Compiled into the app.',
      licenses: [{ license: { id: 'CC-BY-4.0' } }],
      files: ['apps/desktop/src/shared/places/placeData.ts'],
      source: [['website', 'https://www.geonames.org/']],
    }),
    component({
      type: 'data',
      name: 'Unicode CLDR region names',
      version: '48',
      supplier: 'Unicode, Inc.',
      description: 'Country names in the languages of the news feeds, from Unicode CLDR. Copyright © 1991-2026 Unicode, Inc. Compiled into the app.',
      // (By name: the licence id list of CycloneDX 1.5, which npm writes, is older than SPDX's Unicode-3.0.)
      licenses: [{ license: { name: 'Unicode License v3 (SPDX: Unicode-3.0)', url: 'https://www.unicode.org/license.txt' } }],
      files: ['apps/desktop/src/shared/places/countryNameData.ts'],
      source: [['website', 'https://cldr.unicode.org/'], ['license', 'https://www.unicode.org/license.txt']],
    }),
    component({
      type: 'data',
      name: 'Natural Earth country shapes',
      supplier: 'Natural Earth',
      description: 'Country outlines derived from Natural Earth 1:50m Admin 0 Countries, simplified. Compiled into the app.',
      licenses: [{ license: { name: 'Public domain (Natural Earth terms of use)', url: 'https://www.naturalearthdata.com/about/terms-of-use/' } }],
      files: ['apps/desktop/src/shared/places/countryShapes.ts'],
      source: [['website', 'https://www.naturalearthdata.com/']],
    }),
    component({
      type: 'data',
      name: 'Intoponet news feed directory',
      supplier: 'Intoponet',
      description: "Feed addresses and publisher names of local and international news outlets. The compilation is Intoponet's own; each feed and what it carries belong to its publisher. Compiled into the app.",
      licenses: [{ license: { name: "Proprietary: Intoponet's own compilation, all rights reserved (see LICENSE). Each feed belongs to its publisher." } }],
      files: ['apps/desktop/src/main/news/newsFeeds.json', 'apps/desktop/src/main/news/internationalFeeds.json'],
    }),
    component({
      type: 'data',
      name: 'Intoponet ad and tracker list',
      supplier: 'Intoponet',
      description: "Intoponet's own list of advertising and tracking hosts, with its page-element rules. No outside list is included. Compiled into the app.",
      licenses: [{ license: { name: PROPRIETARY } }],
      files: ['packages/protection-engine/data/blocklist.json', 'packages/protection-engine/data/element-rules.json'],
    }),
  ]
}

/**
 * Turns `npm sbom --omit=dev` output (with Electron and Chromium already added) into the SBOM of
 * the application: re-rooted, with the bundled packages and the shipped files and data.
 */
function buildReleaseBom({ npmBom, bundled, version, lockfile = { packages: {} }, filesAndData = [] }) {
  if (!version) throw new Error('the application version is required')
  const bom = JSON.parse(JSON.stringify(npmBom))
  const oldRoot = bom.metadata?.component?.['bom-ref']
  const desktop = (bom.components ?? []).find((component) => String(component['bom-ref']).startsWith('@intoponet/desktop@'))
  const rootRef = `pkg:generic/intoponet@${version}`

  // Where each bundled package ended up.
  const into = new Map()
  const bundledByRef = new Map()
  for (const record of bundled) {
    for (const item of record.packages) {
      const ref = npmRef(item.name, item.version)
      bundledByRef.set(ref, item)
      into.set(ref, [...(into.get(ref) ?? []), record.target])
    }
  }

  const components = []
  const seen = new Set()
  for (const component of bom.components ?? []) {
    if (component === desktop) continue // The desktop workspace is the application itself: the root.
    const ref = component['bom-ref']
    if (seen.has(ref)) continue
    seen.add(ref)
    const isNpm = String(component.purl ?? '').startsWith('pkg:npm/') && component.type === 'library'
    if (isNpm && String(ref).startsWith('@intoponet/')) {
      // Intoponet's own workspace packages: source compiled into the app.
      component.licenses = [{ license: { name: PROPRIETARY } }]
      component.properties = [...(component.properties ?? []), { name: 'intoponet:evidence', value: "Intoponet's own workspace package; its source is compiled into the app" }]
    } else if (isNpm && bundledByRef.has(ref)) {
      component.scope = 'required'
      component.properties = [...(component.properties ?? []), { name: 'intoponet:evidence', value: `compiled into the app by the build (${into.get(ref).join(', ')})` }]
      if (!hasLicence(component)) component.licenses = licenceChoice(bundledByRef.get(ref).license) ?? component.licenses
    } else if (isNpm) {
      component.scope = 'excluded'
      component.properties = [...(component.properties ?? []), { name: 'intoponet:evidence', value: 'a production dependency in package-lock.json; the build left none of its modules in the app' }]
    }
    components.push(component)
  }
  // Packages the build compiled in that npm does not count as production dependencies.
  const added = []
  for (const [ref, item] of bundledByRef) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const lockEntry = Object.entries(lockfile.packages ?? {}).find(([location, entry]) => location.endsWith(`node_modules/${item.name}`) && entry.version === item.version)?.[1]
    const integrity = /^sha512-(.+)$/.exec(lockEntry?.integrity ?? '')
    const licenses = licenceChoice(item.license ?? lockEntry?.license)
    components.push({
      'bom-ref': ref,
      type: 'library',
      // (The full name, scope included, as npm writes its own components.)
      name: item.name,
      version: item.version,
      scope: 'required',
      purl: npmPurl(item.name, item.version),
      properties: [{ name: 'intoponet:evidence', value: `compiled into the app by the build (${into.get(ref).join(', ')}); a development dependency in package.json` }],
      externalReferences: lockEntry?.resolved ? [{ type: 'distribution', url: lockEntry.resolved }] : [],
      ...(integrity ? { hashes: [{ alg: 'SHA-512', content: Buffer.from(integrity[1], 'base64').toString('hex') }] } : {}),
      ...(licenses ? { licenses } : {}),
    })
    added.push({ ref, item, lockEntry })
  }
  for (const component of filesAndData) {
    if (seen.has(component['bom-ref'])) throw new Error(`two components are called ${component['bom-ref']}`)
    seen.add(component['bom-ref'])
    components.push(component)
  }
  bom.components = components

  // The dependency graph, re-rooted: what the desktop workspace depended on, the application depends on.
  const byName = new Map()
  for (const component of components) if (String(component.purl ?? '').startsWith('pkg:npm/')) byName.set(fullName(component), component['bom-ref'])
  const direct = new Set()
  const dependencies = []
  for (const dependency of bom.dependencies ?? []) {
    if (dependency.ref === oldRoot || (desktop && dependency.ref === desktop['bom-ref'])) {
      for (const ref of dependency.dependsOn ?? []) direct.add(ref)
    } else dependencies.push({ ref: dependency.ref, dependsOn: [...(dependency.dependsOn ?? [])] })
  }
  const depended = new Set(dependencies.flatMap((dependency) => dependency.dependsOn))
  for (const { ref, lockEntry } of added) {
    const dependsOn = Object.keys({ ...(lockEntry?.dependencies ?? {}), ...(lockEntry?.peerDependencies ?? {}) }).map((name) => byName.get(name)).filter((dep) => dep && dep !== ref)
    dependencies.push({ ref, dependsOn: [...new Set(dependsOn)] })
    for (const dep of dependsOn) depended.add(dep)
  }
  for (const { ref } of added) if (!depended.has(ref)) direct.add(ref)
  for (const component of filesAndData) {
    direct.add(component['bom-ref'])
    dependencies.push({ ref: component['bom-ref'], dependsOn: [] })
  }
  if (desktop) direct.delete(desktop['bom-ref'])
  const refs = new Set(components.map((component) => component['bom-ref']))
  bom.dependencies = [
    { ref: rootRef, dependsOn: [...direct].filter((ref) => refs.has(ref)).sort() },
    ...dependencies.filter((dependency) => refs.has(dependency.ref)).map((dependency) => ({ ref: dependency.ref, dependsOn: dependency.dependsOn.filter((ref) => refs.has(ref)) })),
  ]

  bom.metadata = {
    ...(bom.metadata ?? {}),
    lifecycles: [{ phase: 'build' }],
    tools: [...(Array.isArray(bom.metadata?.tools) ? bom.metadata.tools : []), { vendor: 'Intoponet', name: 'release-bom (bundled packages recorded by the build)' }],
    supplier: { name: 'Intoponet', url: ['https://intoponet.com'] },
    component: {
      'bom-ref': rootRef,
      type: 'application',
      supplier: { name: 'Intoponet', url: ['https://intoponet.com'] },
      name: 'Intoponet',
      version,
      description: 'Intoponet for macOS, a web browser.',
      licenses: [{ license: { name: PROPRIETARY } }],
      purl: rootRef,
    },
    properties: [
      ...(bom.metadata?.properties ?? []),
      { name: 'intoponet:known-unknowns', value: "The third-party code inside Electron's own binaries (Chromium, Node.js, V8 and their dependencies) is not listed one by one; its licences ship in the app as LICENSES.chromium.html. Translation and embedding models are downloaded on demand, are not part of the shipped app and are not listed." },
      { name: 'intoponet:library-evidence', value: 'npm libraries are those whose modules the build compiled into the app (apps/desktop/bundledPackages.ts), merged with the production dependencies in package-lock.json; the latter are marked excluded when none of their modules is in the app.' },
    ],
  }
  return bom
}

/** Throws unless the SBOM describes the application at `version`, lists the libraries known to ship, and gives every component a licence. */
function assertReleaseBom(bom, { version, sentinels = SENTINELS } = {}) {
  const problems = []
  const root = bom?.metadata?.component
  if (!root || root.type !== 'application' || root.name !== 'Intoponet') problems.push(`the root component is ${root ? `${root.type} "${root.name}"` : 'missing'}, not the application "Intoponet"`)
  if (!version) problems.push('no application version to check against')
  else if (root?.version !== version) problems.push(`the root component's version is ${root?.version}, not the app's ${version}`)
  if (root && !hasLicence(root)) problems.push('the root component has no licence')
  const components = Array.isArray(bom?.components) ? bom.components : []
  if (!components.length) problems.push('there are no components')
  const refs = new Set()
  for (const component of components) {
    const ref = component['bom-ref']
    const label = `${fullName(component)}${component.version ? `@${component.version}` : ''}`
    if (!ref) problems.push(`${label} has no bom-ref`)
    else if (refs.has(ref)) problems.push(`two components share the bom-ref ${ref}`)
    refs.add(ref)
    if (!hasLicence(component)) problems.push(`${label} has no licence`)
    if ((component.type === 'file' || component.type === 'data') && !component.hashes?.length && !(component.properties ?? []).some((property) => property.name === 'intoponet:source-file')) problems.push(`${label} has no checksum`)
  }
  const shipped = new Set(components.filter((component) => component.scope !== 'excluded').map(fullName))
  for (const name of sentinels) if (!shipped.has(name)) problems.push(`${name} ships in the app but is not listed as shipped`)
  if (root?.['bom-ref']) refs.add(root['bom-ref'])
  for (const dependency of bom?.dependencies ?? []) {
    if (!refs.has(dependency.ref)) problems.push(`the dependency graph names ${dependency.ref}, which is not a component`)
    for (const ref of dependency.dependsOn ?? []) if (!refs.has(ref)) problems.push(`${dependency.ref} depends on ${ref}, which is not a component`)
  }
  if (root?.['bom-ref'] && !(bom?.dependencies ?? []).some((dependency) => dependency.ref === root['bom-ref'] && dependency.dependsOn?.length)) problems.push('the application has no dependencies in the graph')
  if (problems.length) throw new Error(`the SBOM does not describe what ships: ${problems.join('; ')}`)
  return bom
}

/** The SBOM of the application as built in apps/desktop/out. `addRuntimes` adds Electron and Chromium to npm's list. */
function generateReleaseBom({ root = repoRoot, addRuntimes = (bom) => bom } = {}) {
  const desktopDir = path.join(root, 'apps/desktop')
  const desktopPackage = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8'))
  const lockfile = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const npmText = execFileSync('npm', [
    'sbom', '--workspace', '@intoponet/desktop', '--omit=dev', '--sbom-format=cyclonedx', '--package-lock-only',
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
  const bom = buildReleaseBom({
    npmBom: addRuntimes(JSON.parse(npmText)),
    bundled: readBundledPackages(desktopDir),
    version: desktopPackage.version,
    lockfile,
    filesAndData: shippedFilesAndData(root),
  })
  return assertReleaseBom(bom, { version: desktopPackage.version })
}

module.exports = { assertReleaseBom, buildReleaseBom, generateReleaseBom, readBundledPackages, shippedFilesAndData, licenceChoice, SENTINELS }
