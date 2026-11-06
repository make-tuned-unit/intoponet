#!/usr/bin/env node
// Walk docs/FEATURE_DAG.json in dependency order and prove each feature end to end
// in the built app. Usage:
//   npm run verify:features                 core + network checks
//   npm run verify:features -- --tier full  also checks that download language models
//   npm run verify:features -- --only FLY_TO,GLOBE_MOTION   just these (their deps are assumed; the app is still rebuilt)
//   npm run verify:features -- --skip-build                 reuse the current build
//   npm run verify:features -- --list
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checks } from '../experiments/e2e/checks.mjs'
import { CheckFailure, runAppCheck } from '../experiments/e2e/lib.mjs'

const repo = resolve(import.meta.dirname, '..')
const dag = JSON.parse(readFileSync(join(repo, 'docs/FEATURE_DAG.json'), 'utf8'))
const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? '' }
const tierOrder = ['core', 'network', 'full']
const tier = flag('--tier') ?? 'network'
const only = flag('--only')?.split(',').map((id) => id.trim()).filter(Boolean) ?? null
const skipBuild = args.includes('--skip-build')

// ---- Validate the graph -----------------------------------------------------
if (dag.schema !== 'intoponet.feature-dag.v1') throw new Error('Unknown feature DAG schema.')
const nodes = new Map()
for (const node of dag.nodes) {
  if (nodes.has(node.id)) throw new Error(`Duplicate node ${node.id}`)
  if (!node.promise || !node.title || !Array.isArray(node.deps) || !tierOrder.includes(node.tier)) throw new Error(`Incomplete node ${node.id}`)
  if (node.kind === 'e2e' && !checks[node.id]) throw new Error(`No end-to-end check for ${node.id}`)
  nodes.set(node.id, node)
}
for (const id of Object.keys(checks)) if (!nodes.has(id)) throw new Error(`Check ${id} has no node in the DAG`)
const order = []
const state = new Map()
const visit = (id, path = []) => {
  if (state.get(id) === 'done') return
  if (state.get(id) === 'visiting') throw new Error(`Cycle: ${[...path, id].join(' → ')}`)
  const node = nodes.get(id)
  if (!node) throw new Error(`Unknown dependency ${id}`)
  state.set(id, 'visiting')
  for (const dep of node.deps) visit(dep, [...path, id])
  state.set(id, 'done')
  order.push(node)
}
for (const id of nodes.keys()) visit(id)

if (args.includes('--list')) {
  for (const node of order) console.log(`${node.id.padEnd(22)} ${node.tier.padEnd(8)} deps: ${node.deps.join(', ') || '—'}\n  ${node.promise}`)
  process.exit(0)
}

// ---- Run --------------------------------------------------------------------
const results = new Map()
const evidenceDir = join(repo, 'experiments/e2e/evidence')
const started = new Date()
const timeouts = { core: 150_000, network: 330_000, full: 480_000 }
// --only assumes BUILD passed, but the app under test must still match the source: rebuild it.
if (only && !only.includes('BUILD') && !skipBuild) {
  process.stdout.write('… building the app (npm run build)\n')
  execSync('npm run build', { cwd: repo, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 })
}
for (const node of order) {
  const wanted = only ? only.includes(node.id) : true
  if (!wanted) { results.set(node.id, { status: only ? 'assumed' : 'skipped', notes: '' }); continue }
  if (tierOrder.indexOf(node.tier) > tierOrder.indexOf(tier)) { results.set(node.id, { status: 'skipped', notes: `Needs --tier ${node.tier}.` }); continue }
  const brokenDep = node.deps.find((dep) => ['fail', 'blocked'].includes(results.get(dep)?.status))
  if (brokenDep) { results.set(node.id, { status: 'blocked', notes: `Blocked by ${brokenDep}.` }); console.log(`BLOCKED ${node.id} (by ${brokenDep})`); continue }
  const t0 = Date.now()
  process.stdout.write(`… ${node.id}: ${node.title}\n`)
  try {
    let notes = ''
    if (node.kind === 'command') {
      if (skipBuild) notes = 'Skipped with --skip-build (current build reused).'
      else for (const command of node.run) execSync(command, { cwd: repo, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 })
      notes ||= node.run.join(' · ')
    } else {
      notes = await runAppCheck(checks[node.id], { evidenceDir, name: node.id, timeoutMs: timeouts[node.tier], env: checks[node.id].env ?? {} })
    }
    results.set(node.id, { status: 'pass', notes, seconds: Math.round((Date.now() - t0) / 1000) })
    console.log(`PASS    ${node.id} (${Math.round((Date.now() - t0) / 1000)} s) ${notes}`)
  } catch (error) {
    // Command failures: show the lines that say what broke (errors usually go to stdout for tsc and vitest).
    const output = `${error?.stdout?.toString?.() ?? ''}\n${error?.stderr?.toString?.() ?? ''}`
    const errorLines = output.split('\n').filter((line) => /error|FAIL|failed|✗|×/i.test(line) && !/npm error (code|path|workspace|location|command|Lifecycle)/.test(line)).slice(0, 6).join(' / ')
    const message = error instanceof CheckFailure ? error.message : errorLines || `${error?.message ?? error}`.slice(0, 600)
    results.set(node.id, { status: 'fail', notes: message, seconds: Math.round((Date.now() - t0) / 1000) })
    console.log(`FAIL    ${node.id} (${Math.round((Date.now() - t0) / 1000)} s) ${message}`)
  }
}

// ---- Report -----------------------------------------------------------------
const count = (status) => [...results.values()].filter((result) => result.status === status).length
const summary = `${count('pass')} passed, ${count('fail')} failed, ${count('blocked')} blocked, ${count('skipped')} skipped${only ? `, ${count('assumed')} assumed` : ''}`
mkdirSync(join(repo, 'docs/feature-verification'), { recursive: true })
writeFileSync(join(repo, 'docs/feature-verification/latest.json'), JSON.stringify({ started: started.toISOString(), finished: new Date().toISOString(), tier, only, summary, results: Object.fromEntries(results) }, null, 2))
const icon = { pass: '✅', fail: '❌', blocked: '⛔', skipped: '⏭️', assumed: '·' }
const lines = [
  '# Feature verification',
  '',
  `Run ${started.toISOString().slice(0, 16).replace('T', ' ')} UTC · tier \`${tier}\`${only ? ` · only ${only.join(', ')}` : ''} · **${summary}**.`,
  '',
  'Each feature makes a promise to the user; its check drives the built app end to end. Defined in `docs/FEATURE_DAG.json`, checks in `experiments/e2e/checks.mjs`, run with `npm run verify:features`.',
  '',
  '| | Feature | Promise | Depends on | Result |',
  '| --- | --- | --- | --- | --- |',
  ...order.map((node) => {
    const result = results.get(node.id)
    return `| ${icon[result.status]} | **${node.title}** (\`${node.id}\`) | ${node.promise} | ${node.deps.join(', ') || '—'} | ${result.status}${result.seconds !== undefined ? ` · ${result.seconds} s` : ''}${result.notes ? ` — ${result.notes.replace(/\|/g, '\\|').replace(/\n/g, ' ')}` : ''} |`
  }),
  '',
]
writeFileSync(join(repo, 'docs/FEATURE_VERIFICATION.md'), lines.join('\n'))
console.log(`\n${summary}. Report: docs/FEATURE_VERIFICATION.md`)
process.exit(count('fail') ? 1 : 0)
