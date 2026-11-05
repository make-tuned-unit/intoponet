import { describe, expect, it } from 'vitest'
import { credentialsFrom, fillTargets, identifierFrom, isCodeOrCard, looksLikeSignInButton, type FieldInfo } from './loginForm'

const field = (overrides: Partial<FieldInfo>): FieldInfo => ({
  type: 'text', name: '', id: '', autocomplete: '', placeholder: '', label: '', value: '', visible: true, locked: false, ...overrides,
})

describe('credentialsFrom', () => {
  it('reads a plain sign-in form', () => {
    expect(credentialsFrom([
      field({ type: 'email', name: 'email', value: ' ada@example.com ' }),
      field({ type: 'password', name: 'password', value: 'hunter2' }),
      field({ type: 'checkbox', name: 'remember', value: 'on' }),
    ])).toEqual({ username: 'ada@example.com', password: 'hunter2' })
  })

  it('prefers a declared username over a nearer plain text field', () => {
    expect(credentialsFrom([
      field({ name: 'login', autocomplete: 'username', value: 'ada' }),
      field({ name: 'company', value: 'Analytical Engines' }),
      field({ type: 'password', value: 'pw' }),
    ])?.username).toBe('ada')
  })

  it('ignores search boxes and accepts a hidden username field', () => {
    expect(credentialsFrom([
      field({ type: 'search', name: 'q', value: 'cats' }),
      field({ type: 'hidden', autocomplete: 'username', value: 'ada', visible: false }),
      field({ type: 'password', value: 'pw' }),
    ])?.username).toBe('ada')
  })

  it('keeps the new password on sign-up and change-password forms', () => {
    expect(credentialsFrom([
      field({ name: 'user', value: 'ada' }),
      field({ type: 'password', autocomplete: 'new-password', value: 'fresh' }),
      field({ type: 'password', name: 'confirm', value: 'fresh' }),
    ])?.password).toBe('fresh')
    expect(credentialsFrom([
      field({ name: 'user', value: 'ada' }),
      field({ type: 'password', name: 'current', value: 'old' }),
      field({ type: 'password', name: 'next', value: 'new' }),
      field({ type: 'password', name: 'again', value: 'new' }),
    ])?.password).toBe('new')
  })

  it('never takes one-time codes, card numbers, card codes or PINs', () => {
    expect(credentialsFrom([field({ type: 'password', autocomplete: 'one-time-code', value: '123456' })])).toBeNull()
    expect(credentialsFrom([field({ type: 'password', name: 'cvv', value: '123' })])).toBeNull()
    expect(credentialsFrom([field({ type: 'password', name: 'cardPin', value: '1234' })])).toBeNull()
    expect(credentialsFrom([field({ type: 'password', label: 'Verification code', value: '99' })])).toBeNull()
    expect(credentialsFrom([
      field({ name: 'cardNumber', autocomplete: 'cc-number', value: '4111111111111111' }),
      field({ type: 'password', name: 'password', value: 'pw' }),
    ])).toEqual({ username: '', password: 'pw' })
  })

  it('needs a filled password field (text fields are never taken as passwords)', () => {
    expect(credentialsFrom([field({ name: 'password', value: 'visible text' })])).toBeNull()
    expect(credentialsFrom([field({ name: 'user', value: 'ada' }), field({ type: 'password', value: '' })])).toBeNull()
    expect(credentialsFrom([field({ type: 'password', value: 'pw', locked: true })])).toBeNull()
  })
})

describe('identifierFrom', () => {
  it('reads the username on the first step of a two-step sign-in', () => {
    expect(identifierFrom([field({ type: 'email', value: 'ada@example.com' })])).toBe('ada@example.com')
    expect(identifierFrom([field({ name: 'identifier', value: 'ada' }), field({ type: 'hidden', value: 'x', visible: false })])).toBe('ada')
  })

  it('ignores ordinary forms', () => {
    expect(identifierFrom([field({ name: 'comment', value: 'hello' })])).toBeNull()
    expect(identifierFrom([field({ type: 'email', value: 'a@b.c' }), field({ name: 'name', value: 'Ada' })])).toBeNull()
    expect(identifierFrom([field({ type: 'email', value: 'a@b.c' }), field({ type: 'password', value: '' })])).toBeNull()
  })
})

describe('fillTargets', () => {
  it('finds the username and password fields to fill', () => {
    expect(fillTargets([
      field({ type: 'search', name: 'q' }),
      field({ type: 'email', name: 'email' }),
      field({ type: 'password', name: 'password' }),
    ])).toEqual({ username: 1, password: 2 })
  })

  it('skips hidden and new-password fields, and forms with no password', () => {
    expect(fillTargets([field({ type: 'password', visible: false }), field({ type: 'password' })])).toEqual({ username: null, password: 1 })
    expect(fillTargets([field({ name: 'user' }), field({ type: 'password', autocomplete: 'new-password' })])).toBeNull()
    expect(fillTargets([field({ name: 'user' })])).toBeNull()
    expect(fillTargets([field({ type: 'password', autocomplete: 'one-time-code' })])).toBeNull()
  })
})

describe('isCodeOrCard and looksLikeSignInButton', () => {
  it('leaves ordinary password fields alone', () => {
    expect(isCodeOrCard(field({ type: 'password', name: 'passcode' }))).toBe(false)
    expect(isCodeOrCard(field({ type: 'password', name: 'user_password' }))).toBe(false)
    expect(isCodeOrCard(field({ type: 'password', name: 'spinner' }))).toBe(false)
  })

  it('recognises sign-in buttons', () => {
    expect(looksLikeSignInButton('Sign in', 'button')).toBe(true)
    expect(looksLikeSignInButton('  Log In ', '')).toBe(true)
    expect(looksLikeSignInButton('Forgot password?', 'button')).toBe(false)
    expect(looksLikeSignInButton('anything', 'submit')).toBe(true)
  })
})
