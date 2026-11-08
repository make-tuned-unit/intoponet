import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARTITION,
  PRIVATE_PARTITION,
  TOUR_PARTITION,
  identitiesOnDisk,
  identityScope,
  leftoverIdentities,
  pagePartition,
  partitionWorkspaceId,
  scopeWorkspaceId,
  signInsChange,
  sweepLeftoverIdentities,
  workspacePartition,
  workspacePartitionFolder,
  workspacePermissionsFile,
  type LeftoverIdentitySweep,
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

  it('keeps the tour\'s page in memory, apart from every other partition, with the shared identity', () => {
    expect(TOUR_PARTITION.startsWith('persist:')).toBe(false)
    expect([DEFAULT_PARTITION, PRIVATE_PARTITION, workspacePartition('tour')]).not.toContain(TOUR_PARTITION)
    expect(partitionWorkspaceId(TOUR_PARTITION)).toBeNull()
    expect(identityScope(TOUR_PARTITION)).toBe('default')
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

describe('leftover sign-ins', () => {
  it('names the partition folder in lower case, as Electron does', () => {
    expect(workspacePartitionFolder('3f1c-AB')).toBe('intoponet-ws-3f1c-ab')
    expect(() => workspacePartitionFolder('../x')).toThrow()
  })

  it('finds workspaces in partition folders and permission files, and nothing else', () => {
    expect(identitiesOnDisk(
      ['intoponet-ws-gone', 'intoponet-ws-Mixed', 'intoponet-default', 'intoponet-ws-', 'intoponet-ws-bad id', 'other'],
      ['site-permissions.ws-off.json', 'site-permissions.json', 'site-permissions.ws-off.json.tmp', 'site-permissions.ws-../x.json', 'browser-state.v1.json'],
    )).toEqual(['gone', 'mixed', 'off'])
  })

  it('keeps every workspace that has separate sign-ins, in any case, and names the rest once', () => {
    const workspaces = [{ id: 'main' }, { id: 'work', separateSignIns: true }, { id: 'Upper', separateSignIns: true }, { id: 'off' }]
    expect(leftoverIdentities(workspaces, ['work', 'upper', 'gone', 'off', 'gone', 'bad id', 'main'])).toEqual(['gone', 'off', 'main'])
  })

  const sweepWith = (overrides: Partial<LeftoverIdentitySweep> = {}) => {
    const calls: string[] = []
    const sweep: LeftoverIdentitySweep = {
      workspaces: () => { calls.push('workspaces'); return [{ id: 'main' }, { id: 'work', separateSignIns: true }, { id: 'off' }] },
      partitionInUse: () => false,
      partitionFolders: () => { calls.push('partitions'); return ['intoponet-ws-work', 'intoponet-ws-gone', 'intoponet-ws-off'] },
      profileFiles: () => { calls.push('files'); return ['site-permissions.ws-work.json', 'site-permissions.ws-gone.json', 'site-permissions.ws-perm.json'] },
      loginWorkspaceIds: async () => { calls.push('logins'); return ['work', 'login-only'] },
      forget: async (id) => { calls.push(`forget:${id}`) },
      ...overrides,
    }
    return { sweep, calls }
  }

  it('removes nothing, and reads nothing, unless the saved workspaces loaded', async () => {
    // A missing, unreadable or set-aside state file: the workspaces known are not the person's.
    const { sweep, calls } = sweepWith()
    expect(await sweepLeftoverIdentities(false, sweep)).toEqual([])
    expect(calls).toEqual([])
  })

  it('forgets what deleted workspaces and ones turned off left, and keeps what a workspace still uses', async () => {
    const { sweep, calls } = sweepWith()
    expect(await sweepLeftoverIdentities(true, sweep)).toEqual(['gone', 'off', 'perm', 'login-only'])
    expect(calls.filter((call) => call.startsWith('forget:'))).toEqual(['forget:gone', 'forget:off', 'forget:perm', 'forget:login-only'])
  })

  it('checks again before each removal: given its own sign-ins again meanwhile, or its partition opened this run, it is kept', async () => {
    let turnedOn = false
    const { sweep, calls } = sweepWith({
      workspaces: () => [{ id: 'main' }, { id: 'work', separateSignIns: true }, { id: 'off', separateSignIns: turnedOn }],
      loginWorkspaceIds: async () => { turnedOn = true; return [] },
      partitionInUse: (id) => id === 'gone',
    })
    expect(await sweepLeftoverIdentities(true, sweep)).toEqual(['perm'])
    expect(calls).toEqual(['partitions', 'files', 'forget:perm'])
  })

  it('goes on past one that could not be removed', async () => {
    const { sweep } = sweepWith({ forget: async (id) => { if (id === 'gone') throw new Error('busy') } })
    expect(await sweepLeftoverIdentities(true, sweep)).toEqual(['off', 'perm', 'login-only'])
  })
})
