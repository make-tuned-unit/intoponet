// The news service on its own thread: fetching and reading a few thousand feeds, keeping about 100,000 headlines
// and saving them (tens of MB of JSON) would each hold up the app for a moment, many times a minute, if done on the
// main thread. The main process sees it through openNewsService.ts; digests are built on a further thread (digestWorker.ts).
import { parentPort, workerData } from 'node:worker_threads'
import { startNewsService } from './newsService'
import { openDigestBuilder } from './openDigestBuilder'
import type { NewsWorkerMessage, NewsWorkerRequest } from './newsServiceProxy'

const port = parentPort!
const say = (message: NewsWorkerMessage): void => port.postMessage(message)

const service = startNewsService({
  userData: (workerData as { userData: string }).userData,
  emit: (payload) => say({ type: 'digest', payload }),
  digestBuilder: openDigestBuilder(),
})
say({ type: 'started' })

port.on('message', (request: NewsWorkerRequest) => {
  if (request.type === 'retry-offline') {
    service.retryOffline()
    return
  }
  const answer = request.type === 'stop' ? service.stop() : service.trends(request.place)
  void answer.then(
    (value) => say({ type: 'reply', id: request.id, value }),
    (error: unknown) => say({ type: 'reply', id: request.id, error: error instanceof Error ? error.message : String(error) }),
  )
})
