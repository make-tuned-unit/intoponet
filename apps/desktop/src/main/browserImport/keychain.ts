import { execFile } from 'node:child_process'
import type { BrowserSource } from './sources'

export type SecretResult = { ok: true; secret: string } | { ok: false; reason: string }

export type RunSecurity = (args: string[]) => Promise<string>

const runSecurity: RunSecurity = (args) => new Promise((resolve, reject) => {
  // Waits for the person to answer the Keychain prompt.
  execFile('/usr/bin/security', args, { timeout: 180_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
    if (error) reject(new Error('denied'))
    else resolve(stdout)
  })
})

/**
 * The browser's "… Safe Storage" secret from the login Keychain. macOS shows its own prompt
 * ("Intoponet wants to use your confidential information stored in “Chrome Safe Storage”"),
 * and the secret is only read when the person allows it. With fixture profiles (tests), the
 * test key stands in and the real Keychain is never asked.
 */
export async function safeStorageSecret(source: BrowserSource, testing: boolean, env: NodeJS.ProcessEnv = process.env, run: RunSecurity = runSecurity): Promise<SecretResult> {
  if (testing) {
    const key = env['INTOPONET_IMPORT_TEST_KEY']
    return key ? { ok: true, secret: key } : { ok: false, reason: 'No test key was given for the fixture profile.' }
  }
  if (process.platform !== 'darwin') return { ok: false, reason: 'Passwords can be imported on a Mac only.' }
  try {
    const secret = (await run(['find-generic-password', '-w', '-s', source.keychain.service, '-a', source.keychain.account])).replace(/\n$/, '')
    return secret ? { ok: true, secret } : { ok: false, reason: `The Keychain has no “${source.keychain.service}” key.` }
  } catch {
    return { ok: false, reason: `Keychain access to “${source.keychain.service}” was not allowed, so no passwords were read.` }
  }
}
