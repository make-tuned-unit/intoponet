import { describe, expect, it } from 'vitest'
import { CertificateErrorMemo, classifyLoadError, netErrorName, showsErrorPage, summarizeCertificate } from './errorPage'

const url = 'https://news.example/story'
const classify = (code: number, online = true, description = '') => classifyLoadError({ code, url, online, description })

describe('error page classification', () => {
  it('names offline failures and retries them by itself', () => {
    const offline = classify(-106)
    expect(offline).toMatchObject({ kind: 'offline', title: 'No internet connection', autoRetry: true, codeName: 'ERR_INTERNET_DISCONNECTED' })
    // Lookups and timeouts while the Mac is offline are really "offline".
    expect(classify(-105, false).kind).toBe('offline')
    expect(classify(-118, false).kind).toBe('offline')
  })

  it('explains each kind of failure', () => {
    expect(classify(-105)).toMatchObject({ kind: 'not-found', title: 'Can’t find news.example', autoRetry: false })
    expect(classify(-137).kind).toBe('not-found')
    expect(classify(-118)).toMatchObject({ kind: 'timeout', title: 'news.example took too long to respond' })
    expect(classify(-7).kind).toBe('timeout')
    expect(classify(-102)).toMatchObject({ kind: 'refused', title: 'news.example refused to connect' })
    expect(classify(-101).kind).toBe('unreachable')
    expect(classify(-107).kind).toBe('insecure')
    expect(classify(-310).kind).toBe('redirects')
    expect(classify(-20).kind).toBe('blocked')
    expect(classify(-999, true, 'net::ERR_SOMETHING_NEW')).toMatchObject({ kind: 'other', codeName: 'ERR_SOMETHING_NEW' })
  })

  it('says a certificate problem plainly, with the certificate', () => {
    const certificate = summarizeCertificate({ subjectName: 'news.example', issuerName: 'Untrusted CA', validStart: 1_700_000_000, validExpiry: 1_710_000_000, fingerprint: 'sha256/abc' }, 'net::ERR_CERT_DATE_INVALID')
    const error = classifyLoadError({ code: -201, url, online: true, ...(certificate ? { certificate } : {}) })
    expect(error).toMatchObject({ kind: 'certificate', title: 'Connection not secure', codeName: 'ERR_CERT_DATE_INVALID' })
    expect(error.detail).toMatch(/expired/)
    expect(error.certificate).toMatchObject({ subject: 'news.example', issuer: 'Untrusted CA', validFrom: '2023-11-14T22:13:20.000Z', error: 'net::ERR_CERT_DATE_INVALID' })
    expect(classify(-202).detail).toMatch(/not from an authority/)
    // Certificate errors stay certificate errors offline.
    expect(classify(-200, false).kind).toBe('certificate')
  })

  it('shows the error page only for real failures of web pages and opened files', () => {
    expect(showsErrorPage(-3, url)).toBe(false)
    expect(showsErrorPage(0, url)).toBe(false)
    expect(showsErrorPage(-102, url)).toBe(true)
    expect(showsErrorPage(-6, 'file:///Users/me/page.html')).toBe(true)
    expect(showsErrorPage(-301, 'javascript:alert(1)')).toBe(false)
  })

  it('names codes', () => {
    expect(netErrorName(-105)).toBe('ERR_NAME_NOT_RESOLVED')
    expect(netErrorName(-12345)).toBe('ERR_12345')
  })
})

describe('certificate details for the failed load', () => {
  it('hands the certificate to the matching failure once, and forgets stale ones', () => {
    let now = 0
    const memo = new CertificateErrorMemo(() => now, 1_000)
    const summary = summarizeCertificate({ subjectName: 'a' }, 'net::ERR_CERT_AUTHORITY_INVALID')
    memo.remember(1, url, summary)
    expect(memo.take(2, url)).toBeUndefined()
    expect(memo.take(1, url)?.subject).toBe('a')
    expect(memo.take(1, url)).toBeUndefined()
    memo.remember(1, 'https://redirected.example/', summary)
    expect(memo.take(1, url)?.subject).toBe('a')
    memo.remember(1, url, summary)
    now = 5_000
    expect(memo.take(1, url)).toBeUndefined()
  })
})
