import { describe, expect, it } from 'vitest'
import { CrashRecoveryPolicy, ShellReloadPolicy } from './crashRecovery'

describe('CrashRecoveryPolicy', () => {
  it('allows one automatic reload, then pauses until the user retries', () => {
    const policy = new CrashRecoveryPolicy()
    expect(policy.recordCrash('tab-a', 1_000)).toBe(true)
    expect(policy.canAutoRecover('tab-a')).toBe(true)
    expect(policy.recordCrash('tab-a', 2_000)).toBe(false)
    expect(policy.canAutoRecover('tab-a')).toBe(false)
    expect(policy.canAutoRecover('tab-a')).toBe(false)

    policy.manualRetry('tab-a')
    expect(policy.canAutoRecover('tab-a')).toBe(true)
    expect(policy.recordCrash('tab-a', 3_000)).toBe(true)
  })

  it('allows another auto-recovery if the previous crash is outside the window', () => {
    const policy = new CrashRecoveryPolicy(60_000)
    expect(policy.recordCrash('tab-a', 1_000)).toBe(true)
    expect(policy.recordCrash('tab-a', 62_001)).toBe(true)
    expect(policy.canAutoRecover('tab-a')).toBe(true)
  })

  it('keeps a repeated-crash pause latched past the window until manual retry', () => {
    const policy = new CrashRecoveryPolicy(60_000)
    expect(policy.recordCrash('tab-a', 1_000)).toBe(true)
    expect(policy.recordCrash('tab-a', 2_000)).toBe(false)
    expect(policy.canAutoRecover('tab-a')).toBe(false)
    expect(policy.recordCrash('tab-a', 62_001)).toBe(false)
    expect(policy.canAutoRecover('tab-a')).toBe(false)
    policy.manualRetry('tab-a')
    expect(policy.canAutoRecover('tab-a')).toBe(true)
  })

  it('forgets crash state when a tab is discarded', () => {
    const policy = new CrashRecoveryPolicy()
    policy.recordCrash('tab-a', 1_000)
    policy.recordCrash('tab-a', 2_000)
    policy.forget('tab-a')
    expect(policy.canAutoRecover('tab-a')).toBe(true)
    expect(policy.recordCrash('tab-a', 3_000)).toBe(true)
  })

  it('keeps the crashed page\'s history through the pause, hands it out once, and forgets it with the tab', () => {
    const policy = new CrashRecoveryPolicy<{ entries: string[]; index: number }>()
    const history = { entries: ['https://a.example/', 'https://a.example/2'], index: 1 }
    policy.recordCrash('tab-a', 1_000)
    policy.keepHistory('tab-a', history)
    policy.recordCrash('tab-a', 2_000)
    expect(policy.canAutoRecover('tab-a')).toBe(false)
    // Reload after the pause still brings the list back.
    policy.manualRetry('tab-a')
    expect(policy.takeHistory('tab-a')).toEqual(history)
    expect(policy.takeHistory('tab-a')).toBeUndefined()
    // A crash whose list could not be read leaves none behind from an earlier crash.
    policy.keepHistory('tab-a', history)
    policy.keepHistory('tab-a', undefined)
    expect(policy.takeHistory('tab-a')).toBeUndefined()
    policy.keepHistory('tab-b', history)
    policy.forget('tab-b')
    expect(policy.takeHistory('tab-b')).toBeUndefined()
  })

  it('lets a tab closed while still blank read the kept list without using it up', () => {
    const policy = new CrashRecoveryPolicy<{ entries: string[]; index: number }>()
    const history = { entries: ['https://a.example/', 'https://a.example/2'], index: 1 }
    expect(policy.keptHistory('tab-a')).toBeUndefined()
    policy.recordCrash('tab-a', 1_000)
    policy.keepHistory('tab-a', history)
    expect(policy.keptHistory('tab-a')).toEqual(history)
    // Still there for the page loading again (an archive that failed leaves the tab as it was).
    expect(policy.takeHistory('tab-a')).toEqual(history)
    expect(policy.keptHistory('tab-a')).toBeUndefined()
  })
})

describe('ShellReloadPolicy', () => {
  it('reloads the app window at once, then waits longer while it keeps crashing', () => {
    const policy = new ShellReloadPolicy(60_000, 30_000)
    expect(policy.crashed(1_000)).toBe(0)
    expect(policy.crashed(2_000)).toBe(1_000)
    expect(policy.crashed(3_000)).toBe(2_000)
    expect(policy.crashed(4_000)).toBe(4_000)
    for (let at = 5_000; at < 12_000; at += 1_000) policy.crashed(at)
    expect(policy.crashed(13_000)).toBe(30_000)
  })

  it('never stops reloading, and starts over once a minute passes without a crash', () => {
    const policy = new ShellReloadPolicy(60_000)
    policy.crashed(0)
    policy.crashed(1_000)
    expect(policy.crashed(2_000)).toBeGreaterThan(0)
    expect(policy.crashed(70_000)).toBe(0)
  })
})
