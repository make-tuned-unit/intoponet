import type { PlaceQuery, PlaceTrends } from '../../shared/news/placeTrends'
import type { NewsService } from './newsService'

/** What the news thread tells the main process. */
export type NewsWorkerMessage =
  | { type: 'started' }
  | { type: 'digest'; payload: string }
  | { type: 'reply'; id: number; value?: unknown; error?: string }

/** What the main process asks of the news thread. */
export type NewsWorkerRequest =
  | { type: 'trends'; id: number; place: PlaceQuery & { geonameId?: string } }
  | { type: 'retry-offline' }
  | { type: 'stop'; id: number }

/** The part of a worker thread the proxy uses (a Worker; a stand-in under test). */
export type NewsWorker = {
  postMessage: (request: NewsWorkerRequest) => void
  on: (event: 'message' | 'error' | 'exit', listener: (value: never) => void) => unknown
  terminate: () => unknown
}

export type NewsServiceProxyOptions = {
  emit: (payload: string) => void
  /** Starts the news thread. May throw when a thread cannot be made. */
  startWorker: () => NewsWorker
  /** The same service on this thread: used when the news thread cannot start, or keeps failing. */
  startInProcess: (emit: (payload: string) => void) => Promise<NewsService>
  /** How long the thread has to say it started before the service runs on this thread instead. */
  startLimitMs?: number
  /** How many times a thread that started and then failed is started again. */
  maxRestarts?: number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

const DEFAULT_START_LIMIT_MS = 15_000
const DEFAULT_MAX_RESTARTS = 2

/**
 * The news service as the main process sees it, while the service itself (fetching and reading a few thousand
 * feeds, keeping their headlines, saving them) runs on its own thread: none of that work holds up the app.
 * A thread that cannot start, or that says nothing for `startLimitMs`, is replaced by the service running here;
 * one that fails after starting is started again (it picks up from the saved feeds) at most `maxRestarts` times.
 */
export function openNewsServiceProxy(options: NewsServiceProxyOptions): NewsService {
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  const startLimitMs = options.startLimitMs ?? DEFAULT_START_LIMIT_MS
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS
  let latest: string | null = null
  let worker: NewsWorker | null = null
  let inProcess: Promise<NewsService> | null = null
  let stopping: Promise<void> | null = null
  let restarts = 0
  let nextId = 0
  const waiting = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>()

  const emit = (payload: string): void => {
    latest = payload
    options.emit(payload)
  }
  const failWaiting = (error: Error): void => {
    for (const entry of waiting.values()) entry.reject(error)
    waiting.clear()
  }
  const runHere = (): void => {
    if (inProcess || stopping) return
    inProcess = options.startInProcess(emit)
    inProcess.catch((error: unknown) => {
      console.error('News feeds could not start.', error instanceof Error ? error.message : error)
    })
  }

  const start = (): void => {
    let created: NewsWorker
    try {
      created = options.startWorker()
    } catch {
      runHere()
      return
    }
    worker = created
    let started = false
    let over = false
    const startTimer = setTimer(() => lost(new Error('The news thread did not start.')), startLimitMs)
    /** This thread is gone (or never came): what was asked of it fails, and the service goes on another way. */
    function lost(error: Error): void {
      if (over) return
      over = true
      clearTimer(startTimer)
      if (worker !== created) return
      worker = null
      failWaiting(error)
      try { void created.terminate() } catch { /* already gone */ }
      if (stopping) return
      if (started && restarts < maxRestarts) {
        restarts += 1
        start()
      } else {
        runHere()
      }
    }
    created.on('message', ((message: NewsWorkerMessage) => {
      if (over) return
      if (message.type === 'started') {
        started = true
        clearTimer(startTimer)
      } else if (message.type === 'digest') {
        emit(message.payload)
      } else if (message.type === 'reply') {
        const entry = waiting.get(message.id)
        if (!entry) return
        waiting.delete(message.id)
        if (message.error === undefined) entry.resolve(message.value as never)
        else entry.reject(new Error(message.error))
      }
    }) as (value: never) => void)
    created.on('error', ((error: unknown) => lost(error instanceof Error ? error : new Error(String(error)))) as (value: never) => void)
    created.on('exit', (() => lost(new Error('The news thread ended.'))) as (value: never) => void)
  }

  const ask = <T>(request: (id: number) => NewsWorkerRequest): Promise<T> => {
    const target = worker
    if (!target) return Promise.reject(new Error('The news service is restarting.'))
    const id = ++nextId
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (value: never) => void, reject })
      try {
        target.postMessage(request(id))
      } catch (error) {
        waiting.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  start()

  return {
    latest: () => latest,
    trends: async (place): Promise<PlaceTrends> => {
      if (inProcess) return (await inProcess).trends(place)
      return ask<PlaceTrends>((id) => ({ type: 'trends', id, place }))
    },
    retryOffline: () => {
      if (stopping) return
      if (inProcess) void inProcess.then((service) => service.retryOffline()).catch(() => undefined)
      else try { worker?.postMessage({ type: 'retry-offline' }) } catch { /* the thread is going */ }
    },
    /** Resolves once the feeds are saved (the same save, on whichever thread holds them). Quitting waits for it. */
    stop: () => {
      stopping ??= (async () => {
        if (inProcess) {
          await inProcess.then((service) => service.stop()).catch(() => undefined)
          return
        }
        const target = worker
        if (!target) return
        // The thread saves, answers, and is then ended; if it ends first there is nothing more to wait for.
        await ask<void>((id) => ({ type: 'stop', id })).catch(() => undefined)
        if (worker === target) worker = null
        try { await target.terminate() } catch { /* already gone */ }
      })()
      return stopping
    },
  }
}
