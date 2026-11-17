import { describe, expect, it, vi } from 'vitest'
import type { PlaceTrends } from '../../shared/news/placeTrends'
import type { NewsService } from './newsService'
import { openNewsServiceProxy, type NewsWorker, type NewsWorkerMessage, type NewsWorkerRequest } from './newsServiceProxy'

const trends: PlaceTrends = { rising: [], fading: [], recentStories: 3, previousStories: 1, outlets: 2, uncompared: 0, latest: [], earlier: [] }

/** A stand-in for the news thread: records what it is asked, and says what the test tells it to. */
function fakeWorker() {
  const listeners: Record<string, Array<(value: unknown) => void>> = { message: [], error: [], exit: [] }
  const requests: NewsWorkerRequest[] = []
  let terminated = false
  const worker: NewsWorker = {
    postMessage: (request) => { requests.push(request) },
    on: (event, listener) => { listeners[event]!.push(listener as (value: unknown) => void) },
    terminate: () => {
      if (!terminated) {
        terminated = true
        queueMicrotask(() => listeners['exit']!.forEach((listener) => listener(1)))
      }
      return Promise.resolve(1)
    },
  }
  return {
    worker,
    requests,
    isTerminated: () => terminated,
    say: (message: NewsWorkerMessage) => listeners['message']!.forEach((listener) => listener(message)),
    fail: (error: Error) => listeners['error']!.forEach((listener) => listener(error)),
    exit: () => listeners['exit']!.forEach((listener) => listener(1)),
  }
}

function inProcessService(emit: (payload: string) => void): NewsService & { stopped: number; retried: number } {
  emit('{"from":"this thread"}')
  const service = {
    stopped: 0,
    retried: 0,
    latest: () => '{"from":"this thread"}',
    trends: async () => trends,
    retryOffline: () => { service.retried += 1 },
    stop: async () => { service.stopped += 1 },
  }
  return service
}

const settle = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }

