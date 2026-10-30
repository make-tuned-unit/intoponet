#!/usr/bin/env node
'use strict'

const { builtinModules } = require('node:module')
const { spawnSync } = require('node:child_process')
const { accessSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, constants, statSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const { macUpdateBuildSetting } = require('./update-config.cjs')
const desktop = path.join(root, 'apps/desktop')
const packageDir = path.join(desktop, '.release-package')
const mode = process.argv[2]
const desktopPackage = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8'))

function fail(message) {
  console.error(`macOS package: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: options.stdio ?? 'inherit',
    env: options.env ?? process.env,
    encoding: 'utf8',
  })
  if (result.error) fail(`${command} could not start: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} failed with exit code ${result.status ?? 'unknown'}`)
  return result.stdout ?? ''
}

function required(name) {
  const value = process.env[name]
  if (!value || !value.trim()) fail(`release is blocked; set ${name}`)
  return value.trim()
}

function validateReadableFile(name, extension, description) {
  const file = required(name)
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== extension || !existsSync(file)) {
    fail(`${name} must be an absolute path to a ${description} file`)
  }
  try {
    if (!statSync(file).isFile()) fail(`${name} must point to a regular file`)
    accessSync(file, constants.R_OK)
  } catch {
    fail(`${name} must point to a readable ${description} file`)
  }
  return file
}

function validateReleaseCredentials() {
  const identity = required('INTOPONET_MAC_SIGN_IDENTITY')
  if (!/^Developer ID Application: .+\([A-Z0-9]{10}\)$/.test(identity)) {
    fail('INTOPONET_MAC_SIGN_IDENTITY must be a Developer ID Application identity including its 10-character Team ID')
  }
  if (process.env.CSC_LINK) {
    validateReadableFile('CSC_LINK', '.p12', 'exported code-signing certificate (.p12)')
    required('CSC_KEY_PASSWORD')
  } else {
    // No exported certificate: sign with the identity already in the login keychain.
    const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'], { stdio: 'pipe' })
    if (!identities.includes(`"${identity}"`)) {
      fail(`release is blocked; "${identity}" is not a valid code-signing identity in the keychain (or set CSC_LINK to a .p12)`)
    }
  }
  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    // Credentials saved earlier with `xcrun notarytool store-credentials <profile>`.
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(process.env.APPLE_KEYCHAIN_PROFILE)) fail('APPLE_KEYCHAIN_PROFILE must be a notarytool profile name')
    return
  }
  validateReadableFile('APPLE_API_KEY', '.p8', 'App Store Connect API key (.p8)')
  if (!/^[A-Z0-9]{10}$/.test(required('APPLE_API_KEY_ID'))) {
    fail('APPLE_API_KEY_ID must be the 10-character App Store Connect key ID')
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(required('APPLE_API_ISSUER'))) {
    fail('APPLE_API_ISSUER must be the App Store Connect issuer UUID')
  }
}

function architecture() {
  const requested = process.argv.slice(3).filter((arg) => arg === '--arm64' || arg === '--x64')
  if (requested.length > 1) fail('choose one target architecture: --arm64 or --x64')
  const unsupported = process.argv.slice(3).filter((arg) => arg !== '--arm64' && arg !== '--x64')
  if (unsupported.length) fail(`unsupported option: ${unsupported[0]}`)
  return requested.length ? requested[0].slice(2) : process.arch
}

function verifyBundledRuntime() {
  const mainDir = path.join(desktop, 'out/main')
  const preloadDir = path.join(desktop, 'out/preload')
  const bundleDirs = [mainDir, preloadDir]
  if (!existsSync(path.join(mainDir, 'index.js'))) fail('build output is missing out/main/index.js')
  if (!existsSync(path.join(preloadDir, 'index.js'))) fail('build output is missing out/preload/index.js')
  const builtinNames = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, '')]))
  const allowed = (specifier) => specifier === 'electron'
    || builtinNames.has(specifier)
    || (specifier.startsWith('node:') && builtinNames.has(specifier.slice(5)))
    || specifier.startsWith('./')
    || specifier.startsWith('../')
  const pattern = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g
  for (const dir of bundleDirs) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
      const source = readFileSync(path.join(dir, file), 'utf8')
      for (const match of source.matchAll(pattern)) {
        if (!allowed(match[2])) fail(`unbundled dependency in ${path.relative(desktop, path.join(dir, file))}: ${match[2]}`)
      }
    }
  }
}

function prepareStandaloneApp() {
  rmSync(packageDir, { recursive: true, force: true })
  mkdirSync(path.join(packageDir, 'out'), { recursive: true })
  run('ditto', [path.join(desktop, 'out'), path.join(packageDir, 'out')])
  for (const filename of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    run('ditto', [path.join(root, filename), path.join(packageDir, filename)])
  }
  writeFileSync(path.join(packageDir, 'package.json'), `${JSON.stringify({
    name: 'intoponet-desktop',
    productName: 'Intoponet',
    version: desktopPackage.version,
    description: 'A privacy-first spatial browser for exploring the living web.',
    license: 'UNLICENSED',
    main: 'out/main/index.js',
  }, null, 2)}\n`)
}

function findFiles(dir, extension, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) findFiles(fullPath, extension, found)
    else if (entry.name.endsWith(extension)) found.push(fullPath)
  }
  return found
}

function findApps(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory() && entry.name.endsWith('.app')) found.push(fullPath)
    else if (entry.isDirectory()) findApps(fullPath, found)
  }
  return found
}

function inspectPackagedApp(app) {
  const contents = path.join(app, 'Contents')
  const resources = path.join(contents, 'Resources')
  const archive = path.join(resources, 'app.asar')
  const executable = path.join(contents, 'MacOS/Intoponet')
  for (const requiredPath of [archive, executable, path.join(resources, 'LICENSE'), path.join(resources, 'THIRD_PARTY_NOTICES.md')]) {
    if (!existsSync(requiredPath)) fail(`packaged app is missing ${path.relative(app, requiredPath)}`)
  }
  try {
    accessSync(executable, constants.X_OK)
  } catch {
    fail('packaged Intoponet executable is not executable')
  }
  const bundleId = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(contents, 'Info.plist')], { stdio: 'pipe' }).trim()
  const displayName = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleDisplayName', path.join(contents, 'Info.plist')], { stdio: 'pipe' }).trim()
  if (bundleId !== 'com.intoponet.desktop' || displayName !== 'Intoponet') {
    fail(`unexpected bundle metadata (id=${bundleId}, display name=${displayName})`)
  }
  const asar = require('@electron/asar')
  const entries = new Set(asar.listPackage(archive))
  const requiredEntries = [
    '/package.json',
    '/out/main/index.js',
    '/out/preload/index.js',
    '/out/renderer/index.html',
  ]
  for (const entry of readdirSync(path.join(desktop, 'out/main')).filter((name) => name.startsWith('worker-') && name.endsWith('.js'))) {
    requiredEntries.push(`/out/main/${entry}`)
  }
  for (const entry of requiredEntries) {
    if (!entries.has(entry)) fail(`app.asar is missing ${entry}`)
  }
  console.log(`Inspected app bundle: ${app} (entry points, workers, license resources, and bundle metadata present)`)
}

if (!['preview', 'release'].includes(mode)) {
  fail('usage: node scripts/package-macos.cjs <preview|release> [--arm64|--x64]')
}
if (process.platform !== 'darwin') fail('DMG packaging must run on macOS')
const arch = architecture()
if (!['arm64', 'x64'].includes(arch)) fail(`unsupported target architecture: ${arch}`)
if (mode === 'release') validateReleaseCredentials()
const outputDir = path.join(root, 'dist/macos', mode, `${desktopPackage.version}-${arch}`)

console.log(`Building Intoponet macOS ${mode} package (${arch})`)
let updateUrl = ''
try {
  updateUrl = macUpdateBuildSetting(mode, process.env)
} catch (error) {
  fail(error.message)
}
const buildEnv = {
  ...process.env,
  INTOPONET_MAC_RELEASE: mode === 'release' ? '1' : '0',
  INTOPONET_MAC_UPDATE_URL: updateUrl,
}
if (mode === 'preview') {
  buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  delete buildEnv.CSC_LINK
  delete buildEnv.CSC_KEY_PASSWORD
  delete buildEnv.INTOPONET_MAC_SIGN_IDENTITY
  delete buildEnv.APPLE_API_KEY
  delete buildEnv.APPLE_API_KEY_ID
  delete buildEnv.APPLE_API_ISSUER
  delete buildEnv.APPLE_KEYCHAIN_PROFILE
}
run('npm', ['run', 'build'], { env: buildEnv })
verifyBundledRuntime()
prepareStandaloneApp()
rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

buildEnv.INTOPONET_MAC_OUTPUT = outputDir
run(path.join(root, 'node_modules/.bin/electron-builder'), [
  '--projectDir', packageDir,
  '--config', path.join(desktop, 'electron-builder.config.cjs'),
  '--mac', 'dmg', `--${arch}`,
], { cwd: packageDir, env: buildEnv })

const dmgs = findFiles(outputDir, '.dmg')
if (dmgs.length !== 1) fail(`expected one DMG in ${outputDir}, found ${dmgs.length}`)
const dmg = dmgs[0]
run('hdiutil', ['verify', dmg])
const apps = findApps(outputDir)
if (apps.length !== 1) fail(`expected one built app bundle in ${outputDir}, found ${apps.length}`)
const app = apps[0]
inspectPackagedApp(app)

if (mode === 'release') {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  run('xcrun', ['stapler', 'validate', app])

  const credentials = process.env.APPLE_KEYCHAIN_PROFILE
    ? ['--keychain-profile', process.env.APPLE_KEYCHAIN_PROFILE]
    : ['--key', process.env.APPLE_API_KEY, '--key-id', process.env.APPLE_API_KEY_ID, '--issuer', process.env.APPLE_API_ISSUER]
  // Sign the disk image itself so Gatekeeper can verify it before mounting.
  run('codesign', ['--sign', process.env.INTOPONET_MAC_SIGN_IDENTITY, '--timestamp', dmg])
  run('codesign', ['--verify', '--strict', '--verbose=2', dmg])
  run('xcrun', ['notarytool', 'submit', dmg, ...credentials, '--wait'])
  run('xcrun', ['stapler', 'staple', dmg])
  run('xcrun', ['stapler', 'validate', dmg])
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
  run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg])
  console.log(`Verified signed and notarized macOS release: ${dmg}`)
} else {
  console.log(`Verified local unsigned preview DMG (not for public distribution): ${dmg}`)
}

// Produce the Squirrel.Mac archive only after the app has been signed and stapled,
// so the update feed can refer to the exact verified app bundle.
const zip = path.join(outputDir, `Intoponet-${desktopPackage.version}-${arch}-mac.zip`)
rmSync(zip, { force: true })
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip])

// Hash only after stapling and Gatekeeper checks have completed, so the
// inventory describes the exact DMG and update ZIP bytes delivered to an operator.
run(process.execPath, [
  path.join(root, 'scripts/release-inventory.cjs'), mode, arch, dmg, zip, updateUrl,
], { cwd: root })
