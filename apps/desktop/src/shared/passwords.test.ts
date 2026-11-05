import { describe, expect, it } from 'vitest'
import { parsePasswordCommand } from './passwords'
import { parsePasswordPageMessage } from './passwordPage'

const id = '0b6f2a8e-6f7e-4f0e-9f53-1d2b3c4d5e6f'

describe('parsePasswordCommand', () => {
  it('accepts the shell commands', () => {
    expect(parsePasswordCommand({ type: 'decide', id, decision: 'save' })).toEqual({ type: 'decide', id, decision: 'save' })
    expect(parsePasswordCommand({ type: 'reveal', id, extra: 1 })).toEqual({ type: 'reveal', id })
    expect(parsePasswordCommand({ type: 'remove-never', origin: 'https://example.com' })).toEqual({ type: 'remove-never', origin: 'https://example.com' })
    expect(parsePasswordCommand({ type: 'list' })).toEqual({ type: 'list' })
  })

  it('rejects anything else', () => {
    for (const value of [
      null, 'list', {}, { type: 'export' },
      { type: 'decide', id, decision: 'always' },
      { type: 'reveal', id: '../../etc' },
      { type: 'fill', id: 5 },
      { type: 'remove-never', origin: 'javascript:alert(1)' },
      { type: 'remove-never', origin: 'https://example.com/path' },
    ]) expect(() => parsePasswordCommand(value), JSON.stringify(value)).toThrow()
  })
})

describe('parsePasswordPageMessage', () => {
  it('accepts a sign-in, keeping the password exactly as typed', () => {
    expect(parsePasswordPageMessage({ type: 'submitted', username: ' ada ', password: ' p w ' })).toEqual({ type: 'submitted', username: 'ada', password: ' p w ' })
    expect(parsePasswordPageMessage({ type: 'login-form', origin: 'https://spoofed.example' })).toEqual({ type: 'login-form' })
    expect(parsePasswordPageMessage({ type: 'identifier', username: 'ada@example.com' })).toEqual({ type: 'identifier', username: 'ada@example.com' })
  })

  it('drops empty, oversized, odd and unknown messages', () => {
    for (const value of [
      null, 7, { type: 'submitted', username: 'ada', password: '' },
      { type: 'submitted', username: 'ada' },
      { type: 'submitted', username: 'a'.repeat(300), password: 'pw' },
      { type: 'submitted', username: 'ada', password: 'p'.repeat(600) },
      { type: 'submitted', username: 'ada\n', password: 'pw' },
      { type: 'identifier', username: '   ' },
      { type: 'fill', username: 'ada', password: 'pw' },
    ]) expect(parsePasswordPageMessage(value), JSON.stringify(value)).toBeNull()
  })
})
