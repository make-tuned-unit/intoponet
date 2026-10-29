import { spawn, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const electronBinary = require('electron')
const evidencePath = join(here, 'evidence/native-browser-2026-10-29.json')
const tempRoot = await mkdtemp(join(tmpdir(), 'intoponet-browser-policy-'))
const profile = join(tempRoot, 'profile')
const buildDir = join(tempRoot, 'build')
const certificate = join(tempRoot, 'localhost-cert.pem')
const key = join(tempRoot, 'localhost-key.pem')
const fixture = join(tempRoot, 'fixture.html')

let child = null
let output = ''
let errors = ''
let timeout
try {
  await mkdir(profile, { recursive: true })
  await mkdir(buildDir, { recursive: true })
  await copyFile(join(here, 'fixture.html'), fixture)
  const generated = spawnSync('/usr/bin/openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', certificate, '-days', '1',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  if (generated.status !== 0) throw new Error('Could not generate temporary self-signed localhost certificate')

  const mainBundle = join(buildDir, 'main.cjs')
  await esbuild.build({
    entryPoints: [join(here, 'main.ts')],
    outfile: mainBundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: false,
  })
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...electronEnv } = process.env
  child = spawn(electronBinary, [
    '--user-data-dir=' + profile,
    mainBundle,
    certificate,
    key,
    fixture,
  ], { cwd: root, env: electronEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.setEncoding('utf8').on('data', (part) => { output += part })
  child.stderr.setEncoding('utf8').on('data', (part) => { errors += part })
  timeout = setTimeout(() => child?.kill('SIGKILL'), 60_000)
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)))
  })
  clearTimeout(timeout)
  const marker = 'Browser policy native probe report:\n'
  const reportStart = output.lastIndexOf(marker)
  if (reportStart < 0) throw new Error('Electron probe did not emit a structured report; see stderr: ' + errors.slice(-2_000))
  const report = JSON.parse(output.slice(reportStart + marker.length).trim())
  await rm(profile, { recursive: true, force: true })
  report.generatedAt = new Date().toISOString()
  report.profileIsolation = {
    usedTemporaryUserDataDirectory: true,
    profileDirectoryRemovedAfterRun: true,
    electronRunAsNodeRemoved: true,
  }
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ evidencePath, exitCode, report }, null, 2))
  if (exitCode !== 0 || report.status !== 'passed') process.exitCode = 1
} catch (error) {
  process.exitCode = 1
  console.error(error instanceof Error ? error.message : 'Browser policy probe failed')
} finally {
  if (timeout) clearTimeout(timeout)
  if (child && child.exitCode === null) {
    child.kill('SIGKILL')
    await new Promise((resolveDone) => child.once('exit', resolveDone))
  }
  await rm(tempRoot, { recursive: true, force: true })
}
