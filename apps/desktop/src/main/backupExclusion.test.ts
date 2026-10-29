import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  backupExclusionAvailable,
  backupExclusionStatus,
  readBackupExclusionIntent,
  setBackupExclusion,
  watchBackupExclusionPaths,
  type BackupExclusionAdapter,
  type BackupExclusionWatchAdapter,
} from './backupExclusion'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = '' })
const makeRoot = async () => { root = await mkdtemp(join(tmpdir(), 'backup-exclusion-')); return root }
const pathsIn = (path: string) => [join(path, 'private-library.v1.seal'), ...['knowledge', 'laya', 'personal'].map((name) => join(path, name))]
const adapter = (
  run: BackupExclusionAdapter['run'],
  overrides: Partial<BackupExclusionAdapter> = {},
): BackupExclusionAdapter => ({ platform: 'darwin', available: true, exists: () => true, run, ...overrides })

describe('Time Machine backup exclusion intent', () => {
  it('reports enabled only when every requested existing path is excluded', async () => {
    const paths = pathsIn('/tmp/app-data')
    const run = vi.fn(async () => ({ stdout: paths.map((path) => `[Excluded]\t${path}`).join('\n') }))
    await expect(backupExclusionStatus(paths, true, adapter(run))).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith(['isexcluded', ...paths])
  })

  it('reports included only when all existing paths are included', async () => {
    const paths = pathsIn('/tmp/app-data')
    const run = vi.fn(async () => ({ stdout: paths.map((path) => `[Included]\t${path}`).join('\n') }))
    await expect(backupExclusionStatus(paths, false, adapter(run))).resolves.toBe(false)
  })

  it('reports unknown when a requested store is missing, status is partial, or output is malformed', async () => {
    const paths = pathsIn('/tmp/app-data')
    const missing = paths.slice(1)
    await expect(backupExclusionStatus(paths, true, adapter(async () => ({ stdout: '' }), { exists: (path) => missing.includes(path) }))).resolves.toBeNull()
    await expect(backupExclusionStatus(paths, true, adapter(async () => ({
      stdout: paths.map((path, index) => `[${index ? 'Included' : 'Excluded'}]\t${path}`).join('\n'),
    })))).resolves.toBeNull()
    await expect(backupExclusionStatus(paths, true, adapter(async () => ({ stdout: '[Excluded]\t/only/one' })))).resolves.toBeNull()
    await expect(backupExclusionStatus(paths, true, adapter(async () => { throw new Error('tmutil unavailable') }))).resolves.toBeNull()
  })

  it('reports unsupported platforms as unavailable and does not run commands', async () => {
    const run = vi.fn(async () => ({ stdout: '' }))
    const unsupported = adapter(run, { platform: 'linux' })
    expect(backupExclusionAvailable(unsupported)).toBe(false)
    await expect(backupExclusionStatus(pathsIn('/tmp/app-data'), false, unsupported)).resolves.toBeNull()
    await setBackupExclusion(pathsIn('/tmp/app-data'), true, '/tmp/no-write.json', unsupported)
    expect(run).not.toHaveBeenCalled()
  })

  it('persists the requested setting and applies sticky exclusions only to existing paths', async () => {
    const base = await makeRoot()
    const paths = pathsIn(base)
    await mkdir(paths[1]!, { recursive: true })
    const intentPath = join(base, 'backup-exclusion.json')
    const run = vi.fn(async () => ({ stdout: paths.slice(1, 2).map((path) => `[Excluded]\t${path}`).join('\n') }))
    await setBackupExclusion(paths, true, intentPath, adapter(run, { exists: (path) => path === paths[1] }))
    expect(readBackupExclusionIntent(intentPath)).toBe(true)
    expect(run).toHaveBeenNthCalledWith(1, ['addexclusion', paths[1]])
    expect(run).toHaveBeenNthCalledWith(2, ['isexcluded', paths[1]])
  })

  it('removes existing sticky exclusions and persisted intent when disabling', async () => {
    const base = await makeRoot()
    const paths = pathsIn(base)
    await mkdir(paths[1]!, { recursive: true })
    const intentPath = join(base, 'backup-exclusion.json')
    await writeFile(intentPath, JSON.stringify({ excluded: true }))
    const run = vi.fn(async () => ({ stdout: `[Included]\t${paths[1]}` }))
    await setBackupExclusion(paths, false, intentPath, adapter(run, { exists: (path) => path === paths[1] }))
    expect(readBackupExclusionIntent(intentPath)).toBe(false)
    expect(run).toHaveBeenNthCalledWith(1, ['removeexclusion', paths[1]])
    expect(run).toHaveBeenNthCalledWith(2, ['isexcluded', paths[1]])
  })

  it('keeps the requested intent and fails if existing paths cannot be verified', async () => {
    const base = await makeRoot()
    const paths = pathsIn(base)
    await mkdir(paths[1]!, { recursive: true })
    const intentPath = join(base, 'backup-exclusion.json')
    await expect(setBackupExclusion(paths, true, intentPath, adapter(async (args) => {
      if (args[0] === 'addexclusion') return { stdout: '' }
      return { stdout: `[Included]\t${paths[1]}` }
    }, { exists: (path) => path === paths[1] }))).rejects.toThrow(/could not be verified/i)
    expect(readBackupExclusionIntent(intentPath)).toBe(true)
  })

  it('reapplies the saved request when a named store appears', async () => {
    const base = await makeRoot()
    const paths = pathsIn(base)
    const intentPath = join(base, 'backup-exclusion.json')
    await writeFile(intentPath, JSON.stringify({ excluded: true }))
    const run = vi.fn(async () => ({ stdout: '' }))
    let notify!: (event: 'rename' | 'change', filename: string | null) => void
    const watcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> }
    watcher.close = vi.fn()
    const runtimeAdapter: BackupExclusionWatchAdapter = {
      ...adapter(run, { exists: (path) => path === paths[1] && existsSync(path) }),
      watchDirectory: (_path, listener) => {
        notify = listener
        return watcher as unknown as FSWatcher
      },
    }
    const onStateChanged = vi.fn()
    const stop = watchBackupExclusionPaths(base, paths, intentPath, onStateChanged, runtimeAdapter)
    try {
      await mkdir(paths[1]!, { recursive: true })
      notify('rename', 'knowledge')
      await vi.waitFor(() => expect(run).toHaveBeenCalledWith(['addexclusion', paths[1]]), { timeout: 2_000 })
      await vi.waitFor(() => expect(onStateChanged).toHaveBeenCalled(), { timeout: 2_000 })
    } finally {
      stop()
    }
  })

  it('serializes delayed startup apply before a user disables the exclusion', async () => {
    const base = await makeRoot()
    const paths = pathsIn(base)
    const intentPath = join(base, 'backup-exclusion.json')
    await writeFile(intentPath, JSON.stringify({ excluded: true }))
    let beginAdd!: () => void
    let finishAdd!: () => void
    const addStarted = new Promise<void>((resolve) => { beginAdd = resolve })
    const addGate = new Promise<void>((resolve) => { finishAdd = resolve })
    const calls: string[][] = []
    const run: BackupExclusionAdapter['run'] = async (args) => {
      calls.push(args)
      if (args[0] === 'addexclusion') {
        beginAdd()
        await addGate
        return { stdout: '' }
      }
      if (args[0] === 'isexcluded') return { stdout: paths.map((path) => `[Included]\t${path}`).join('\n') }
      return { stdout: '' }
    }
    const runtimeAdapter: BackupExclusionWatchAdapter = {
      ...adapter(run),
      watchDirectory: (path, listener) => fsWatch(path, (event, filename) => listener(event, filename?.toString() ?? null)),
    }
    const stop = watchBackupExclusionPaths(base, paths, intentPath, () => undefined, runtimeAdapter)
    try {
      await addStarted
      const disabling = setBackupExclusion(paths, false, intentPath, runtimeAdapter)
      finishAdd()
      await disabling
      expect(calls.map(([verb]) => verb)).toEqual(['addexclusion', 'removeexclusion', 'isexcluded'])
      expect(readBackupExclusionIntent(intentPath)).toBe(false)
    } finally {
      stop()
    }
  })

  it('cancels a pending watcher debounce on disposal', async () => {
    vi.useFakeTimers()
    try {
      const base = await makeRoot()
      const paths = pathsIn(base)
      const intentPath = join(base, 'backup-exclusion.json')
      const run = vi.fn(async () => ({ stdout: '' }))
      let notify!: (event: 'rename' | 'change', filename: string | null) => void
      const watcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> }
      watcher.close = vi.fn()
      const runtimeAdapter: BackupExclusionWatchAdapter = {
        ...adapter(run),
        watchDirectory: (_path, listener) => {
          notify = listener
          return watcher as unknown as FSWatcher
        },
      }
      const onStateChanged = vi.fn()
      const stop = watchBackupExclusionPaths(base, paths, intentPath, onStateChanged, runtimeAdapter)
      await vi.waitFor(() => expect(onStateChanged).toHaveBeenCalledOnce())
      notify('rename', 'knowledge')
      const callbacksBeforeDispose = onStateChanged.mock.calls.length
      stop()
      await vi.advanceTimersByTimeAsync(200)
      expect(run).not.toHaveBeenCalled()
      expect(onStateChanged).toHaveBeenCalledTimes(callbacksBeforeDispose)
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles asynchronous watcher errors, clears debounce, and still completes startup apply', async () => {
    vi.useFakeTimers()
    try {
      const base = await makeRoot()
      const paths = pathsIn(base)
      const intentPath = join(base, 'backup-exclusion.json')
      await writeFile(intentPath, JSON.stringify({ excluded: true }))
      const run = vi.fn(async () => ({ stdout: '' }))
      const onStateChanged = vi.fn()
      const watcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> }
      watcher.close = vi.fn()
      let notify!: (event: 'rename' | 'change', filename: string | null) => void
      const runtimeAdapter: BackupExclusionWatchAdapter = {
        ...adapter(run),
        watchDirectory: (_path, listener) => {
          notify = listener
          return watcher as unknown as FSWatcher
        },
      }
      const stop = watchBackupExclusionPaths(base, paths, intentPath, onStateChanged, runtimeAdapter)
      notify('rename', 'knowledge')
      watcher.emit('error', new Error('watch unavailable'))
      expect(watcher.close).toHaveBeenCalledOnce()
      expect(onStateChanged).toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(200)
      expect(run).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledWith(['addexclusion', ...paths])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cancel startup apply when watcher creation fails', async () => {
    const base = await makeRoot()
    const paths = pathsIn(base)
    const intentPath = join(base, 'backup-exclusion.json')
    await writeFile(intentPath, JSON.stringify({ excluded: true }))
    const run = vi.fn(async () => ({ stdout: '' }))
    const onStateChanged = vi.fn()
    const runtimeAdapter: BackupExclusionWatchAdapter = {
      ...adapter(run),
      watchDirectory: () => { throw new Error('watch unavailable') },
    }
    watchBackupExclusionPaths(base, paths, intentPath, onStateChanged, runtimeAdapter)
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(['addexclusion', ...paths]))
    expect(onStateChanged).toHaveBeenCalled()
  })

  it('allows immediate disposal after watcher setup fails to suppress queued startup work', async () => {
    const base = await makeRoot()
    const paths = pathsIn(base)
    const intentPath = join(base, 'backup-exclusion.json')
    await writeFile(intentPath, JSON.stringify({ excluded: true }))
    const run = vi.fn(async () => ({ stdout: '' }))
    const onStateChanged = vi.fn()
    const runtimeAdapter: BackupExclusionWatchAdapter = {
      ...adapter(run),
      watchDirectory: () => { throw new Error('watch unavailable') },
    }
    const stop = watchBackupExclusionPaths(base, paths, intentPath, onStateChanged, runtimeAdapter)
    stop()
    await vi.waitFor(() => expect(onStateChanged).toHaveBeenCalledOnce())
    expect(run).not.toHaveBeenCalled()
  })

  it('treats malformed persisted intent as unknown', async () => {
    const base = await makeRoot()
    const intentPath = join(base, 'backup-exclusion.json')
    await writeFile(intentPath, '{invalid')
    expect(readBackupExclusionIntent(intentPath)).toBeNull()
    await expect(readFile(intentPath, 'utf8')).resolves.toBe('{invalid')
  })
})
