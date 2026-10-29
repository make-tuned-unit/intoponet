#!/usr/bin/env node
/**
 * Runtime check for Laya's network stubs, with a reachable local canary and
 * (optionally) the real built MiniLM worker/model. Run with
 * `node --experimental-strip-types experiments/laya-privacy-verification/verify.mjs`.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installNetworkStubs } from '../../apps/desktop/src/main/laya/networkStubs.ts'
import { LAYA_MODEL } from '../../apps/desktop/src/main/laya/model.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const modelRootIndex = args.indexOf('--model-root')
const modelRoot = modelRootIndex >= 0 ? resolve(args[modelRootIndex + 1] ?? '') : null
if (args.some((arg, index) => arg === '--model-root' && !args[index + 1])) {
  console.error('Usage: node --experimental-strip-types experiments/laya-privacy-verification/verify.mjs [--model-root <laya-data-root>]')
  process.exit(2)
}
const unknownArg = args.find((arg, index) => arg !== '--model-root' && args[index - 1] !== '--model-root')
if (unknownArg) {
  console.error(`Unsupported option: ${unknownArg}`)
  process.exit(2)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function workerMessage(worker, timeoutMs = 15_000) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker did not answer within the deadline.')), timeoutMs)
    worker.once('message', (message) => {
      clearTimeout(timer)
      resolveMessage(message)
    })
    worker.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    worker.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Worker exited before replying (code ${code}).`))
    })
  })
}

function networkSockets(port = null) {
  assert(existsSync('/usr/sbin/lsof'), 'macOS lsof is required for the OS socket-table observation.')
  const args = ['-nP', '-a', '-p', String(process.pid), port === null ? '-i' : `-iTCP:${port}`]
  if (port !== null) args.push('-sTCP:ESTABLISHED')
  const result = spawnSync('/usr/sbin/lsof', args, { encoding: 'utf8' })
  const rows = (result.stdout ?? '').split('\n').filter((line) => line && !line.startsWith('COMMAND'))
  assert(result.status === 0 || (result.status === 1 && rows.length === 0), `lsof failed: ${(result.stderr ?? '').trim()}`)
  return rows
}

async function watchEstablishedSockets(port, durationMs) {
  const rows = new Set()
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    for (const row of networkSockets(port)) rows.add(row)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  return [...rows]
}

async function exerciseCanary() {
  const requests = []
  let connections = 0
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url })
    response.writeHead(200, { 'content-type': 'text/plain', 'connection': 'close' })
    if (request.url === '/control') setTimeout(() => response.end('canary-ok'), 2_000)
    else response.end('canary-ok')
  })
  server.on('connection', () => { connections += 1 })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Canary failed to bind loopback.')
  const url = `http://127.0.0.1:${address.port}/probe`
  const stubSource = installNetworkStubs.toString()

  try {
    const control = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      require('node:http').get(workerData.url, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => parentPort.postMessage({ status: response.statusCode, body }));
      }).on('error', (error) => parentPort.postMessage({ error: error.message }));
    `, { eval: true, workerData: { url: `http://127.0.0.1:${address.port}/control` } })
    const controlResultPromise = workerMessage(control)
    const controlSocketRows = await watchEstablishedSockets(address.port, 1_500)
    const controlResult = await controlResultPromise
    await control.terminate()
    assert(controlResult.status === 200 && controlResult.body === 'canary-ok', 'Positive-control worker could not reach the local canary.')
    assert(requests.length === 1 && connections === 1, 'Positive control was not recorded exactly once by the canary.')
    assert(controlSocketRows.length > 0, `lsof did not observe the positive-control worker socket (pid ${process.pid}, port ${address.port}).`)

    const preloaded = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { Socket } = require('node:net');
      const savedConnect = Socket.prototype.connect;
      const socket = new Socket();
      (${stubSource})();
      socket.on('connect', () => {
        parentPort.postMessage('connected');
        setTimeout(() => socket.end(), 2_000);
      });
      socket.on('error', (error) => parentPort.postMessage('error:' + error.message));
      try { savedConnect.call(socket, { host: '127.0.0.1', port: workerData.port }); }
      catch (error) { parentPort.postMessage('error:' + error.message); }
    `, { eval: true, workerData: { port: address.port } })
    const preloadedResultPromise = workerMessage(preloaded)
    const preloadedSocketRows = await watchEstablishedSockets(address.port, 1_500)
    const preloadedResult = await preloadedResultPromise
    await preloaded.terminate()
    const savedReferenceBypassedStub = preloadedResult === 'connected'
    if (savedReferenceBypassedStub) {
      assert(connections === 2, 'Canary did not observe the saved-reference connection.')
      assert(preloadedSocketRows.length > 0, 'Canary saw a saved-reference connection but lsof did not observe its socket.')
    }
    else assert(typeof preloadedResult === 'string' && preloadedResult.startsWith('error:'), 'Saved-reference control did not report its outcome.')
    const expectedConnectionsBeforeBlocked = 1 + Number(savedReferenceBypassedStub)

    const blocked = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (${stubSource})();
      const httpsUrl = workerData.url.replace('http:', 'https:');
      const wsUrl = workerData.url.replace('http:', 'ws:');
      const results = [];
      const attempt = async (name, action) => {
        try { await action(); results.push(name + ':allowed'); }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push(message === 'Laya has no network access.' ? name + ':blocked' : name + ':unexpected:' + message);
        }
      };
      (async () => {
        await attempt('fetch', () => fetch(workerData.url));
        await attempt('http', () => require('node:http').get(workerData.url));
        await attempt('https', () => require('node:https').request(httpsUrl));
        await attempt('http2', () => require('node:http2').connect(workerData.url));
        await attempt('net', () => require('node:net').connect(workerData.port, '127.0.0.1'));
        await attempt('tls', () => require('node:tls').connect(workerData.port, '127.0.0.1'));
        await attempt('dns-callback', () => require('node:dns').lookup('example.invalid', () => {}));
        await attempt('dns-promise', () => require('node:dns/promises').lookup('example.invalid'));
        await attempt('dns-callback-resolver', () => new (require('node:dns').Resolver)().resolve('example.invalid', () => {}));
        await attempt('dns-resolver', () => new (require('node:dns/promises').Resolver)().resolve('example.invalid'));
        await attempt('udp', () => require('node:dgram').createSocket('udp4'));
        await attempt('child-process', () => require('node:child_process').spawn(process.execPath, ['-e', '']));
        await attempt('nested-worker', () => new (require('node:worker_threads').Worker)('', { eval: true }));
        if (typeof globalThis.WebSocket === 'function') {
          await attempt('websocket', () => new WebSocket(wsUrl));
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        parentPort.postMessage(results);
      })();
    `, { eval: true, workerData: { url, port: address.port } })
    const blockedResultPromise = workerMessage(blocked)
    const blockedSocketRows = await watchEstablishedSockets(address.port, 300)
    const blockedResult = await blockedResultPromise
    await blocked.terminate()
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    assert(Array.isArray(blockedResult) && blockedResult.length >= 12, 'Blocked worker did not complete all runtime probes.')
    assert(blockedResult.every((result) => result.endsWith(':blocked')), `An API probe was not blocked: ${blockedResult.filter((result) => !result.endsWith(':blocked')).join(', ')}`)
    assert(requests.length === 1, `Blocked worker reached the HTTP canary; observed ${requests.length - 1} additional request(s).`)
    assert(connections === expectedConnectionsBeforeBlocked, `Blocked worker reached the socket canary; observed ${connections - expectedConnectionsBeforeBlocked} additional connection(s).`)
    assert(blockedSocketRows.length === 0, `lsof saw a worker socket to the canary during blocked probes: ${blockedSocketRows.join('; ')}`)
    return {
      positiveControl: 'passed',
      blockedApiCalls: blockedResult,
      preloadedNativeFunctionReferenceBypass: savedReferenceBypassedStub ? 'reproduced' : 'not-reproduced',
      additionalRequestsFromBlockedWorker: 0,
      osSocketTable: {
        positiveControlEstablishedSocketObserved: true,
        blockedWorkerEstablishedSocketsObserved: 0,
      },
    }
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose))
  }
}

async function runProductionInference() {
  if (!modelRoot) return { productionInference: 'not-run (pass --model-root to exercise the real model worker)' }

  const sourceRoot = join(root, 'apps/desktop/src/main/laya')
  const [workerSource, bertSource, tokenizerSource] = await Promise.all([
    readFile(join(sourceRoot, 'worker.ts'), 'utf8'),
    readFile(join(sourceRoot, 'bert.ts'), 'utf8'),
    readFile(join(sourceRoot, 'tokenizer.ts'), 'utf8'),
  ])
  const guardIndex = workerSource.indexOf('installNetworkStubs()')
  const bertImportIndex = workerSource.indexOf("import('./bert')")
  const tokenizerImportIndex = workerSource.indexOf("import('./tokenizer')")
  assert(guardIndex >= 0 && bertImportIndex > guardIndex && tokenizerImportIndex > guardIndex, 'Inference modules must be loaded only after network guards are installed.')
  const networkImport = /(?:from\s*|import\s*\()\s*['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process)['"]/g
  assert(!networkImport.test(workerSource) && !networkImport.test(bertSource) && !networkImport.test(tokenizerSource), 'An inference module imports a network-capable transport.')

  const outDir = join(root, 'apps/desktop/out/main')
  const workerNames = await readdir(outDir)
  const candidates = await Promise.all(workerNames
    .filter((name) => /^worker-.+\.js$/.test(name))
    .map(async (name) => {
      const file = join(outDir, name)
      const source = await readFile(file, 'utf8')
      return source.includes('Embedding failed.') && source.includes('installNetworkStubs') ? file : null
    }))
  const productionWorker = candidates.find(Boolean)
  assert(productionWorker, 'Production Laya worker bundle was not found; run `npm run build` first.')
  const workerBundleSource = await readFile(productionWorker, 'utf8')
  const bundleGuardIndex = workerBundleSource.indexOf('networkStubs.installNetworkStubs()')
  const bundledBertIndex = workerBundleSource.search(/require\(["']\.\/bert-[^"']+["']\)/)
  const bundledTokenizerIndex = workerBundleSource.search(/require\(["']\.\/tokenizer-[^"']+["']\)/)
  assert(bundleGuardIndex >= 0 && bundledBertIndex > bundleGuardIndex && bundledTokenizerIndex > bundleGuardIndex, 'Built Laya worker does not install guards before loading inference bundles.')

  const modelDir = join(modelRoot, 'models', LAYA_MODEL.id.replace('/', '__'), LAYA_MODEL.revision)
  const weightPath = join(modelDir, LAYA_MODEL.files.find((file) => file.name === 'model.safetensors').name)
  const vocabPath = join(modelDir, LAYA_MODEL.files.find((file) => file.name === 'vocab.txt').name)
  const [weightInfo, vocabInfo, vocab] = await Promise.all([stat(weightPath), stat(vocabPath), readFile(vocabPath, 'utf8')])
  assert(weightInfo.size === LAYA_MODEL.files[0].bytes && vocabInfo.size === LAYA_MODEL.files[1].bytes, 'Pinned MiniLM files are missing or have unexpected sizes.')
  const weightBytes = await readFile(weightPath)
  const weightHash = createHash('sha256').update(weightBytes).digest('hex')
  const vocabHash = createHash('sha256').update(vocab).digest('hex')
  assert(weightHash === LAYA_MODEL.files.find((file) => file.name === 'model.safetensors').sha256, 'Model weights do not match the pinned Laya fingerprint.')
  assert(vocabHash === LAYA_MODEL.files.find((file) => file.name === 'vocab.txt').sha256, 'Model vocabulary does not match the pinned Laya fingerprint.')
  const shared = new SharedArrayBuffer(weightBytes.byteLength)
  new Uint8Array(shared).set(weightBytes)
  const worker = new Worker(productionWorker, {
    workerData: { weights: shared, vocab, maxTokens: LAYA_MODEL.maxTokens },
    resourceLimits: { maxOldGenerationSizeMb: 512 },
  })
  const start = Date.now()
  const socketRows = new Set()
  let inferenceDone = false
  const socketWatch = (async () => {
    while (!inferenceDone) {
      for (const row of networkSockets()) socketRows.add(row)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  })()
  const response = workerMessage(worker, 120_000)
  worker.postMessage({ id: 1, texts: ['synthetic Laya local network privacy verification'] })
  let result
  try {
    result = await response
  } finally {
    inferenceDone = true
    await socketWatch
    await worker.terminate()
  }
  assert(result?.id === 1 && Array.isArray(result.vectors) && result.vectors.length === 1, 'Production worker did not return one embedding.')
  const vector = result.vectors[0] instanceof Float32Array ? result.vectors[0] : new Float32Array(result.vectors[0])
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  assert(vector.length === 384 && Number.isFinite(norm) && Math.abs(norm - 1) < 1e-4, 'Production worker returned an invalid embedding.')

  assert(socketRows.size === 0, `lsof saw network sockets during inference: ${[...socketRows].join('; ')}`)

  return {
    productionInference: 'passed',
    model: `${LAYA_MODEL.id}@${LAYA_MODEL.revision}`,
    modelSha256: weightHash,
    vocabSha256: vocabHash,
    outputDimensions: vector.length,
    outputNorm: Number(norm.toFixed(8)),
    elapsedMs: Date.now() - start,
    productionWorkerBundle: 'static import audit passed; compiled guard call precedes dynamic BERT/tokenizer module loads',
    osSocketTable: `lsof polled the verifier process every 50ms while inference ran (${Math.max(1, Math.ceil((Date.now() - start) / 50))} samples); no network socket rows were observed`,
    caveat: 'This is OS socket-table observation, not a packet capture or OS sandbox. It does not rule out very brief sockets between polls.',
  }
}

try {
  const canary = await exerciseCanary()
  const inference = await runProductionInference()
  const report = {
    schema: 'intoponet.laya-privacy-verification.v1',
    runtime: process.version,
    executedAt: new Date().toISOString(),
    canary,
    ...inference,
    boundary: 'The canary demonstrates production network-stub behavior in a real Node worker thread and verifies the local endpoint using a positive control. It is not an OS network sandbox or packet capture. The optional inference run exercises the compiled Laya worker and checks the process socket table during the run.',
  }
  const reportDir = join(root, 'experiments/laya-privacy-verification/results')
  await mkdir(reportDir, { recursive: true })
  const reportPath = join(reportDir, 'latest.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ ...report, reportPath: 'experiments/laya-privacy-verification/results/latest.json' }, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
