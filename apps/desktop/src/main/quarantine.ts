import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/**
 * macOS quarantine for downloaded files. Gatekeeper checks a quarantined file the first time it is
 * opened (and refuses unsigned apps and scripts from the internet). Chromium's own quarantine step
 * is not wired up in Electron, so finished downloads are flagged here unless a flag is already set.
 */
export const QUARANTINE_ATTRIBUTE = 'com.apple.quarantine'

/** "0083;<hex seconds>;Intoponet;<UUID>" — 0x0083: downloaded, needs Gatekeeper check, user-visible. */
export function quarantineValue(now: number, id: string = randomUUID()): string {
  return `0083;${Math.floor(now / 1000).toString(16)};Intoponet;${id.toUpperCase()}`
}

export type RunFile = (file: string, args: string[]) => Promise<string>

const runFile: RunFile = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5_000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))))
  })

/** Returns what was done: the flag was already there, was added, or this is not a Mac. */
export async function ensureQuarantine(
  path: string,
  options: { platform?: NodeJS.Platform; now?: number; run?: RunFile } = {},
): Promise<'present' | 'added' | 'unsupported'> {
  if ((options.platform ?? process.platform) !== 'darwin') return 'unsupported'
  const run = options.run ?? runFile
  try {
    const existing = await run('/usr/bin/xattr', ['-p', QUARANTINE_ATTRIBUTE, path])
    if (existing.trim()) return 'present'
  } catch {
    // Not set yet.
  }
  // Paths are absolute (they start with "/"), so a filename can never be read as an option.
  if (!path.startsWith('/')) throw new Error('Quarantine needs an absolute path.')
  await run('/usr/bin/xattr', ['-w', QUARANTINE_ATTRIBUTE, quarantineValue(options.now ?? Date.now()), path])
  return 'added'
}
