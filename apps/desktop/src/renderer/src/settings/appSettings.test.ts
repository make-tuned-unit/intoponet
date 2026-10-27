import { describe, expect, it } from 'vitest'
import { autoTranslatePlan, parseAppSettings } from './appSettings'

const base = {
  enabled: true,
  detected: 'ru' as string | null,
  target: 'en',
  supported: (code: string | null) => !!code && ['en', 'ru', 'es'].includes(code),
  ready: new Set(['en', 'ru']),
  alreadyTried: false,
}

describe('auto-translate plan', () => {
  it('translates a page in another language when the models are ready', () => {
    expect(autoTranslatePlan(base)).toEqual({ from: 'ru', to: 'en', missing: [] })
  })
  it('lists models still to download', () => {
    expect(autoTranslatePlan({ ...base, detected: 'es' })).toEqual({ from: 'es', to: 'en', missing: ['es'] })
  })
  it('does nothing when off, already in your language, unknown, unsupported, or already tried (Original sticks)', () => {
    expect(autoTranslatePlan({ ...base, enabled: false })).toBeNull()
    expect(autoTranslatePlan({ ...base, detected: 'en' })).toBeNull()
    expect(autoTranslatePlan({ ...base, detected: null })).toBeNull()
    expect(autoTranslatePlan({ ...base, detected: 'pap' })).toBeNull()
    expect(autoTranslatePlan({ ...base, alreadyTried: true })).toBeNull()
  })
})

describe('settings parsing', () => {
  it('defaults to off and ignores junk', () => {
    expect(parseAppSettings(null)).toEqual({ autoTranslate: false, autoDownload: false })
    expect(parseAppSettings('{"autoTranslate":"yes"}')).toEqual({ autoTranslate: false, autoDownload: false })
    expect(parseAppSettings('{"autoTranslate":true,"autoDownload":true}')).toEqual({ autoTranslate: true, autoDownload: true })
  })
})
