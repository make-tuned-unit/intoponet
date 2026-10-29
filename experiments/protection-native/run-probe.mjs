#!/usr/bin/env node
// Bundle and run the native request probe using a throwaway Electron profile.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')
const profile = mkdtempSync(join(process.env.QA_TMP ?? tmpdir(), 'intoponet-protection-probe-'))
const bundle = join(profile, 'probe.cjs')
const esbuild = join(repo, 'node_modules/.bin/esbuild')
const electron = join(repo, 'node_modules/.bin/electron')

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: repo, stdio: 'inherit', ...options })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (signal) rejectRun(new Error(`${command} was terminated by ${signal}`))
      else if (code !== 0) rejectRun(new Error(`${command} exited with code ${code}`))
      else resolveRun()
    })
  })
}

try {
  await run(esbuild, [
    'experiments/protection-native/probe.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--external:electron',
    `--outfile=${bundle}`,
  ])
  await run(electron, [`--user-data-dir=${profile}/user-data`, bundle])
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
}
