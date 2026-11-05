import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { parseUpdateCommand } from '@intoponet/browser-api'
import { compareVersions, fetchCurrentRelease, isNewerVersion, sanitizedPreferences, UpdateController, validatedUpdateFeedUrl, type UpdateAdapter } from './updates'

class FakeUpdater extends EventEmitter implements UpdateAdapter {
  feed: { url: string; serverType: 'json' } | null = null
  checkForUpdates = vi.fn()
  quitAndInstall = vi.fn()
  setFeedURL = vi.fn((options: { url: string; serverType: 'json' }) => { this.feed = options })
}

const enabledOptions = (adapter: FakeUpdater, emit = vi.fn()) => ({
  enabled: true,
  packaged: true,
  platform: 'darwin',
  currentVersion: '1.2.3',
  feedUrl: 'https://updates.example.org/intoponet',
  adapter,
  emit,
  latestVersion: async () => '9.9.9',
})
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('update versions', () => {
  it('orders versions numerically, with prereleases before their release', () => {
    expect(compareVersions('0.1.9', '0.1.10')).toBe(-1)
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
    expect(compareVersions('2.0.0', 'garbage')).toBeNull()
    expect(isNewerVersion('0.1.10', '0.1.9')).toBe(true)
    expect(isNewerVersion('0.1.9', '0.1.10')).toBe(false)
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(true)
    expect(isNewerVersion('', '1.0.0')).toBe(false)
  })

  it('reads currentRelease from the feed', async () => {
    const ok = (async () => new Response(JSON.stringify({ currentRelease: '1.2.4', releases: [] }))) as unknown as typeof fetch
    expect(await fetchCurrentRelease('https://u.example.org/releases.json', ok)).toBe('1.2.4')
    const missing = (async () => new Response('{}')) as unknown as typeof fetch
    expect(await fetchCurrentRelease('https://u.example.org/releases.json', missing)).toBeNull()
  })

  it('reports up to date, without asking Squirrel, when the feed is not newer (no downgrades)', async () => {
    for (const offered of ['1.2.3', '1.2.2', '0.9.0', '1.2.3-rc.1', null]) {
      const adapter = new FakeUpdater()
      const controller = new UpdateController({ ...enabledOptions(adapter), latestVersion: async () => offered })
      controller.handle({ type: 'check-and-download' })
      await flush()
      expect(adapter.checkForUpdates).not.toHaveBeenCalled()
      expect(controller.status().state).toBe('not-available')
    }
    const failing = new FakeUpdater()
    const controller = new UpdateController({ ...enabledOptions(failing), latestVersion: async () => { throw new Error('offline') } })
    controller.handle({ type: 'check-and-download' })
    await flush()
    expect(failing.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.status().state).toBe('error')
  })

  it('never offers a downloaded build that is not newer', async () => {
    const adapter = new FakeUpdater()
    const controller = new UpdateController(enabledOptions(adapter))
    controller.handle({ type: 'check-and-download' })
    await flush()
    adapter.emit('update-available')
    adapter.emit('update-downloaded', {}, '', '1.2.0', new Date(), 'https://u.example.org/x.zip')
    expect(controller.status().state).toBe('not-available')
    controller.handle({ type: 'restart' })
    expect(adapter.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('manual update controller', () => {
  it('disables preview, unsupported, unconfigured, and malformed feeds without initializing updater', () => {
    const preview = new FakeUpdater()
    expect(new UpdateController({ ...enabledOptions(preview), packaged: false }).status()).toMatchObject({ state: 'disabled', disabledReason: 'preview' })
    const unsupported = new FakeUpdater()
    expect(new UpdateController({ ...enabledOptions(unsupported), platform: 'linux' }).status()).toMatchObject({ state: 'disabled', disabledReason: 'unsupported-platform' })
    const absent = new FakeUpdater()
    expect(new UpdateController({ ...enabledOptions(absent), enabled: false }).status()).toMatchObject({ state: 'disabled', disabledReason: 'not-configured' })
    const malformed = new FakeUpdater()
    expect(new UpdateController({ ...enabledOptions(malformed), feedUrl: 'http://updates.example.org' }).status()).toMatchObject({ state: 'disabled', disabledReason: 'not-configured' })
    expect(preview.setFeedURL).not.toHaveBeenCalled()
    expect(unsupported.setFeedURL).not.toHaveBeenCalled()
    expect(absent.setFeedURL).not.toHaveBeenCalled()
    expect(malformed.setFeedURL).not.toHaveBeenCalled()
  })

  it('configures the JSON feed but performs no request until the user asks', () => {
    const adapter = new FakeUpdater()
    const controller = new UpdateController(enabledOptions(adapter))
    expect(adapter.feed).toEqual({ url: 'https://updates.example.org/intoponet/releases.json', serverType: 'json' })
    expect(adapter.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.status()).toMatchObject({ state: 'idle', currentVersion: '1.2.3' })
  })

  it('requires explicit check and explicit restart, and ignores duplicate checks while active', async () => {
    const adapter = new FakeUpdater()
    const emit = vi.fn()
    const controller = new UpdateController(enabledOptions(adapter, emit))
    expect(controller.handle({ type: 'check-and-download' }).state).toBe('checking')
    await flush()
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1)
    controller.handle({ type: 'check-and-download' })
    await flush()
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(adapter.quitAndInstall).not.toHaveBeenCalled()

    adapter.emit('update-available')
    expect(controller.status().state).toBe('downloading')
    adapter.emit('update-downloaded')
    expect(controller.status().state).toBe('downloaded')
    expect(adapter.quitAndInstall).not.toHaveBeenCalled()
    controller.handle({ type: 'restart' })
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ state: 'downloaded', currentVersion: '1.2.3' }))
    expect(emit.mock.calls.at(-1)?.[0]).not.toHaveProperty('error')
  })

  it('does not expose raw error details that could contain URLs or request data', () => {
    const adapter = new FakeUpdater()
    const controller = new UpdateController(enabledOptions(adapter))
    controller.handle({ type: 'check-and-download' })
    adapter.emit('error', new Error('https://secret.example/token=private'))
    expect(controller.status()).toMatchObject({ state: 'error', currentVersion: '1.2.3', error: 'The update operation failed. Try again later.' })
    expect(Object.keys(controller.status()).sort()).toEqual(['automatic', 'currentVersion', 'error', 'lastCheckedAt', 'state'])
  })

  it('fails closed if native feed setup throws and preserves a downloaded update if restart throws', () => {
    const setupFailure = new FakeUpdater()
    setupFailure.setFeedURL.mockImplementation(() => { throw new Error('secret feed details') })
    const disabled = new UpdateController(enabledOptions(setupFailure))
    expect(disabled.status()).toMatchObject({ state: 'disabled', disabledReason: 'not-configured', error: 'The update operation failed. Try again later.' })
    expect(disabled.handle({ type: 'check-and-download' }).state).toBe('disabled')
    expect(setupFailure.checkForUpdates).not.toHaveBeenCalled()

    const restartFailure = new FakeUpdater()
    restartFailure.quitAndInstall.mockImplementation(() => { throw new Error('secret install details') })
    const controller = new UpdateController(enabledOptions(restartFailure))
    controller.handle({ type: 'check-and-download' })
    restartFailure.emit('update-downloaded')
    const result = controller.handle({ type: 'restart' })
    expect(result.state).toBe('downloaded')
    expect(result.error).toBe('Restart to install failed. Close and reopen Intoponet to apply the downloaded update.')
  })
})

describe('update feed and IPC validation', () => {
  it('accepts HTTPS host-only feed paths and rejects credentials, query, local hosts, and plain HTTP', () => {
    expect(validatedUpdateFeedUrl('https://updates.example.org/releases/')).toBe('https://updates.example.org/releases')
    for (const url of [
      'http://updates.example.org',
      'https://user:pass@updates.example.org',
      'https://updates.example.org?token=x',
      'https://localhost:8443',
      'https://127.0.0.1',
      'https://updates.local',
    ]) expect(validatedUpdateFeedUrl(url)).toBeNull()
  })

  it('accepts only known updater commands', () => {
    expect(parseUpdateCommand({ type: 'check-and-download' })).toEqual({ type: 'check-and-download' })
    expect(() => parseUpdateCommand({ type: 'download', url: 'https://attacker.example' })).toThrow(/Invalid update command/)
    expect(() => parseUpdateCommand({ type: 'status', extra: 'ignored' })).toThrow(/Invalid update command/)
    expect(() => parseUpdateCommand(null)).toThrow(/Invalid update command/)
  })
})

describe('automatic update checks', () => {
  const fakeClock = () => {
    let now = Date.parse('2026-10-30T12:00:00Z')
    const pending: Array<{ at: number; run: () => void; cancelled: boolean }> = []
    return {
      now: () => now,
      schedule: (run: () => void, delayMs: number) => { const task = { at: now + delayMs, run, cancelled: false }; pending.push(task); return { cancel: () => { task.cancelled = true } } },
      advance: (ms: number) => {
        now += ms
        for (const task of [...pending].sort((a, b) => a.at - b.at)) if (!task.cancelled && task.at <= now) { task.cancelled = true; task.run() }
      },
    }
  }

  it('checks shortly after launch, then about daily, and remembers the last check', async () => {
    const { AUTO_FIRST_DELAY_MS, AUTO_INTERVAL_MS } = await import('./updates')
    const adapter = new FakeUpdater(); const clock = fakeClock(); const saved: unknown[] = []
    const controller = new UpdateController({ ...enabledOptions(adapter), now: clock.now, schedule: clock.schedule, preferences: { load: () => ({ automatic: true }), save: (p) => saved.push(p) } })
    expect(controller.status()).toMatchObject({ automatic: true })
    controller.startAutomatic()
    clock.advance(AUTO_FIRST_DELAY_MS - 1)
    expect(adapter.checkForUpdates).not.toHaveBeenCalled()
    clock.advance(1)
    await flush()
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(saved.at(-1)).toMatchObject({ automatic: true, lastCheckedAt: clock.now() })
    adapter.emit('update-not-available')
    clock.advance(AUTO_INTERVAL_MS)
    await flush()
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('waits out the rest of the day after a recent check, and never interrupts a pending install', async () => {
    const { AUTO_INTERVAL_MS } = await import('./updates')
    const adapter = new FakeUpdater(); const clock = fakeClock()
    const controller = new UpdateController({ ...enabledOptions(adapter), now: clock.now, schedule: clock.schedule, preferences: { load: () => ({ automatic: true, lastCheckedAt: clock.now() - 2 * 60 * 60 * 1000 }), save: () => {} } })
    controller.startAutomatic()
    clock.advance(AUTO_INTERVAL_MS - 2 * 60 * 60 * 1000 - 1)
    expect(adapter.checkForUpdates).not.toHaveBeenCalled()
    clock.advance(1)
    await flush()
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1)
    adapter.emit('update-available')
    adapter.emit('update-downloaded', {}, '', '1.3.0', new Date(), 'https://intoponet.com/updates/arm64/x.zip')
    expect(controller.status()).toMatchObject({ state: 'downloaded', availableVersion: '1.3.0' })
    clock.advance(AUTO_INTERVAL_MS)
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('stops when turned off and persists the choice', async () => {
    const { AUTO_FIRST_DELAY_MS } = await import('./updates')
    const adapter = new FakeUpdater(); const clock = fakeClock(); const saved: Array<{ automatic: boolean }> = []
    const controller = new UpdateController({ ...enabledOptions(adapter), now: clock.now, schedule: clock.schedule, preferences: { load: () => ({ automatic: true }), save: (p) => saved.push(p) } })
    controller.startAutomatic()
    expect(controller.handle({ type: 'set-automatic', enabled: false })).toMatchObject({ automatic: false })
    expect(saved.at(-1)).toMatchObject({ automatic: false })
    clock.advance(AUTO_FIRST_DELAY_MS * 10)
    expect(adapter.checkForUpdates).not.toHaveBeenCalled()
    const off = new UpdateController({ ...enabledOptions(new FakeUpdater()), now: clock.now, schedule: clock.schedule, preferences: { load: () => ({ automatic: false }), save: () => {} } })
    off.startAutomatic()
    expect(off.status()).toMatchObject({ automatic: false })
  })

  it('validates the set-automatic command', () => {
    expect(parseUpdateCommand({ type: 'set-automatic', enabled: true })).toEqual({ type: 'set-automatic', enabled: true })
    expect(() => parseUpdateCommand({ type: 'set-automatic', enabled: 'yes' })).toThrow()
    expect(() => parseUpdateCommand({ type: 'set-automatic' })).toThrow()
    expect(() => parseUpdateCommand({ type: 'restart', enabled: true })).toThrow()
  })
})

describe('stored update preferences', () => {
  const now = Date.UTC(2026, 10, 5)
  it('keeps sensible values', () => {
    expect(sanitizedPreferences({ automatic: false, lastCheckedAt: now - 1000 }, now)).toEqual({ automatic: false, lastCheckedAt: now - 1000 })
  })
  it('drops values that would throw or make no sense instead of stopping the app', () => {
    for (const lastCheckedAt of [1e20, -5, Number.NaN, Infinity, '2026-01-01', now + 7 * 24 * 60 * 60 * 1000]) {
      expect(sanitizedPreferences({ automatic: true, lastCheckedAt }, now)).toEqual({ automatic: true })
    }
    expect(sanitizedPreferences({ automatic: 'no' }, now)).toEqual({ automatic: true })
    expect(sanitizedPreferences(null, now)).toEqual({ automatic: true })
    expect(sanitizedPreferences([1, 2], now)).toEqual({ automatic: true })
  })
  it('a controller built from a damaged file still reports its status', () => {
    const controller = new UpdateController({ enabled: false, packaged: false, platform: 'darwin', currentVersion: '1.0.0', feedUrl: '', adapter: undefined, emit: () => {}, now: () => now, preferences: { load: () => ({ automatic: true, lastCheckedAt: 1e20 }), save: () => {} } })
    expect(controller.status()).toMatchObject({ automatic: true })
    expect(controller.status()).not.toHaveProperty('lastCheckedAt')
  })
})
