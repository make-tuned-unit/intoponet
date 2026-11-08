import type { NetworkPrivacySnapshot } from '@intoponet/browser-api'
import type { WebContents } from 'electron'

/**
 * Network privacy defaults (no VPN tunnel yet):
 *  - DNS-over-HTTPS through privacy-focused, non-logging resolvers, so the
 *    local network and ISP cannot read or alter hostname lookups. Automatic
 *    mode falls back to the system resolver if both are unreachable (e.g.
 *    captive portals) rather than breaking connectivity.
 *  - WebRTC limited to the default public interface, so pages cannot
 *    enumerate local/private IP addresses. Without a VPN the public IP is
 *    still visible to sites; the UI says so.
 */
export const ENCRYPTED_DNS = {
  mode: 'automatic' as const,
  servers: ['https://dns.quad9.net/dns-query', 'https://dns.mullvad.net/dns-query'],
  label: 'Quad9 · Mullvad',
}

export const WEBRTC_POLICY = 'default_public_interface_only' as const

/**
 * The per-page part of the above, for every web contents as it is made (app 'web-contents-created'):
 * tabs, popups a page opens, quick windows, link previews. A popup otherwise ran with Chromium's
 * default and could list every network route while the Privacy panel said local addresses were hidden.
 */
export function applyNetworkPrivacy(contents: Pick<WebContents, 'setWebRTCIPHandlingPolicy'>): void {
  try {
    contents.setWebRTCIPHandlingPolicy(WEBRTC_POLICY)
  } catch {
    // Already gone.
  }
}

export function networkPrivacySnapshot(encryptedDnsActive: boolean): NetworkPrivacySnapshot {
  return {
    encryptedDns: encryptedDnsActive,
    dnsProviders: ENCRYPTED_DNS.label,
    webrtcLocalIpHidden: true,
    vpn: 'not-configured',
  }
}
