import { isIP } from 'node:net'

/**
 * Addresses that are not on the public internet: loopback, private ranges, link-local,
 * carrier-grade NAT, documentation and multicast. Shared by the feed fetcher and article
 * previews so network requests made by the main process cannot be steered at this Mac
 * or the local network.
 */
export function privateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  const [a = 0, b = 0, c = 0] = octets
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // Only 192.0.0.0/24 (IETF) and 192.0.2.0/24 (TEST-NET-1) are reserved;
    // the rest of 192.0.0.0/16 is ordinary public space (e.g. WordPress VIP).
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && b !== undefined && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function privateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  let words: number[]
  try {
    const withoutIpv4 = normalized.includes('.')
      ? normalized.replace(/(\d+\.\d+\.\d+\.\d+)$/, (_match, ipv4: string) => {
          const octets = ipv4.split('.').map(Number)
          if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) throw new Error()
          return `${((octets[0] ?? 0) << 8 | (octets[1] ?? 0)).toString(16)}:${((octets[2] ?? 0) << 8 | (octets[3] ?? 0)).toString(16)}`
        })
      : normalized
    const halves = withoutIpv4.split('::')
    if (halves.length > 2) return true
    const left = halves[0] ? halves[0].split(':') : []
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
    const missing = 8 - left.length - right.length
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return true
    words = [...left, ...Array(missing).fill('0'), ...right].map((word) => {
      if (!/^[\da-f]{1,4}$/i.test(word)) throw new Error()
      return Number.parseInt(word, 16)
    })
    if (words.length !== 8) return true
  } catch {
    return true
  }
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return true
  if ((words[0]! & 0xfe00) === 0xfc00 || (words[0]! & 0xffc0) === 0xfe80 ||
      (words[0]! & 0xff00) === 0xff00 || (words[0] === 0x2001 && words[1] === 0x0db8)) return true
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const mapped = `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`
    return privateIpv4(mapped)
  }
  return false
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return privateIpv4(address)
  if (version === 6) return privateIpv6(address)
  return true
}
