import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve, join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const build = join(here, '.build')
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')

await mkdir(build, { recursive: true })
await Promise.all([
  esbuild.build({ entryPoints: [join(here, 'main.ts')], outfile: join(build, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false }),
  esbuild.build({ entryPoints: [join(here, 'preload.ts')], outfile: join(build, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false }),
  esbuild.build({ entryPoints: [join(here, 'renderer.ts')], outfile: join(build, 'renderer.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', sourcemap: false }),
])
await copyFile(join(here, 'index.html'), join(build, 'index.html'))
await copyFile(join(here, 'broker-probe.html'), join(build, 'broker-probe.html'))

if (process.argv.includes('--build-only')) {
  console.log(`Built sandbox experiment into ${build}`)
  process.exit(0)
}

const electronBinary = require('electron')
const modelRootArg = process.argv.slice(2).find((arg) => arg.startsWith('--model-root='))
if (!modelRootArg || !isAbsolute(modelRootArg.slice('--model-root='.length))) {
  throw new Error('Pass an explicit absolute --model-root=/path for the pinned local model.')
}

const userDataDir = await mkdtemp(join(tmpdir(), 'intoponet-laya-sandbox-userdata-'))
let output = ''
let errorOutput = ''
let exitCode = 1
try {
  const electronArgs = [
    `--user-data-dir=${userDataDir}`,
    join(build, 'main.cjs'),
    modelRootArg,
  ]
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...electronEnv } = process.env
  const child = spawn(electronBinary, electronArgs, {
    cwd: root,
    env: electronEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8').on('data', (part) => { output += part; process.stdout.write(part) })
  child.stderr.setEncoding('utf8').on('data', (part) => { errorOutput += part; process.stderr.write(part) })
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 180_000)
  try {
    exitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)))
    })
  } finally {
    clearTimeout(timeout)
    if (timedOut) errorOutput += '\nElectron experiment exceeded 180 seconds and was terminated.\n'
  }

  const marker = 'Laya sandbox experiment report:\n'
  const reportOffset = output.lastIndexOf(marker)
  if (reportOffset < 0) {
    await writeFile(join(build, 'failure.log'), `${errorOutput}\n${output}`)
    process.exitCode = 1
  } else {
    const json = output.slice(reportOffset + marker.length).trim()
    const report = JSON.parse(json)
    await writeFile(join(build, 'evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
    const isPartialBoundary = !report.conclusions?.completeEgressDenialProven || !report.conclusions?.webRtcTransportDenied
    if (exitCode !== 0 || report.status !== 'completed' || isPartialBoundary) process.exitCode = 2
  }
} finally {
  await rm(userDataDir, { recursive: true, force: true })
}
