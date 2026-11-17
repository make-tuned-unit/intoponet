import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, watch as fsWatch, renameSync, rmSync, writeFileSync, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname } from 'node:path'
import { promisify } from 'node:util'

const runExecFile = promisify(execFile)
const TMUTIL = '/usr/bin/tmutil'
const operationQueues = new Map<string, Promise<void>>()

export type BackupExclusionAdapter = {
  platform: string
  available: boolean
  exists: (path: string) => boolean
  run: (args: string[]) => Promise<{ stdout: string }>
}

/**
 * How long one tmutil call may take: time for every path it names. tmutil handles its paths one after another
 * and can take over ten seconds for each (11 s each was measured on a busy Mac). With one fixed ten-second limit
 * it was stopped part-way: the switch reported a failure and the paths it had not reached (history, last in
 * the list) stayed in backups.
 */
export function tmutilTimeoutMs(args: string[]): number {
  return Math.max(1, args.length - 1) * 30_000
}

const systemAdapter: BackupExclusionAdapter = {
  platform: process.platform,
  available: existsSync(TMUTIL),
  exists: existsSync,
  run: async (args) => runExecFile(TMUTIL, args, { timeout: tmutilTimeoutMs(args) }),
}

/** A missing intent file means the user has not enabled the exclusion. */
export function readBackupExclusionIntent(path: string): boolean | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null || !('excluded' in raw) || typeof (raw as { excluded?: unknown }).excluded !== 'boolean') return null
    return (raw as { excluded: boolean }).excluded
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    return null
  }
}

export function backupExclusionAvailable(adapter: BackupExclusionAdapter = systemAdapter): boolean {
  return adapter.platform === 'darwin' && adapter.available
}

function enqueueBackupOperation<T>(intentPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationQueues.get(intentPath) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  operationQueues.set(intentPath, tail)
  void tail.then(() => {
    if (operationQueues.get(intentPath) === tail) operationQueues.delete(intentPath)
  })
  return result
}

function writeBackupExclusionIntent(path: string, on: boolean): void {
  if (!on) {
    rmSync(path, { force: true })
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({ excluded: true }), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

function statusRows(stdout: string): Array<'excluded' | 'included'> {
  return stdout.split('\n').map((line) => line.trim()).flatMap((line) => {
    if (line.startsWith('[Excluded]')) return ['excluded']
    if (line.startsWith('[Included]')) return ['included']
    return []
  })
}

/**
 * Time Machine exclusions for the named private stores. The unprivileged
 * sticky form follows existing files/directories. Intent is persisted and
 * reapplied at startup and when one of the top-level stores is created.
 * Fixed-path tmutil exclusions require root and Full Disk Access, so they are
 * deliberately not used by this app-level toggle.
 */
export async function backupExclusionStatus(
  paths: string[],
  intent: boolean | null = false,
  adapter: BackupExclusionAdapter = systemAdapter,
): Promise<boolean | null> {
  if (adapter.platform !== 'darwin' || !adapter.available || intent === null || paths.length === 0) return null
  const existing = paths.filter(adapter.exists)
  if (intent && existing.length !== paths.length) return null
  if (!existing.length) return intent ? null : false
  try {
    const { stdout } = await adapter.run(['isexcluded', ...existing])
    const rows = statusRows(stdout)
    if (rows.length !== existing.length) return null
    if (rows.every((row) => row === 'excluded')) return true
    if (rows.every((row) => row === 'included')) return intent ? null : false
    return null
  } catch {
    return null
  }
}

/** Reapply the stored choice to the paths that exist right now. */
export async function applyBackupExclusion(
  paths: string[],
  on: boolean,
  adapter: BackupExclusionAdapter = systemAdapter,
): Promise<void> {
  if (adapter.platform !== 'darwin' || !adapter.available) return
  const existing = paths.filter(adapter.exists)
  if (!existing.length) return
  if (on) {
    await adapter.run(['addexclusion', ...existing])
    return
  }
  await adapter.run(['removeexclusion', ...existing])
}

export async function setBackupExclusion(
  paths: string[],
  on: boolean,
  intentPath: string,
  adapter: BackupExclusionAdapter = systemAdapter,
): Promise<void> {
  if (!backupExclusionAvailable(adapter)) return
  await enqueueBackupOperation(intentPath, async () => {
    writeBackupExclusionIntent(intentPath, on)
    await applyBackupExclusion(paths, on, adapter).catch((error) => {
      throw new Error(`The Time Machine exclusion could not be ${on ? 'applied' : 'removed'}.`, { cause: error })
    })

    // Verify the action for every existing path. Missing future paths remain
    // explicitly unknown in the UI until they are created and excluded.
    const existing = paths.filter(adapter.exists)
    if (!existing.length) return
    const status = await backupExclusionStatus(existing, false, adapter)
    if (status !== on) throw new Error(`The Time Machine exclusion could not be verified as ${on ? 'enabled' : 'disabled'}.`)
  })
}

export type BackupExclusionWatchAdapter = BackupExclusionAdapter & {
  watchDirectory?: (path: string, listener: (event: 'rename' | 'change', filename: string | null) => void) => FSWatcher
}

/** Keep the persisted sticky exclusion applied when a store is later created. */
export function watchBackupExclusionPaths(
  userDataPath: string,
  paths: string[],
  intentPath: string,
  onStateChanged: () => void = () => undefined,
  adapter: BackupExclusionWatchAdapter = {
    ...systemAdapter,
    watchDirectory: (path, listener) => fsWatch(path, (event, filename) => listener(event, filename?.toString() ?? null)),
  },
): () => void {
  if (adapter.platform !== 'darwin' || !adapter.available) return () => undefined
  const targetNames = new Set(paths.map((path) => basename(path)))
  let pending = false
  let disposed = false
  let watcherStopped = false
  let watcherClosed = false
  let timer: NodeJS.Timeout | null = null
  let watcher: FSWatcher | null = null
  const closeWatcher = (): void => {
    if (watcherClosed) return
    watcherClosed = true
    watcher?.close()
  }
  const dispose = (): void => {
    disposed = true
    watcherStopped = true
    cancelPendingTimer()
    closeWatcher()
  }
  const cancelPendingTimer = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = false
  }
  // One reapply waiting at most: every save of the library asks for one, and tmutil can take many seconds, so
  // without this a busy hour would queue reapplies faster than they finish (and switching it off would wait behind them).
  let reapplyWaiting = false
  const reapplyCurrentIntent = (): void => {
    if (reapplyWaiting) return
    reapplyWaiting = true
    void enqueueBackupOperation(intentPath, async () => {
      reapplyWaiting = false
      if (disposed) return
      if (readBackupExclusionIntent(intentPath) === true) await applyBackupExclusion(paths, true, adapter)
    }).then(() => { if (!disposed) onStateChanged() }, () => { if (!disposed) onStateChanged() })
  }
  reapplyCurrentIntent()
  const onWatcherError = (): void => {
    if (watcherStopped || disposed) return
    watcherStopped = true
    cancelPendingTimer()
    closeWatcher()
    onStateChanged()
  }
  try {
    watcher = adapter.watchDirectory!(userDataPath, (event, filename) => {
      if (disposed || watcherStopped || event !== 'rename' || !filename || !targetNames.has(filename) || pending) return
      pending = true
      timer = setTimeout(() => {
        timer = null
        pending = false
        if (!disposed && !watcherStopped) reapplyCurrentIntent()
      }, 100).unref?.()
    })
    watcher.on('error', onWatcherError)
  } catch {
    watcherStopped = true
    cancelPendingTimer()
    onStateChanged()
    return dispose
  }
  return dispose
}
