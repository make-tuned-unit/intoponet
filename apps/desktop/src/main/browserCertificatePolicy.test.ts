import { describe, expect, it, vi } from 'vitest'
import { rejectCertificateErrorForSession } from './browserCertificatePolicy'

describe('certificate error policy', () => {
  it('prevents the default and rejects the certificate for the target session', () => {
    const browsingSession = {}
    const event = { preventDefault: vi.fn() }
    const callback = vi.fn()
    expect(rejectCertificateErrorForSession(event, { session: browsingSession }, browsingSession, callback)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledWith(false)
  })

  it('leaves certificate errors from other sessions to their own handler', () => {
    const event = { preventDefault: vi.fn() }
    const callback = vi.fn()
    expect(rejectCertificateErrorForSession(event, { session: {} }, {}, callback)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })
})
