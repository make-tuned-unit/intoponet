import { describe, expect, it } from 'vitest'
import { passwordOrigin, sameLoginSite } from './origin'

describe('passwordOrigin', () => {
  it('keeps scheme, host and port of https pages', () => {
    expect(passwordOrigin('https://accounts.example.com/signin?next=/')).toBe('https://accounts.example.com')
    expect(passwordOrigin('https://example.com:8443/a')).toBe('https://example.com:8443')
  })

  it('allows plain http only on this Mac', () => {
    expect(passwordOrigin('http://localhost:4100/login')).toBe('http://localhost:4100')
    expect(passwordOrigin('http://127.0.0.1/login')).toBe('http://127.0.0.1')
    expect(passwordOrigin('http://example.com/login')).toBeNull()
    expect(passwordOrigin('http://localhost.evil.com/login')).toBeNull()
  })

  it('refuses other schemes, bare hosts, credentials in the address and nonsense', () => {
    for (const url of ['file:///etc/passwd', 'data:text/html,x', 'about:blank', 'https://intranet/login', 'https://u:p@example.com/', 'not a url', '']) {
      expect(passwordOrigin(url), url).toBeNull()
    }
  })
})

describe('sameLoginSite', () => {
  it('treats www. and the bare domain as the same site', () => {
    expect(sameLoginSite('https://www.example.com', 'https://example.com')).toBe(true)
    expect(sameLoginSite('https://EXAMPLE.com', 'https://www.example.com')).toBe(true)
  })

  it('keeps other subdomains, schemes and ports apart', () => {
    expect(sameLoginSite('https://mail.example.com', 'https://example.com')).toBe(false)
    expect(sameLoginSite('http://localhost', 'https://localhost')).toBe(false)
    expect(sameLoginSite('https://example.com', 'https://example.com:444')).toBe(false)
    expect(sameLoginSite('https://example.com.evil.net', 'https://example.com')).toBe(false)
  })
})
