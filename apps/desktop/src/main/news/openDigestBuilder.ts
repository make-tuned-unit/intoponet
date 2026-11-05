import { Worker } from 'node:worker_threads'
import workerPath from './digestWorker?modulePath'
import { inlineDigestBuilder, NeedsFullUpdate, type DigestBuilder, type DigestOutput } from './digestBuild'
import type { PlaceTrends } from '../../shared/news/placeTrends'

/**
 * Digests and place trends on a worker thread. If the worker fails or exits it is started again
 * on the next request (which then asks for a full update); if it cannot start at all, everything
 * runs on this thread instead.
 */
export function openDigestBuilder(): DigestBuilder {
  let worker: Worker | null = null
  let fallback: DigestBuilder | null = null
  let next = 0
  const waiting = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>()
  const failAll = (error: Error): void => {
    for (const entry of waiting.values()) entry.reject(error)
    waiting.clear()
  }
  const start = (): Worker => {
    const created = new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 1024 } })
    created.unref()
    created.on('message', (message: { id: number; value?: unknown; needsFull?: boolean; error?: string }) => {
      const entry = waiting.get(message.id)
      if (!entry) return
      waiting.delete(message.id)
      if (message.error === undefined) entry.resolve(message.value as never)
      else entry.reject(message.needsFull ? new NeedsFullUpdate() : new Error(message.error))
    })
    created.on('error', (error) => { if (worker === created) worker = null; failAll(error) })
    created.on('exit', () => { if (worker === created) worker = null; failAll(new NeedsFullUpdate()) })
    return created
  }
  const ask = <T>(request: Record<string, unknown>): Promise<T> => {
    worker ??= start()
    const id = ++next
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (value: never) => void, reject })
      worker!.postMessage({ id, ...request })
    })
  }
  const withFallback = <T>(run: (builder: DigestBuilder) => Promise<T>, viaWorker: () => Promise<T>): Promise<T> => {
    if (fallback) return run(fallback)
    try {
      return viaWorker()
    } catch {
      // The worker could not start: run here from now on (it needs a full update first).
      fallback = inlineDigestBuilder()
      return Promise.reject(new NeedsFullUpdate())
    }
  }
  return {
    build: (update) => withFallback((builder) => builder.build(update), () => ask<DigestOutput>({ type: 'build', update })),
    trends: (place, now) => withFallback((builder) => builder.trends(place, now), () => ask<PlaceTrends>({ type: 'trends', place, now })),
    close: () => {
      failAll(new Error('Digest builder closed.'))
      const stopping = worker
      worker = null
      void stopping?.terminate()
    },
  }
}