describe('the news service on its own thread', () => {
  it('passes each digest on, remembers the latest, and answers place trends from the thread', async () => {
    const thread = fakeWorker()
    const emitted: string[] = []
    const startInProcess = vi.fn()
    const service = openNewsServiceProxy({ emit: (payload) => emitted.push(payload), startWorker: () => thread.worker, startInProcess })
    expect(service.latest()).toBeNull()
    thread.say({ type: 'digest', payload: '{"cached":true}' })
    thread.say({ type: 'started' })
    thread.say({ type: 'digest', payload: '{"fresh":true}' })
    expect(emitted).toEqual(['{"cached":true}', '{"fresh":true}'])
    expect(service.latest()).toBe('{"fresh":true}')

    const asked = service.trends({ countryCode: 'PT', name: 'Lisbon', geonameId: '2267057' })
    const request = thread.requests[0]!
    expect(request).toMatchObject({ type: 'trends', place: { countryCode: 'PT', name: 'Lisbon', geonameId: '2267057' } })
    thread.say({ type: 'reply', id: (request as { id: number }).id, value: trends })
    expect(await asked).toEqual(trends)

    service.retryOffline()
    expect(thread.requests[1]).toEqual({ type: 'retry-offline' })
    expect(startInProcess).not.toHaveBeenCalled()
  })

  it('waits, on quitting, for the thread to say the feeds are saved, then ends it', async () => {
    const thread = fakeWorker()
    const service = openNewsServiceProxy({ emit: () => undefined, startWorker: () => thread.worker, startInProcess: vi.fn() })
    thread.say({ type: 'started' })
    let saved = false
    const stopped = service.stop().then(() => { saved = true })
    await settle()
    expect(saved).toBe(false)
    expect(thread.isTerminated()).toBe(false)
    const request = thread.requests.find((entry) => entry.type === 'stop') as { id: number }
    thread.say({ type: 'reply', id: request.id })
    await stopped
    expect(thread.isTerminated()).toBe(true)
    // Asked twice (before-quit and will-quit both do), the feeds are saved once.
    await service.stop()
    expect(thread.requests.filter((entry) => entry.type === 'stop')).toHaveLength(1)
  })

  it('does not hold up quitting when the thread ends before it answers', async () => {
    const thread = fakeWorker()
    const startInProcess = vi.fn()
    const service = openNewsServiceProxy({ emit: () => undefined, startWorker: () => thread.worker, startInProcess })
    thread.say({ type: 'started' })
    const stopped = service.stop()
    thread.exit()
    await stopped
    // Quitting: a thread that ended is not started again, here or anywhere.
    expect(startInProcess).not.toHaveBeenCalled()
  })

  it('runs the service on this thread when the news thread cannot be made', async () => {
    const emitted: string[] = []
    let here: ReturnType<typeof inProcessService> | null = null
    const service = openNewsServiceProxy({
      emit: (payload) => emitted.push(payload),
      startWorker: () => { throw new Error('no threads') },
      startInProcess: async (emit) => (here = inProcessService(emit)),
    })
    await settle()
    expect(emitted).toEqual(['{"from":"this thread"}'])
    expect(service.latest()).toBe('{"from":"this thread"}')
    expect(await service.trends({ countryCode: 'PT' })).toEqual(trends)
    service.retryOffline()
    await settle()
    expect(here!.retried).toBe(1)
    await service.stop()
    expect(here!.stopped).toBe(1)
  })

  it('runs the service on this thread when the news thread fails before starting, or never says it started', async () => {
    const failed = fakeWorker()
    const startInProcess = vi.fn(async (emit: (payload: string) => void) => inProcessService(emit))
    openNewsServiceProxy({ emit: () => undefined, startWorker: () => failed.worker, startInProcess })
    failed.fail(new Error('Cannot find module'))
    expect(startInProcess).toHaveBeenCalledTimes(1)
    expect(failed.isTerminated()).toBe(true)

    const silent = fakeWorker()
    let limit: (() => void) | null = null
    const second = vi.fn(async (emit: (payload: string) => void) => inProcessService(emit))
    openNewsServiceProxy({
      emit: () => undefined,
      startWorker: () => silent.worker,
      startInProcess: second,
      startLimitMs: 5_000,
      setTimer: (callback, delayMs) => { expect(delayMs).toBe(5_000); limit = callback; return 1 as unknown as ReturnType<typeof setTimeout> },
      clearTimer: () => { limit = null },
    })
    expect(second).not.toHaveBeenCalled()
    limit!()
    expect(second).toHaveBeenCalledTimes(1)
    expect(silent.isTerminated()).toBe(true)
    // What the ended thread still says is ignored: the service on this thread is the only one.
    await settle()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('starts a thread that failed after starting again, keeps the last digest meanwhile, and gives up after two tries', async () => {
    const threads = [fakeWorker(), fakeWorker(), fakeWorker()]
    let made = 0
    const emitted: string[] = []
    const startInProcess = vi.fn(async (emit: (payload: string) => void) => inProcessService(emit))
    const service = openNewsServiceProxy({ emit: (payload) => emitted.push(payload), startWorker: () => threads[made++]!.worker, startInProcess })
    threads[0]!.say({ type: 'started' })
    threads[0]!.say({ type: 'digest', payload: '{"n":1}' })
    const asked = service.trends({ countryCode: 'PT' })
    threads[0]!.fail(new Error('out of memory'))
    // What was being asked fails (the place panel asks again); the digest shown stays.
    await expect(asked).rejects.toThrow('out of memory')
    expect(made).toBe(2)
    expect(service.latest()).toBe('{"n":1}')
    threads[1]!.say({ type: 'started' })
    threads[1]!.exit()
    expect(made).toBe(3)
    expect(startInProcess).not.toHaveBeenCalled()
    threads[2]!.say({ type: 'started' })
    threads[2]!.exit()
    expect(made).toBe(3)
    expect(startInProcess).toHaveBeenCalledTimes(1)
    await settle()
    expect(service.latest()).toBe('{"from":"this thread"}')
  })
})
