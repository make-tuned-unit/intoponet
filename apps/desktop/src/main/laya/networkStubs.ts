/**
 * LAY-001: the inference worker has no network. Every outbound API a library
 * could reach for is replaced with one that throws. Self-contained (no
 * imports) so it can also be checked inside an isolated test worker.
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
  if (!builtin) return
  const patch = (id: string, names: string[]): void => {
    const mod = builtin(id)
    if (!mod) return
    for (const name of names) {
      try {
        Object.defineProperty(mod, name, { value: refuse, configurable: false, writable: false })
      } catch {
        // Non-configurable on some builds; the module is still unused by Laya.
      }
    }
  }
  patch('node:http', ['request', 'get'])
  patch('node:https', ['request', 'get'])
  patch('node:http2', ['connect'])
  patch('node:net', ['connect', 'createConnection'])
  patch('node:tls', ['connect'])
  patch('node:dgram', ['createSocket'])
  patch('node:dns', ['lookup', 'resolve'])
  const net = builtin('node:net') as { Socket?: { prototype: Record<string, unknown> } } | undefined
  if (net?.Socket) {
    try {
      Object.defineProperty(net.Socket.prototype, 'connect', { value: refuse, configurable: false, writable: false })
    } catch {
      // ignore
    }
  }
}
