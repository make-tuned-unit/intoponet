/**
 * LAY-001 defense-in-depth: block JavaScript network APIs in the inference
 * worker. This is not an OS sandbox: native bindings, previously captured
 * function references, or another unpatched transport can bypass it. Keep the
 * worker's imports audited and install guards before loading inference code.
 */
export function installNetworkStubs(): void {
  const refuse = (): never => {
    throw new Error('Laya has no network access.')
  }
  const g = globalThis as Record<string, unknown>
  g['fetch'] = () => Promise.reject(new Error('Laya has no network access.'))
  for (const name of ['WebSocket', 'EventSource', 'XMLHttpRequest']) {
    g[name] = function blocked() { refuse() }
  }
  const builtin = (process as unknown as { getBuiltinModule?: (id: string) => Record<string, unknown> | undefined }).getBuiltinModule
  if (!builtin) throw new Error('Laya cannot establish network isolation in this runtime.')
  const replace = (target: Record<string, unknown>, name: string, label: string, replacement: (...args: never[]) => never = refuse): void => {
    if (typeof target[name] !== 'function') return
    try {
      Object.defineProperty(target, name, { value: replacement, configurable: false, writable: false })
    } catch {
      if (target[name] !== replacement) throw new Error(`Laya could not block ${label}.`)
    }
    if (target[name] !== replacement) throw new Error(`Laya could not block ${label}.`)
  }
  const patch = (id: string, names: string[]): void => {
    const mod = builtin(id)
    if (!mod) return
    for (const name of names) replace(mod, name, `${id}.${name}`)
  }
  patch('node:http', ['request', 'get'])
  patch('node:https', ['request', 'get'])
  patch('node:http2', ['connect'])
  patch('node:net', ['connect', 'createConnection'])
  patch('node:tls', ['connect'])
  patch('node:dgram', ['createSocket'])
  patch('node:child_process', ['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync'])
  const workerThreads = builtin('node:worker_threads')
  if (workerThreads) replace(workerThreads, 'Worker', 'node:worker_threads.Worker', function blockedWorker() { return refuse() })
  patch('node:dns', [
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse',
  ])
  patch('node:dns/promises', [
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
  ])
  const net = builtin('node:net') as { Socket?: { prototype: Record<string, unknown> } } | undefined
  if (net?.Socket) replace(net.Socket.prototype, 'connect', 'node:net.Socket.connect')
  const dns = builtin('node:dns') as { Resolver?: { prototype: Record<string, unknown> } } | undefined
  if (dns?.Resolver) {
    for (const name of [
      'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname',
      'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa',
      'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
    ]) replace(dns.Resolver.prototype, name, `node:dns.Resolver.${name}`)
  }
  const dnsPromises = builtin('node:dns/promises') as { Resolver?: { prototype: Record<string, unknown> } } | undefined
  if (dnsPromises?.Resolver) {
    for (const name of [
      'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname',
      'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa',
      'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
    ]) replace(dnsPromises.Resolver.prototype, name, `node:dns/promises.Resolver.${name}`)
  }
}
