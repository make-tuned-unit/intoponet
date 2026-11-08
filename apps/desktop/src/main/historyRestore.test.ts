import { describe, expect, it, vi } from 'vitest'
import { restoreHistoryOrLoad } from './historyRestore'

describe('restoreHistoryOrLoad', () => {
  it('leaves a restored list alone', async () => {
    const load = vi.fn(async () => undefined)
    expect(await restoreHistoryOrLoad({ restore: async () => undefined, navigatedSince: () => false, load })).toBe('restored')
    expect(load).not.toHaveBeenCalled()
  })

  it('never loads the old address over a page that arrived while the list was restoring', async () => {
    // Electron's restore rejects when a newer navigation (an address typed meanwhile) fails: its error page is in the view.
    const load = vi.fn(async () => undefined)
    const result = await restoreHistoryOrLoad({ restore: async () => { throw new Error('ERR_CONNECTION_REFUSED (-102)') }, navigatedSince: () => true, load })
    expect(result).toBe('kept')
    expect(load).not.toHaveBeenCalled()
  })

  it('asks whether anything arrived only once the restore has failed', async () => {
    let arrived = false
    const load = vi.fn(async () => undefined)
    const restore = async () => {
      arrived = true
      throw new Error('ERR_NAME_NOT_RESOLVED (-105)')
    }
    expect(await restoreHistoryOrLoad({ restore, navigatedSince: () => arrived, load })).toBe('kept')
    expect(load).not.toHaveBeenCalled()
  })

  it('loads the address when the list could not be restored at all and nothing has navigated', async () => {
    const load = vi.fn(async () => undefined)
    // Electron throws before restoring anything for an entry it refuses.
    const restore = () => { throw new Error('Failed to restore navigation history: Invalid navigation entry at index 0.') }
    expect(await restoreHistoryOrLoad({ restore, navigatedSince: () => false, load })).toBe('loaded')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not reject when loading the address fails too', async () => {
    const load = vi.fn(async () => { throw new Error('ERR_ABORTED (-3)') })
    await expect(restoreHistoryOrLoad({ restore: async () => { throw new Error('failed') }, navigatedSince: () => false, load })).resolves.toBe('loaded')
  })
})
