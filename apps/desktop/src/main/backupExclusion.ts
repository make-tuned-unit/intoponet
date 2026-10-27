import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)
const TMUTIL = '/usr/bin/tmutil'

/**
 * Time Machine exclusion for the private stores (PRD §8.4: "options for
 * excluding local knowledge stores from cloud backups where feasible").
 * Uses macOS's sticky per-item exclusion (`tmutil addexclusion`, no admin
 * rights needed). On other platforms this reports null and does nothing.
 */
export async function backupExclusionStatus(paths: string[]): Promise<boolean | null> {
  if (process.platform !== 'darwin' || !existsSync(TMUTIL)) return null
  const existing = paths.filter((path) => existsSync(path))
  if (!existing.length) return null
  try {
    const { stdout } = await run(TMUTIL, ['isexcluded', ...existing], { timeout: 5_000 })
    const lines = stdout.split('\n').filter((line) => line.trim())
    return lines.length > 0 && lines.every((line) => line.includes('[Excluded]'))
  } catch {
    return null
  }
}

export async function setBackupExclusion(paths: string[], on: boolean): Promise<void> {
  if (process.platform !== 'darwin' || !existsSync(TMUTIL)) return
  const existing = paths.filter((path) => existsSync(path))
  if (!existing.length) return
  await run(TMUTIL, [on ? 'addexclusion' : 'removeexclusion', ...existing], { timeout: 10_000 }).catch(() => undefined)
}
