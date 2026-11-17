import { Worker } from 'node:worker_threads'
import workerPath from './newsWorker?modulePath'
import type { NewsService } from './newsService'
import { openNewsServiceProxy, type NewsWorker } from './newsServiceProxy'

/**
 * Starts the news service on its own thread (newsWorker.ts) and returns it as the main process uses it.
 * If the thread cannot run, the service runs on this thread as it used to (see newsServiceProxy.ts).
 */
export function openNewsService(options: { userData: string; emit: (payload: string) => void }): NewsService {
  return openNewsServiceProxy({
    emit: options.emit,
    startWorker: () => {
      const worker = new Worker(workerPath, { workerData: { userData: options.userData } })
      // Quitting waits for the feeds to be saved (stop()); the thread itself never keeps the app open.
      worker.unref()
      return worker as unknown as NewsWorker
    },
    // Loaded only if needed: the feed list and the feed reader are otherwise never loaded on this thread.
    startInProcess: async (emit) => {
      const [{ startNewsService }, { openDigestBuilder }] = await Promise.all([import('./newsService'), import('./openDigestBuilder')])
      return startNewsService({ userData: options.userData, emit, digestBuilder: openDigestBuilder() })
    },
  })
}
