import { describe, expect, it } from 'vitest'
import { applyNetworkPrivacy, networkPrivacySnapshot, WEBRTC_POLICY } from './networkPrivacy'

describe('network privacy for every web contents', () => {
  it('keeps WebRTC to the default public route, as the Privacy panel says', () => {
    const set: string[] = []
    applyNetworkPrivacy({ setWebRTCIPHandlingPolicy: (policy) => { set.push(policy) } })
    expect(set).toEqual([WEBRTC_POLICY])
    expect(WEBRTC_POLICY).toBe('default_public_interface_only')
    expect(networkPrivacySnapshot(true).webrtcLocalIpHidden).toBe(true)
  })

  it('does not throw for contents that went away while being made', () => {
    expect(() => applyNetworkPrivacy({ setWebRTCIPHandlingPolicy: () => { throw new Error('Object has been destroyed') } })).not.toThrow()
  })
})
