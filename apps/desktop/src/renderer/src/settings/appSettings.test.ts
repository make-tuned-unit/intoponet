import { describe, expect, it } from 'vitest'
import { autoTranslatePlan, isNeverTranslated, parseAppSettings, parseHeadlinePref, siteKey, withNeverTranslate } from './appSettings'

const base = {
  enabled: true,
  detected: 'ru' as string | null,
  target: 'en',
  supported: (code: string | null) => !!code && ['en', 'ru', 'es', 'de'].includes(code),
  ready: new Set(['en', 'ru']),
  alreadyTried: false,
}

describe('auto-translate plan', () => {
  it('translates a page in another language when the models are ready', () => {
    expect(autoTranslatePlan(base)).toEqual({ from: 'ru', to: 'en', missing: [] })
  })
  it('lists models still to download (they download automatically), your language first', () => {
    expect(autoTranslatePlan({ ...base, detected: 'es' })).toEqual({ from: 'es', to: 'en', missing: ['es'] })
    expect(autoTranslatePlan({ ...base, detected: 'es', target: 'de' })).toEqual({ from: 'es', to: 'de', missing: ['de', 'es'] })
  })
  it('does nothing when off, on a never-translate site, already in your language, unknown, unsupported, or already tried (Original sticks)', () => {
    expect(autoTranslatePlan({ ...base, enabled: false })).toBeNull()
    expect(autoTranslatePlan({ ...base, blocked: true })).toBeNull()
    expect(autoTranslatePlan({ ...base, detected: 'en' })).toBeNull()
    expect(autoTranslatePlan({ ...base, detected: null })).toBeNull()
    expect(autoTranslatePlan({ ...base, detected: 'pap' })).toBeNull()
    expect(autoTranslatePlan({ ...base, alreadyTried: true })).toBeNull()
  })
})

describe('settings parsing', () => {
  it('defaults to automatic translation and ignores junk', () => {
    expect(parseAppSettings(null)).toEqual({ autoTranslate: true, neverTranslate: [] })
    expect(parseAppSettings('not json')).toEqual({ autoTranslate: true, neverTranslate: [] })
    expect(parseAppSettings('{"autoTranslate":"yes"}')).toEqual({ autoTranslate: true, neverTranslate: [] })
    expect(parseAppSettings('{"autoTranslate":false}')).toEqual({ autoTranslate: false, neverTranslate: [] })
    expect(parseAppSettings('{"neverTranslate":["lemonde.fr","lemonde.fr",3,"<script>",".x"]}')).toEqual({ autoTranslate: true, neverTranslate: ['lemonde.fr'] })
  })
  it('turns headline translation on by default; only an explicit Original turns it off', () => {
    expect(parseHeadlinePref(null)).toBe(true)
    expect(parseHeadlinePref('1')).toBe(true)
    expect(parseHeadlinePref('0')).toBe(false)
  })
})

describe('never translate a site', () => {
  it('keys sites by host without www, web pages only', () => {
    expect(siteKey('https://www.LeMonde.fr/international/article')).toBe('lemonde.fr')
    expect(siteKey('http://news.example.com/')).toBe('news.example.com')
    expect(siteKey('file:///Users/me/a.html')).toBeNull()
    expect(siteKey('not a url')).toBeNull()
  })
  it('covers the site and its subdomains, not look-alikes', () => {
    const sites = ['example.com']
    expect(isNeverTranslated('https://example.com/a', sites)).toBe(true)
    expect(isNeverTranslated('https://www.example.com/a', sites)).toBe(true)
    expect(isNeverTranslated('https://news.example.com/a', sites)).toBe(true)
    expect(isNeverTranslated('https://badexample.com/a', sites)).toBe(false)
    expect(isNeverTranslated('https://example.org/a', sites)).toBe(false)
  })
  it('adds and removes sites without duplicates', () => {
    const settings = { autoTranslate: true, neverTranslate: ['a.com'] }
    expect(withNeverTranslate(settings, 'b.com', true).neverTranslate).toEqual(['b.com', 'a.com'])
    expect(withNeverTranslate(settings, 'a.com', true).neverTranslate).toEqual(['a.com'])
    expect(withNeverTranslate(settings, 'a.com', false).neverTranslate).toEqual([])
  })
})
