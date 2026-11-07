import { describe, expect, it } from 'vitest'
import { waitForSaves } from './quitSaves'

function saves() {
  const list = new Set<Promise<void>>()
  const start = (ms: number): Promise<void> => {
    const save = new Promise<void>((resolve) => setTimeout(resolve, ms))
    list.add(save)
    void save.then(() => list.delete(save))
    return save
  }
  return { list, start, pending: () => [...list] }
}

describe('saves a quit waits for', () => {
  it('quits at once when nothing is being saved', async () => {
    const { pending } = saves()
    expect(await waitForSaves(pending, Date.now() + 5_000)).toBe(true)
  })

  it('also waits for a save that starts while it waits (the one-second history save, a late library save)', async () => {
    const { start, pending, list } = saves()
    let lateDone = false
    void start(20).then(() => { void start(40).then(() => { lateDone = true }) })
    expect(await waitForSaves(pending, Date.now() + 5_000)).toBe(true)
    expect(lateDone).toBe(true)
    expect(list.size).toBe(0)
  })

  it('stops waiting at the time limit when a save does not finish', async () => {
    const { start, pending } = saves()
    void start(10_000)
    const began = Date.now()
    expect(await waitForSaves(pending, began + 60)).toBe(false)
    expect(Date.now() - began).toBeLessThan(2_000)
    expect(await waitForSaves(pending, began - 1)).toBe(false)
  })
})
