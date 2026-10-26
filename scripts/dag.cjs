#!/usr/bin/env node
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const graph = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'EXECUTION_DAG.json'), 'utf8'))
const statuses = new Set(['verified', 'active', 'planned', 'blocked'])
const nodes = new Map()

if (graph.schema !== 'intoponet.execution-dag.v1' || !Array.isArray(graph.nodes)) {
  throw new Error('Invalid execution DAG schema')
}
for (const node of graph.nodes) {
  if (typeof node.id !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(node.id) || nodes.has(node.id)) {
    throw new Error(`Invalid or duplicate node ID: ${node.id}`)
  }
  if (!Array.isArray(node.deps) || !statuses.has(node.status) || !node.title || !node.accept) {
    throw new Error(`Invalid node: ${node.id}`)
  }
  if (node.status === 'verified' && !node.evidence) {
    throw new Error(`Verified node lacks evidence: ${node.id}`)
  }
  nodes.set(node.id, node)
}

const visiting = new Set()
const visited = new Set()
function visit(id) {
  if (visited.has(id)) return
  if (visiting.has(id)) throw new Error(`Cycle at ${id}`)
  const node = nodes.get(id)
  if (!node) throw new Error(`Unknown dependency: ${id}`)
  visiting.add(id)
  for (const dep of node.deps) visit(dep)
  visiting.delete(id)
  visited.add(id)
}
for (const id of nodes.keys()) visit(id)
for (const node of nodes.values()) {
  if (node.status === 'verified' && node.deps.some((dep) => nodes.get(dep).status !== 'verified')) {
    throw new Error(`Verified node has unverified dependency: ${node.id}`)
  }
}

const ready = [...nodes.values()].filter(
  (node) => node.status === 'planned' && node.deps.every((dep) => nodes.get(dep).status === 'verified'),
)
const active = [...nodes.values()].filter((node) => node.status === 'active')
const blocked = [...nodes.values()].filter((node) => node.status === 'blocked')
const command = process.argv[2] || 'status'

if (command === 'check') {
  process.stdout.write(`Valid DAG: ${nodes.size} nodes, no cycles.\n`)
} else if (command === 'ready') {
  for (const node of ready) process.stdout.write(`${node.id}\t${node.title}\n`)
} else if (command === 'status') {
  const verified = [...nodes.values()].filter((node) => node.status === 'verified').length
  process.stdout.write(`${nodes.size} nodes: ${verified} verified, ${active.length} active, ${ready.length} ready, ${blocked.length} externally blocked.\n`)
  for (const node of active) process.stdout.write(`ACTIVE\t${node.id}\t${node.title}\n`)
  for (const node of ready) process.stdout.write(`READY\t${node.id}\t${node.title}\n`)
  for (const node of blocked) process.stdout.write(`BLOCKED\t${node.id}\t${node.title}\n`)
} else if (command === 'show') {
  const node = nodes.get(process.argv[3])
  if (!node) throw new Error(`Unknown node: ${process.argv[3]}`)
  process.stdout.write(`${JSON.stringify(node, null, 2)}\n`)
} else {
  throw new Error('Usage: npm run dag -- [check|ready|status|show NODE_ID]')
}
