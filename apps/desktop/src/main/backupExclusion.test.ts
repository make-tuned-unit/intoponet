import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileAtomic } from './atomicFile'
import {
  BACKUP_EXCLUDE_ATTRIBUTE,
  BACKUP_EXCLUDE_VALUE_HEX,
  backupExclusionAvailable,
  backupExclusionMarker,
  backupExclusionStatus,
  markExcludedFromBackup,
  readBackupExclusionIntent,
  setBackupExclusion,
  tmutilTimeoutMs,
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

  it('keeps at most one reapply waiting while a slow one runs, however often the stores are saved', async () => {
    const path = await makeRoot()
    const paths = pathsIn(path)
    const intentPath = join(path, 'backup-exclusion.json')
    await writeFile(intentPath, JSON.stringify({ excluded: true }))
    await writeFile(paths[0]!, 'sealed')
    const finish: Array<() => void> = []
    const run = vi.fn((args: string[]) => args[0] === 'addexclusion' ? new Promise<{ stdout: string }>((resolve) => finish.push(() => resolve({ stdout: '' }))) : Promise.resolve({ stdout: '' }))
    let listener: ((event: 'rename' | 'change', filename: string | null) => void) | null = null
    const watcher = new EventEmitter() as FSWatcher
    watcher.close = () => undefined
    const stop = watchBackupExclusionPaths(path, paths, intentPath, () => undefined, {
      platform: 'darwin', available: true, exists: existsSync, run,
      watchDirectory: (_path, onEvent) => { listener = onEvent; return watcher },
    })
    try {
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
      // The startup apply is still running: twenty saves, each a moment apart.
      for (let i = 0; i < 20; i += 1) {
        listener!('rename', 'private-library.v1.seal')
        await new Promise((resolve) => setTimeout(resolve, 110))
      }
      finish.shift()!()
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
      finish.shift()!()
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(run).toHaveBeenCalledTimes(2)
      // A save after that is applied again.
      listener!('rename', 'private-library.v1.seal')
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3))
      finish.shift()!()
    } finally {
      stop()
    }
  }, 15_000)

  it('gives tmutil time for every path it is asked about, not one short limit for all of them', () => {
    // 11 s a path was measured: four stores must not be cut off after the first.
    expect(tmutilTimeoutMs(['addexclusion', '/a'])).toBeGreaterThanOrEqual(15_000)
    expect(tmutilTimeoutMs(['addexclusion', '/a', '/b', '/c', '/d'])).toBeGreaterThanOrEqual(4 * 15_000)
    expect(tmutilTimeoutMs(['isexcluded'])).toBeGreaterThan(0)
  })

  it('marks existing stores at once when switched on, before tmutil, and a store the moment it appears', async () => {
    const base = await makeRoot()
    const paths = pathsIn(base)
    const intentPath = join(base, 'backup-exclusion.json')
    const order: string[] = []
    const run = vi.fn(async (args: string[]) => {
      order.push(`tmutil ${args[0]}`)
      return { stdout: args[0] === 'isexcluded' ? args.slice(1).map((path) => `[Excluded]\t${path}`).join('\n') : '' }
    })
    const mark = vi.fn(async (path: string) => { order.push(`mark ${path.slice(base.length + 1)}`) })
    let notify!: (event: 'rename' | 'change', filename: string | null) => void
    const watcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> }
    watcher.close = vi.fn()
    const marking: BackupExclusionWatchAdapter = {
      ...adapter(run, { exists: existsSync, mark }),
      watchDirectory: (_path, listener) => { notify = listener; return watcher as unknown as FSWatcher },
    }
    await mkdir(paths[1]!)
    await setBackupExclusion(paths, true, intentPath, marking)
    expect(order).toEqual(['mark knowledge', 'tmutil addexclusion', 'tmutil isexcluded'])
    // The library file is saved for the first time while a slow tmutil pass is still running: marked at once.
    order.length = 0
    let release!: () => void
    run.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { release = resolve }); return { stdout: '' } })
    const stop = watchBackupExclusionPaths(base, paths, intentPath, () => undefined, marking)
    try {
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3))
      mark.mockClear()
      await writeFile(paths[0]!, 'sealed')
      notify('rename', 'private-library.v1.seal')
      expect(mark).toHaveBeenCalledWith(paths[0])
      // Switched off, nothing is marked.
      release()
      await setBackupExclusion(paths, false, intentPath, adapter(async (args) => ({ stdout: args[0] === 'isexcluded' ? args.slice(1).map((path) => `[Included]\t${path}`).join('\n') : '' }), { exists: existsSync }))
      mark.mockClear()
      notify('rename', 'private-library.v1.seal')
      expect(mark).not.toHaveBeenCalled()
      await backupExclusionMarker(intentPath, marking)(paths[0]!)
      expect(mark).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  // On a Mac, with the real attribute and the real tmutil: what the built app does on each save of the library.
  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/tmutil') || !existsSync('/usr/bin/xattr'))('keeps a file that is saved by replacing it excluded through every save, as tmutil itself reads it', async () => {
    // Not under the system's temporary folder, which Time Machine skips whatever is set on a file.
    root = await mkdtemp(join(process.cwd(), '.backup-exclusion-test-'))
    const base = root
    const library = join(base, 'private-library.v1.seal')
    const intentPath = join(base, 'backup-exclusion.json')
    const excluded = (path: string): boolean => /^\[Excluded\]/m.test(execFileSync('/usr/bin/tmutil', ['isexcluded', path], { encoding: 'utf8' }))
    const attribute = (path: string): string => { try { return execFileSync('/usr/bin/xattr', ['-px', BACKUP_EXCLUDE_ATTRIBUTE, path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s+/g, '') } catch { return '' } }
    const prepare = backupExclusionMarker(intentPath)
    // Off: saves leave the file in backups.
    await writeFileAtomic(library, 'one', 0o600, { prepare })
    expect(attribute(library)).toBe('')
    expect(excluded(library)).toBe(false)
    // On: the file that replaces it carries what tmutil itself would set, byte for byte, with nothing more to do.
    await writeFile(intentPath, JSON.stringify({ excluded: true }))
    for (const text of ['two', 'three', 'four']) {
      await writeFileAtomic(library, text, 0o600, { prepare })
      expect(attribute(library)).toBe(BACKUP_EXCLUDE_VALUE_HEX)
      await expect(readFile(library, 'utf8')).resolves.toBe(text)
    }
    expect(excluded(library)).toBe(true)
    // A folder marked the same way covers what is put in it.
    const folder = join(base, 'personal')
    await mkdir(folder)
    await markExcludedFromBackup(folder)
    await writeFile(join(folder, 'history.v1.seal'), 'sealed')
    expect(excluded(folder)).toBe(true)
    expect(excluded(join(folder, 'history.v1.seal'))).toBe(true)
    // Off again: the next save is not marked (tmutil removes the attribute from the file it finds).
    await rm(intentPath)
    execFileSync('/usr/bin/xattr', ['-d', BACKUP_EXCLUDE_ATTRIBUTE, library])
    await writeFileAtomic(library, 'five', 0o600, { prepare })
    expect(attribute(library)).toBe('')
    expect(excluded(library)).toBe(false)
  }, 60_000)

  it('treats malformed persisted intent as unknown', async () => {
    const base = await makeRoot()
    const intentPath = join(base, 'backup-exclusion.json')
    await writeFile(intentPath, '{invalid')
    expect(readBackupExclusionIntent(intentPath)).toBeNull()
    await expect(readFile(intentPath, 'utf8')).resolves.toBe('{invalid')
  })
})
