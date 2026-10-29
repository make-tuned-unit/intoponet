import { describe, expect, it } from 'vitest'
import { CrashRecoveryPolicy } from './crashRecovery'

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
})
