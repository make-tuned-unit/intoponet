'use strict'

delete process.env.ELECTRON_RUN_AS_NODE

const { existsSync } = require('node:fs')
const { spawn } = require('node:child_process')
const { join } = require('node:path')

const root = join(__dirname, '..')
const desktop = join(root, 'apps', 'desktop')
const binaryName = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
const binary = [
  join(desktop, 'node_modules', '.bin', binaryName),
  join(root, 'node_modules', '.bin', binaryName),
].find((candidate) => existsSync(candidate))

if (!binary) {
  console.error('electron-vite is not installed. Run npm install from the repository root.')
  process.exit(1)
}

const mode = process.argv[2] === 'preview' ? 'preview' : 'dev'
const extra = process.argv.slice(mode === process.argv[2] ? 3 : 2)
const child = spawn(binary, [mode, ...extra], {
  cwd: desktop,
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
