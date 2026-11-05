import { describe, expect, it } from 'vitest'
import { mayRememberSite } from './learnedPaywalls'

describe('learned paywalls', () => {
  it('never learns from private tabs or left-out sites', () => {
    expect(mayRememberSite('https://news.example.com/a', false, [])).toBe(true)
    expect(mayRememberSite('https://news.example.com/a', true, [])).toBe(false)
    expect(mayRememberSite('https://www.news.example.com/a', false, ['news.example.com'])).toBe(false)
  })
})
