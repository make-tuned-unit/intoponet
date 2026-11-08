import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A profile folder and the app's listeners, for an Electron stand-in. */
const electronStub = vi.hoisted(() => ({ userData: '', listeners: new Map<string, Array<() => void>>(), authCleared: [] as string[] }))
vi.mock('electron', () => ({
  app: {
    getPath: () => electronStub.userData,
    on: (event: string, listener: () => void) => { electronStub.listeners.set(event, [...(electronStub.listeners.get(event) ?? []), listener]) },
  },
  session: { fromPartition: (partition: string) => ({ on: () => undefined, clearData: async () => undefined, clearStorageData: async () => undefined, clearCache: async () => undefined, clearAuthCache: async () => { electronStub.authCleared.push(partition) }, downloadURL: () => undefined }) },
  shell: { openPath: async () => '', showItemInFolder: () => undefined },
}))

const { installBrowsingData } = await import('./browsingData')
const { latestWritesInFlight } = await import('./latestWriter')

/** The one-second save runs, and what it writes reaches the disk. */
async function written(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1_500)
  await Promise.all(latestWritesInFlight())
}

const DAY = 86_400_000
/** The Keychain stand-in: unavailable until granted. "Sealing" is a prefix, enough to tell sealed from plain. */
function keychain() {
  let available = false
  const seal = (text: string): Buffer => Buffer.from(`sealed:${text}`)
  const open = (sealed: Buffer): string => {
    const text = sealed.toString('utf8')
    if (!text.startsWith('sealed:')) throw new Error('not sealed')
    return text.slice('sealed:'.length)
  }
  return {
    grant: () => { available = true },
    seal,
    open,
    options: {
      available: async () => available,
      encrypt: async (text: string) => seal(text),
      decrypt: async (sealed: Buffer) => open(sealed),
      encryptSync: seal,
      availableSync: () => available,
    },
  }
}

function setUp(savedVisits: Array<{ id: string; url: string; title: string; visitedAt: number }>) {
  electronStub.userData = mkdtempSync(join(tmpdir(), 'browsing-data-'))
  electronStub.listeners.clear()
  mkdirSync(join(electronStub.userData, 'personal'), { recursive: true })
  const historyFile = join(electronStub.userData, 'personal', 'history.v1.seal')
  const keys = keychain()
  writeFileSync(historyFile, keys.seal(JSON.stringify({ schema: 'intoponet.history.v1', policy: { footprints: true, retentionDays: 0 }, visits: savedVisits.map((visit) => ({ ...visit, host: new URL(visit.url).hostname })) })))
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => unknown>()
  const data = installBrowsingData({
    getWindow: () => null,
    handle: (channel, handler) => { handlers.set(channel, handler) },
    excludedSites: () => [],
    normalPartition: 'persist:test',
    privatePartition: 'test-private',
    seal: keys.options,
  })
  const command = (value: unknown) => handlers.get('intoponet:history')!({} as IpcMainInvokeEvent, value)
  const onDisk = (): string[] => (JSON.parse(keys.open(readFileSync(historyFile))) as { visits: Array<{ url: string }> }).visits.map((visit) => visit.url)
  const quit = (event: string): void => { for (const listener of electronStub.listeners.get(event) ?? []) listener() }
  return { data, keys, command, onDisk, quit }
}

describe('history saved while the Keychain was unavailable at startup', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }) })
  afterEach(() => { vi.useRealTimers() })

  const yesterday = Date.now() - DAY
  const saved = [{ id: 'old-1', url: 'https://old.example/one', title: 'Old one', visitedAt: yesterday }, { id: 'old-2', url: 'https://old.example/two', title: 'Old two', visitedAt: yesterday - 1000 }]

  it('is never saved over, and is read and kept once the Keychain is granted later in the same run', async () => {
    const { data, keys, onDisk, quit } = setUp(saved)
    await vi.advanceTimersByTimeAsync(10)
    data.history.record({ url: 'https://new.example/', title: 'New', isPrivate: false })
    await written()
    // Nothing could be sealed or read: the saved history is as it was.
    expect(onDisk()).toEqual(['https://old.example/one', 'https://old.example/two'])
    keys.grant()
    data.history.record({ url: 'https://newer.example/', title: 'Newer', isPrivate: false })
    await written()
    expect(onDisk()).toEqual(['https://newer.example/', 'https://new.example/', 'https://old.example/one', 'https://old.example/two'])
    expect(data.history.search('').total).toBe(4)
    // The quit writes the rest on top of what was read.
    data.history.record({ url: 'https://last.example/', title: 'Last', isPrivate: false })
    quit('before-quit')
    quit('quit')
    expect(onDisk()[0]).toBe('https://last.example/')
    expect(onDisk()).toHaveLength(5)
  })

  it('is read before History is searched, once it can be, and saved with the visits made before', async () => {
    const { data, keys, command, onDisk } = setUp(saved)
    await vi.advanceTimersByTimeAsync(10)
    data.history.record({ url: 'https://new.example/', title: 'New', isPrivate: false })
    await written()
    expect((await command({ type: 'search', query: '', cursor: 0, limit: 100 }) as { total: number }).total).toBe(1)
    keys.grant()
    expect((await command({ type: 'search', query: '', cursor: 0, limit: 100 }) as { total: number }).total).toBe(3)
    await written()
    expect(onDisk()).toEqual(['https://new.example/', 'https://old.example/one', 'https://old.example/two'])
  })

  it('stays cleared when history was cleared before it could be read', async () => {
    const { data, keys, command, onDisk } = setUp(saved)
    await vi.advanceTimersByTimeAsync(10)
    data.history.record({ url: 'https://new.example/', title: 'New', isPrivate: false })
    await command({ type: 'clear' })
    data.history.record({ url: 'https://after.example/', title: 'After', isPrivate: false })
    keys.grant()
    await written()
    expect(onDisk()).toEqual(['https://after.example/'])
  })

  it('is not written over at quit while it is still unread', async () => {
    const { data, onDisk, quit } = setUp(saved)
    await vi.advanceTimersByTimeAsync(10)
    data.history.record({ url: 'https://new.example/', title: 'New', isPrivate: false })
    quit('before-quit')
    quit('quit')
    await written()
    expect(onDisk()).toEqual(['https://old.example/one', 'https://old.example/two'])
  })
})

describe('clearing cookies and site data', () => {
  it('also forgets what was typed into sites’ own HTTP sign-in boxes, in the shared session', async () => {
    const { command } = setUp([])
    electronStub.authCleared = []
    await command({ type: 'clear-browsing-data', request: { range: 'all', history: false, siteData: true, cache: false, downloads: false } })
    expect(electronStub.authCleared).toEqual(['persist:test'])
  })
})
