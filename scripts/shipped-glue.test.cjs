'use strict'

const assert = require('node:assert/strict')
const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { Worker } = require('node:worker_threads')
const { checkShippedGlue, glueMarkers, GLUE_SHA256, SHIPPED_GLUE, VENDORED_GLUE } = require('./shipped-glue.cjs')

const realOut = path.resolve(__dirname, '../apps/desktop/out')
// The checks on a real build run when asked for (npm run test:build, which builds first). Plain
// `npm test` does not depend on whatever build happens to be lying in out/.
const needsBuild = process.env.INTOPONET_REQUIRE_BUILD === '1' ? {} : { skip: 'checks a real build: run npm run test:build' }

/** A pretend build output: main/index.js, a worker chunk, and the glue where a build puts it. */
function fakeBuild(t, { chunk = 'const worker = 1\n', glue = readFileSync(VENDORED_GLUE) } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'intoponet-shipped-glue-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(path.join(dir, 'main/vendor'), { recursive: true })
  writeFileSync(path.join(dir, 'main/index.js'), 'const main = 1\n')
  writeFileSync(path.join(dir, 'main/worker-abc.js'), chunk)
  if (glue) writeFileSync(path.join(dir, SHIPPED_GLUE), glue)
  return dir
}

test('the vendored glue is the file recorded in the notices, and has lines to search for', () => {
  const text = readFileSync(VENDORED_GLUE, 'utf8')
  assert.match(text, /This Source Code Form is subject to the terms of the Mozilla Public/)
  const markers = glueMarkers(text)
  assert.ok(markers.length >= 30, `only ${markers.length} lines to search for`)
  assert.ok(markers.some((line) => line.includes('This Source Code Form is subject to the terms of the Mozilla Public')))
  assert.match(GLUE_SHA256, /^[0-9a-f]{64}$/)
})

test('a build that ships the glue byte for byte as its own file passes', (t) => {
  const result = checkShippedGlue({ outDir: fakeBuild(t) })
  assert.equal(result.sha256, GLUE_SHA256)
  assert.equal(result.scanned, 2)
})

test('a build whose own code contains the glue text fails, whether pasted in or embedded as a string', (t) => {
  const text = readFileSync(VENDORED_GLUE, 'utf8')
  assert.throws(() => checkShippedGlue({ outDir: fakeBuild(t, { chunk: `const worker = 1\n${text}` }) }), /worker-abc\.js contains text of the MPL-2\.0 glue/)
  // What `?raw` produced: the file inside a template literal, with backslashes, backticks and ${ escaped.
  const embedded = `const glue = \`${text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\`\n`
  assert.throws(() => checkShippedGlue({ outDir: fakeBuild(t, { chunk: embedded }) }), /contains text of the MPL-2\.0 glue/)
  // A part of it is enough.
  const part = text.split('\n').slice(200, 400).join('\n')
  assert.throws(() => checkShippedGlue({ outDir: fakeBuild(t, { chunk: part }) }), /contains text of the MPL-2\.0 glue/)
})

test('a missing or altered shipped copy, a changed vendored file and a missing build all fail', (t) => {
  assert.throws(() => checkShippedGlue({ outDir: fakeBuild(t, { glue: null }) }), /does not ship the glue as its own file/)
  const altered = Buffer.concat([readFileSync(VENDORED_GLUE), Buffer.from('\n')])
  assert.throws(() => checkShippedGlue({ outDir: fakeBuild(t, { glue: altered }) }), /differs from the vendored file/)
  assert.throws(() => checkShippedGlue({ outDir: fakeBuild(t), expectedSha256: '0'.repeat(64) }), /vendored glue has been changed/)
  assert.throws(() => checkShippedGlue({ outDir: path.join(os.tmpdir(), 'intoponet-no-such-build') }), /no build output/)
  const empty = fakeBuild(t)
  rmSync(path.join(empty, 'main/index.js'))
  assert.throws(() => checkShippedGlue({ outDir: empty }), /no main\/index\.js/)
})

test('the built app ships the glue as its own file and none of its text is in the app code', needsBuild, () => {
  const result = checkShippedGlue({ outDir: realOut })
  assert.equal(result.sha256, GLUE_SHA256)
  assert.ok(result.scanned >= 10, `only ${result.scanned} built files were searched`)
})

test('the built translation worker runs the glue it is handed from the shipped file', needsBuild, async (t) => {
  const main = path.join(realOut, 'main')
  // The translation worker is the built chunk that takes the glue from workerData.
  const workers = readdirSync(main).filter((name) => /^worker-.*\.js$/.test(name) && readFileSync(path.join(main, name), 'utf8').includes('bergamot-translator.js'))
  assert.equal(workers.length, 1, `expected one translation worker chunk, found ${workers.join(', ') || 'none'}`)
  const index = readFileSync(path.join(main, 'index.js'), 'utf8')
  assert.match(index, /__dirname, "\.\/vendor\/bergamot-translator\.js"\)/, 'the main process does not read the glue from out/main/vendor')

  // Run a copy of the build output outside the repository, so nothing can be picked up from source.
  const copy = mkdtempSync(path.join(os.tmpdir(), 'intoponet-built-worker-'))
  t.after(() => rmSync(copy, { recursive: true, force: true }))
  cpSync(main, path.join(copy, 'main'), { recursive: true })
  const script = path.join(copy, 'main', workers[0])
  const glue = readFileSync(path.join(copy, SHIPPED_GLUE), 'utf8')

  const ask = (worker, message) => new Promise((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.postMessage(message)
  })
  const worker = new Worker(script, { workerData: { glue } })
  t.after(() => worker.terminate())
  // The worker evaluates the glue as it starts; a reply means that worked.
  assert.deepEqual(await ask(worker, { id: 1, type: 'unload', key: 'none' }), { id: 1, ok: true })
  // The glue itself runs: handed bytes that are not WebAssembly, the engine it sets up refuses to start.
  // The refusal arrives as the worker's reply or as the glue's own abort, whichever comes first; a
  // worker that had not run the glue would answer neither way.
  const second = new Worker(script, { workerData: { glue } })
  t.after(() => second.terminate())
  const refused = await ask(second, { id: 2, type: 'init', wasm: new ArrayBuffer(8) }).catch((error) => error)
  if (refused instanceof Error) assert.match(`${refused.message}\n${refused.stack}`, /Aborted\(CompileError[\s\S]*bergamot-translator\.js/)
  else assert.deepEqual(refused, { id: 2, ok: false, error: 'The translation engine failed to start.' })

  // Without the file's text the worker does not start at all: the glue is not inside the chunk.
  const bare = new Worker(script)
  t.after(() => bare.terminate())
  await assert.rejects(new Promise((resolve, reject) => { bare.once('error', reject); bare.once('message', resolve); bare.postMessage({ id: 1, type: 'unload', key: 'none' }) }), /glue was not handed to the worker/)
  assert.ok(existsSync(script))
})
