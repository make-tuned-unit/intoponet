import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.error('This probe requires macOS XPC and codesign.')
  process.exit(2)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const token = randomUUID().replaceAll('-', '').slice(0, 16)
const temp = await mkdtemp(path.join(os.tmpdir(), 'laya-xpc-probe-'))
const containerRoot = path.join(os.homedir(), 'Library', 'Containers')
const cachesRoot = path.join(os.homedir(), 'Library', 'Caches')
const baseID = `org.intoponet.LayaIsolationProbe.${token}`
const cases = [
  { mode: 'allowed', networkClient: true },
  { mode: 'denied', networkClient: false },
]
const ownedContainers = []
let fixtureDir

try {
  await mkdir(cachesRoot, { recursive: true })
  fixtureDir = await mkdtemp(path.join(cachesRoot, `laya-xpc-synthetic-fixture-${token}-`))
  const fixturePath = path.join(fixtureDir, 'synthetic-model.bin')
  const fixtureBytes = Buffer.from('synthetic fixture outside service container\n', 'utf8')
  await writeFile(fixturePath, fixtureBytes, { mode: 0o600, flag: 'wx' })
  if (!(await readFile(fixturePath)).equals(fixtureBytes) || path.resolve(fixturePath).startsWith(`${path.resolve(containerRoot)}${path.sep}`)) {
    throw new Error('Synthetic fixture setup failed or was not outside the service container root')
  }

  const hostBinary = path.join(temp, 'ProbeHost')
  const serviceBinary = path.join(temp, 'ProbeService')
  const serviceSourcePath = path.join(temp, 'ProbeService.swift')
  const serviceSource = (await readFile(path.join(here, 'xpc-service.swift')))
    .toString('utf8')
    .replace('__LAYA_PROBE_FIXTURE_PATH__', swiftString(fixturePath))
  await writeFile(serviceSourcePath, serviceSource, { mode: 0o600, flag: 'wx' })
  await command('xcrun', ['swiftc', '-O', '-framework', 'Foundation', '-framework', 'CryptoKit', serviceSourcePath, '-o', serviceBinary])
  await command('xcrun', ['swiftc', '-O', '-framework', 'Foundation', '-framework', 'CryptoKit', path.join(here, 'xpc-host.swift'), '-o', hostBinary])

  const results = []
  for (const testCase of cases) {
    const hostID = `${baseID}.${testCase.mode}.host`
    const serviceID = `${baseID}.${testCase.mode}.service`
    const app = path.join(temp, `${testCase.mode}-control.app`)
    const contents = path.join(app, 'Contents')
    const xpc = path.join(contents, 'XPCServices', `${serviceID}.xpc`)
    const xpcContents = path.join(xpc, 'Contents')
    const containerPath = path.join(containerRoot, serviceID)
    const wasPresent = await exists(containerPath)
    if (wasPresent) throw new Error(`Unique service container already exists; refusing to touch it (${serviceID})`)
    ownedContainers.push({ path: containerPath, bundleID: serviceID, existedBefore: false, created: false, removed: false })

    await mkdir(path.join(contents, 'MacOS'), { recursive: true })
    await mkdir(path.join(xpcContents, 'MacOS'), { recursive: true })
    await writeFile(path.join(contents, 'Info.plist'), plist({
      CFBundleExecutable: 'ProbeHost',
      CFBundleIdentifier: hostID,
      CFBundleName: 'Laya XPC Isolation Probe',
      CFBundlePackageType: 'APPL',
      CFBundleVersion: '1',
      LSMinimumSystemVersion: '13.0',
    }))
    await writeFile(path.join(xpcContents, 'Info.plist'), plist({
      CFBundleExecutable: 'ProbeService',
      CFBundleIdentifier: serviceID,
      CFBundlePackageType: 'XPC!',
      CFBundleVersion: '1',
      XPCService: { ServiceType: 'Application' },
    }))
    const entitlementPath = path.join(temp, `${testCase.mode}-entitlements.plist`)
    await writeFile(entitlementPath, entitlements(testCase.networkClient))
    await copyFile(hostBinary, path.join(contents, 'MacOS', 'ProbeHost'))
    await copyFile(serviceBinary, path.join(xpcContents, 'MacOS', 'ProbeService'))

    await command('codesign', ['--force', '--sign', '-', '--entitlements', entitlementPath, xpc])
    await command('codesign', ['--force', '--sign', '-', app])
    await command('codesign', ['--verify', '--deep', '--strict', app])
    const signed = await command('codesign', ['-d', '--entitlements', ':-', xpc])
    const entitlementOutput = `${signed.stdout}\n${signed.stderr}`
    if (!entitlementOutput.includes('com.apple.security.app-sandbox')) throw new Error(`${testCase.mode} service lacks App Sandbox entitlement`)
    const hasNetworkClient = entitlementOutput.includes('com.apple.security.network.client')
    if (hasNetworkClient !== testCase.networkClient) throw new Error(`${testCase.mode} service network-client entitlement does not match test case`)

    const run = await command(path.join(contents, 'MacOS', 'ProbeHost'), [serviceID, testCase.mode], { timeoutMs: 20_000 })
    const report = JSON.parse(run.stdout)
    const expectedResult = testCase.networkClient ? 'network-client-positive-control-passed' : 'service-network-denial-observed'
    if (report.result !== expectedResult) throw new Error(`${testCase.mode} XPC test failed: ${JSON.stringify(report)}`)
    if (!testCase.networkClient && (report.serviceTcpFailureOperation !== 'connect' || report.serviceTcpErrno === 0 || report.serviceUdpFailureOperation !== 'sendto' || report.serviceUdpErrno === 0)) {
      throw new Error(`Denied service did not report TCP connect and UDP sendto errors: ${JSON.stringify(report)}`)
    }
    results.push({
      mode: testCase.mode,
      signedEntitlements: { appSandbox: true, networkClient: hasNetworkClient },
      ...report,
    })
  }

  // launchd tears down the XPC child with its client; leave time for that and
  // for App Sandbox container creation before checking/removing owned paths.
  await new Promise((resolve) => setTimeout(resolve, 300))
  for (const item of ownedContainers) item.created = await exists(item.path)

  const cleanup = await removeOwnedContainers(ownedContainers)
  console.log(JSON.stringify({
    experiment: 'laya-xpc-isolation-probe',
    signing: 'ad-hoc inside temporary app bundles',
    hostAndServiceIDsArePerRun: true,
    results,
    syntheticFixtureOutsideContainer: true,
    sandboxContainers: cleanup,
  }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await new Promise((resolve) => setTimeout(resolve, 300))
  await removeOwnedContainers(ownedContainers).catch((error) => {
    console.error(`Could not clean the exact probe-owned sandbox container: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true })
  await rm(temp, { recursive: true, force: true })
}

async function removeOwnedContainers(items) {
  const root = await exists(containerRoot) ? await realpath(containerRoot) : null
  const report = []
  for (const item of items) {
    if (item.cleanupAttempted) continue
    item.cleanupAttempted = true
    const stat = await lstatOrNull(item.path)
    if (!stat) {
      report.push({ bundleID: item.bundleID, existedBefore: item.existedBefore, createdByProbe: item.created, removed: item.removed })
      continue
    }
    if (item.existedBefore) throw new Error(`Refusing to remove a pre-existing container: ${item.bundleID}`)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !root) throw new Error(`Refusing to remove a non-directory or unanchored container: ${item.bundleID}`)
    const actualParent = await realpath(path.dirname(item.path))
    const actualPath = await realpath(item.path)
    if (actualParent !== root || path.dirname(actualPath) !== root || path.basename(actualPath) !== item.bundleID) {
      throw new Error(`Probe container path escaped its exact owner directory: ${item.bundleID}`)
    }
    item.created = true
    try {
      await rm(item.path, { recursive: true, force: false })
      item.removed = true
      report.push({ bundleID: item.bundleID, existedBefore: item.existedBefore, createdByProbe: true, removed: true })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        report.push({ bundleID: item.bundleID, existedBefore: item.existedBefore, createdByProbe: true, removed: false, cleanupError: 'EPERM from the OS while removing this exact container; left in place' })
      } else throw error
    }
  }
  return report
}

async function exists(file) {
  return (await lstatOrNull(file)) !== null
}

async function lstatOrNull(file) {
  try { return await lstat(file) } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

function entitlements(networkClient) {
  const network = networkClient ? '<key>com.apple.security.network.client</key><true/>' : ''
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/>${network}</dict></plist>\n`
}

function swiftString(value) {
  return JSON.stringify(value)
}

function plist(value) {
  const entries = Object.entries(value).map(([key, item]) => {
    if (typeof item === 'object') return `<key>${key}</key><dict>${Object.entries(item).map(([nestedKey, nestedValue]) => `<key>${nestedKey}</key><string>${nestedValue}</string>`).join('')}</dict>`
    return `<key>${key}</key><string>${item}</string>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${entries}</dict></plist>\n`
}

function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], env: options.env ?? process.env })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs ?? 30_000)
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error(`${executable} timed out after ${options.timeoutMs ?? 30_000}ms`))
      else if (code !== 0) reject(new Error(`${executable} ${args.join(' ')} failed (${code}): ${stderr.trim()}`))
      else resolve({ code, stdout, stderr })
    })
  })
}
