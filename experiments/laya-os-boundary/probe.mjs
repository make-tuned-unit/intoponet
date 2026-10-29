import { spawn } from 'node:child_process'
import net from 'node:net'

if (process.platform !== 'darwin') {
  console.error('This probe requires macOS sandbox-exec.')
  process.exit(2)
}

const hits = []
const server = net.createServer((socket) => {
  hits.push('accepted')
  const body = 'synthetic-local-canary\n'
  socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
})

const listen = new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

try {
  await listen
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not bind local canary')
  const url = `http://127.0.0.1:${address.port}/synthetic-canary`

  const baseline = await curl(url)
  if (baseline.code !== 0 || !baseline.stdout.includes('synthetic-local-canary') || hits.length !== 1) {
    throw new Error(`Unsandboxed positive control failed: ${JSON.stringify({ ...baseline, hits: hits.length })}`)
  }

  const blocked = await run('/usr/bin/sandbox-exec', [
    '-p', '(version 1) (allow default) (deny network*)',
    '/usr/bin/curl', '--max-time', '3', '--silent', '--show-error', url,
  ])
  await new Promise((resolve) => setTimeout(resolve, 100))

  const report = {
    experiment: 'laya-os-boundary',
    platform: `${process.platform} ${process.release.name}`,
    sandboxProfile: 'allow default; deny network*',
    localCanary: '127.0.0.1; synthetic response only',
    baseline: { exitCode: baseline.code, canaryConnections: 1 },
    restricted: { exitCode: blocked.code, stderr: blocked.stderr.trim(), canaryConnections: hits.length - 1 },
    result: blocked.code !== 0 && hits.length === 1 ? 'network-denial-observed' : 'unexpected-network-access',
    limitations: [
      'sandbox-exec is deprecated and this profile is an experiment, not a production contract',
      'the profile allows default filesystem access and tests only this local TCP path',
      'this does not test Electron, WebRTC, DNS, UDP, XPC, or the production Laya process',
    ],
  }
  console.log(JSON.stringify(report, null, 2))
  if (report.result !== 'network-denial-observed') process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  server.close()
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

function curl(url) {
  return run('/usr/bin/curl', ['--max-time', '3', '--silent', '--show-error', url])
}
