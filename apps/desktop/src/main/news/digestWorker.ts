// Builds news digests and place trends off the main thread, so the app stays responsive while
// ~100,000 headlines are grouped. Keeps every feed's headlines between requests (digestBuild.ts).
import { writeFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'
import { DigestModel, NeedsFullUpdate, type DigestUpdate } from './digestBuild'
import type { PlaceQuery } from '../../shared/news/placeTrends'

type Request =
  | { id: number; type: 'build'; update: DigestUpdate }
  | { id: number; type: 'trends'; place: PlaceQuery; now: number }

const model = new DigestModel()

parentPort?.on('message', (request: Request) => {
  try {
    if (request.type === 'build') {
      // Debugging aid: INTOPONET_DUMP_DIGEST_INPUT=/path writes the latest update for offline profiling.
      if (process.env.INTOPONET_DUMP_DIGEST_INPUT) writeFileSync(process.env.INTOPONET_DUMP_DIGEST_INPUT, JSON.stringify(request.update))
      model.apply(request.update)
      parentPort!.postMessage({ id: request.id, value: model.build(request.update.now) })
    } else {
      parentPort!.postMessage({ id: request.id, value: model.trends(request.place, request.now) })
    }
  } catch (error) {
    parentPort!.postMessage({ id: request.id, needsFull: error instanceof NeedsFullUpdate, error: error instanceof Error ? error.message : String(error) })
  }
})
