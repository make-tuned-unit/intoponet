import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARTITION,
  PRIVATE_PARTITION,
  identityScope,
  pagePartition,
  partitionWorkspaceId,
  scopeWorkspaceId,
  signInsChange,
  workspacePartition,
  workspacePermissionsFile,
} from './workspaceIdentity'

describe('pagePartition', () => {
  it('shares the default partition unless a workspace opts in', () => {
    expect(pagePartition(undefined, false)).toBe(DEFAULT_PARTITION)
    expect(pagePartition({ id: 'work' }, false)).toBe(DEFAULT_PARTITION)
    expect(pagePartition({ id: 'work', separateSignIns: false }, false)).toBe(DEFAULT_PARTITION)
  })

  it('gives an opted-in workspace its own persist: partition', () => {
    expect(pagePartition({ id: 'work', separateSignIns: true }, false)).toBe('persist:intoponet-ws-work')
    expect(pagePartition({ id: 'a1B-2', separateSignIns: true }, false)).toBe('persist:intoponet-ws-a1B-2')
  })

  it('never separates Main, which is the shared identity', () => {
    expect(pagePartition({ id: 'main', separateSignIns: true }, false)).toBe(DEFAULT_PARTITION)
  })

  it('always gives private tabs the private partition', () => {
    expect(pagePartition({ id: 'work', separateSignIns: true }, true)).toBe(PRIVATE_PARTITION)
    expect(pagePartition(null, true)).toBe(PRIVATE_PARTITION)
  })

  it('refuses an id that cannot name a partition instead of sharing silently', () => {
    expect(() => pagePartition({ id: 'bad id/../x', separateSignIns: true }, false)).toThrow()
    expect(() => workspacePartition('')).toThrow()
    expect(() => workspacePartition('a'.repeat(81))).toThrow()
  })
})

describe('scopes and names', () => {
  it('maps partitions to permission scopes', () => {
    expect(identityScope(PRIVATE_PARTITION)).toBe('private')
    expect(identityScope(DEFAULT_PARTITION)).toBe('default')
    expect(identityScope('persist:intoponet-ws-work')).toBe('ws:work')
    expect(partitionWorkspaceId('persist:intoponet-ws-work')).toBe('work')
    expect(partitionWorkspaceId(DEFAULT_PARTITION)).toBeNull()
    expect(scopeWorkspaceId('ws:work')).toBe('work')
    expect(scopeWorkspaceId('default')).toBeNull()
  })

  it('names a workspace permissions file by its id', () => {
    expect(workspacePermissionsFile('work')).toBe('site-permissions.ws-work.json')
    expect(() => workspacePermissionsFile('../etc')).toThrow()
  })

  it('says when a move changes the sign-ins', () => {
    expect(signInsChange({ id: 'main' }, { id: 'work', separateSignIns: true })).toBe(true)
    expect(signInsChange({ id: 'work', separateSignIns: true }, { id: 'home' })).toBe(true)
    expect(signInsChange({ id: 'a' }, { id: 'b' })).toBe(false)
    expect(signInsChange({ id: 'a', separateSignIns: true }, { id: 'b', separateSignIns: true })).toBe(true)
  })
})
