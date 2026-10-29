import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

if (process.platform !== 'darwin') {
  console.error('This probe requires macOS XPC and codesign.')
  process.exit(2)
}

const args = process.argv.slice(2)
if (args.length !== 1 || !args[0].startsWith('--model-root=')) {
  console.error('Usage: node experiments/laya-os-boundary/xpc-probe.mjs --model-root=/explicit/pinned/model/root')
  process.exit(2)
}
const modelRoot = path.resolve(args[0].slice('--model-root='.length))
const modelDir = path.join(modelRoot, 'models', 'sentence-transformers__all-MiniLM-L6-v2', '1110a243fdf4706b3f48f1d95db1a4f5529b4d41')
const modelPath = path.join(modelDir, 'model.safetensors')
const vocabPath = path.join(modelDir, 'vocab.txt')
const pinnedFiles = [
  { path: modelPath, size: 90_868_376, sha256: '53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db' },
  { path: vocabPath, size: 231_508, sha256: '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3' },
]
for (const file of pinnedFiles) await verifyPinnedFile(file)
const inferenceText = 'The quick brown fox jumps over the lazy dog.'

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
  const bundlePath = path.join(temp, 'laya-encoder.js')
  const bundle = await build({
    entryPoints: [path.join(here, 'inference-entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    legalComments: 'none',
  })
  await writeFile(bundlePath, bundle.outputFiles[0].contents, { mode: 0o600, flag: 'wx' })
  const [modelBuffer, vocabBuffer] = await Promise.all([readFile(modelPath), readFile(vocabPath)])
  verifyPinnedBuffer(modelBuffer, pinnedFiles[0])
  verifyPinnedBuffer(vocabBuffer, pinnedFiles[1])
  const v8Context = vm.createContext({})
  vm.runInContext(bundle.outputFiles[0].text, v8Context, { timeout: 30_000 })
  if (typeof v8Context.layaRunInference !== 'function') throw new Error('The bundled V8 inference entry is unavailable.')
  v8Context.modelBytes = new Uint8Array(modelBuffer.buffer, modelBuffer.byteOffset, modelBuffer.byteLength)
  v8Context.vocabText = vocabBuffer.toString('utf8')
  v8Context.syntheticText = inferenceText
  const v8Start = performance.now()
  const v8BaselineJSON = vm.runInContext('layaRunInference(modelBytes, vocabText, syntheticText)', v8Context, { timeout: 300_000 })
  const v8Baseline = JSON.parse(v8BaselineJSON)
  const v8ElapsedMs = Math.round(performance.now() - v8Start)
  delete v8Context.modelBytes
  delete v8Context.vocabText
  delete v8Context.syntheticText
  if (!Array.isArray(v8Baseline.tokenIds) || !Array.isArray(v8Baseline.vector) || v8Baseline.vector.length !== 384) {
    throw new Error('The bundled V8 baseline returned an unexpected vector shape.')
  }
  const serviceSource = (await readFile(path.join(here, 'xpc-service.swift')))
    .toString('utf8')
    .replace('__LAYA_PROBE_FIXTURE_PATH__', swiftString(fixturePath))
  await writeFile(serviceSourcePath, serviceSource, { mode: 0o600, flag: 'wx' })
  await command('xcrun', ['swiftc', '-O', '-framework', 'Foundation', '-framework', 'CryptoKit', '-framework', 'JavaScriptCore', serviceSourcePath, '-o', serviceBinary])
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
    await mkdir(path.join(xpcContents, 'Resources'), { recursive: true })
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
    await copyFile(bundlePath, path.join(xpcContents, 'Resources', 'laya-encoder.js'))

    await command('codesign', ['--force', '--sign', '-', '--entitlements', entitlementPath, xpc])
    await command('codesign', ['--force', '--sign', '-', app])
    await command('codesign', ['--verify', '--deep', '--strict', app])
    const signed = await command('codesign', ['-d', '--entitlements', ':-', xpc])
    const entitlementOutput = `${signed.stdout}\n${signed.stderr}`
    if (!entitlementOutput.includes('com.apple.security.app-sandbox')) throw new Error(`${testCase.mode} service lacks App Sandbox entitlement`)
    const hasNetworkClient = entitlementOutput.includes('com.apple.security.network.client')
    if (hasNetworkClient !== testCase.networkClient) throw new Error(`${testCase.mode} service network-client entitlement does not match test case`)

    const run = await command(path.join(contents, 'MacOS', 'ProbeHost'), [serviceID, testCase.mode, modelPath, vocabPath], { timeoutMs: 360_000 })
    const report = JSON.parse(run.stdout)
    const expectedResult = testCase.networkClient ? 'network-client-positive-control-passed' : 'service-network-denial-observed'
    if (report.result !== expectedResult) throw new Error(`${testCase.mode} XPC test failed: ${JSON.stringify(report)}`)
    if (!testCase.networkClient && (report.serviceTcpFailureOperation !== 'connect' || report.serviceTcpErrno === 0 || report.serviceUdpFailureOperation !== 'sendto' || report.serviceUdpErrno === 0)) {
      throw new Error(`Denied service did not report TCP connect and UDP sendto errors: ${JSON.stringify(report)}`)
    }
    let javaScriptCoreInference
    if (!testCase.networkClient) {
      javaScriptCoreInference = compareInference(v8Baseline, report.pinnedModelInference)
      if (!javaScriptCoreInference.passed) {
        throw new Error(`JavaScriptCore did not match the V8 baseline: ${JSON.stringify(javaScriptCoreInference)}`)
      }
    }
    results.push({
      mode: testCase.mode,
      signedEntitlements: { appSandbox: true, networkClient: hasNetworkClient },
      result: report.result,
      tcp: {
        hostConnected: report.hostPositiveControlConnected,
        serviceConnected: report.serviceConnectedToLoopback,
        serviceFailureOperation: report.serviceTcpFailureOperation,
        serviceErrno: report.serviceTcpErrno,
        canaryConnections: report.loopbackTcpCanaryConnections,
      },
      udp: {
        hostSent: report.hostUdpPositiveControlSent,
        serviceSent: report.serviceSentUdp,
        serviceFailureOperation: report.serviceUdpFailureOperation,
        serviceErrno: report.serviceUdpErrno,
        canaryDatagrams: report.loopbackUdpCanaryDatagrams,
      },
      outsideSyntheticFixture: report.outsideSyntheticFixture,
      syntheticPayloadChecks: report.syntheticModel,
      ...(testCase.networkClient ? {} : { javaScriptCoreInference }),
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
    explicitModelRootProvided: true,
    pinnedModelAndVocabVerifiedBeforeLaunch: true,
    pinnedArtifacts: pinnedFiles.map((file) => ({ name: path.basename(file.path), bytes: file.size, sha256: file.sha256 })),
    comparison: {
      baselineRuntime: 'Node V8 using the same esbuild IIFE and verified byte buffers',
      fixedSyntheticText: inferenceText,
      v8ElapsedMs,
      vectorLength: 384,
      tolerance: { maxAbsoluteDelta: 1e-5, minimumCosineSimilarity: 0.999999 },
    },
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

async function verifyPinnedFile(file) {
  const info = await stat(file.path)
  if (!info.isFile() || info.size !== file.size) throw new Error('The explicitly selected pinned Laya files are missing or have an unexpected size.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file.path)) hash.update(chunk)
  if (hash.digest('hex') !== file.sha256) throw new Error('The explicitly selected pinned Laya files do not match their pinned fingerprints.')
}

function verifyPinnedBuffer(bytes, file) {
  if (bytes.byteLength !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    throw new Error('The buffered Laya bytes changed after preflight verification.')
  }
}

function compareInference(v8, jsc) {
  if (!jsc || jsc.status !== 'inference-complete' || !Array.isArray(jsc.tokenIDs) || !Array.isArray(jsc.vector) || jsc.vector.length !== 384) {
    return { passed: false, reason: 'invalid-jscontext-result-shape' }
  }
  if (!Array.isArray(v8.tokenIds) || !Array.isArray(v8.vector) || v8.vector.length !== 384) {
    return { passed: false, reason: 'invalid-v8-result-shape' }
  }
  const tokenIDsExact = JSON.stringify(v8.tokenIds) === JSON.stringify(jsc.tokenIDs)
  const dots = v8.vector.reduce((sum, value, index) => sum + value * jsc.vector[index], 0)
  const normV8 = Math.sqrt(v8.vector.reduce((sum, value) => sum + value * value, 0))
  const normJsc = Math.sqrt(jsc.vector.reduce((sum, value) => sum + value * value, 0))
  const cosineSimilarity = dots / (normV8 * normJsc)
  const maxAbsoluteDelta = Math.max(...v8.vector.map((value, index) => Math.abs(value - jsc.vector[index])))
  const v8Float32 = Float32Array.from(v8.vector)
  const v8Float32Bytes = Buffer.from(v8Float32.buffer, v8Float32.byteOffset, v8Float32.byteLength)
  const v8VectorSHA256Float32NativeBytes = createHash('sha256').update(v8Float32Bytes).digest('hex')
  const maxAbsoluteDeltaTolerance = 1e-5
  const minimumCosineSimilarity = 0.999999
  return {
    status: jsc.status,
    tokenIDs: jsc.tokenIDs,
    tokenCount: jsc.tokenIDs.length,
    vectorLength: jsc.vector.length,
    vectorNorm: jsc.vectorNorm,
    serviceVerifiedPinnedModelAndVocab: jsc.serviceVerifiedPinnedModelAndVocab,
    modelChunkCount: jsc.chunkCount,
    textKind: jsc.textKind,
    v8VectorSHA256Float32NativeBytes,
    vectorSHA256Float32NativeBytes: jsc.vectorSHA256Float32NativeBytes,
    tokenIDsExact,
    maxAbsoluteDelta,
    maxAbsoluteDeltaTolerance,
    cosineSimilarity,
    minimumCosineSimilarity,
    passed: tokenIDsExact && maxAbsoluteDelta <= maxAbsoluteDeltaTolerance && cosineSimilarity >= minimumCosineSimilarity,
  }
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
