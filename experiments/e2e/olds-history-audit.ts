/** Audit the history-enrichment stage against saved headline threads, preserving
 * their selected topics and recent narratives. This does not rerun matching.
 * Bundle with esbuild (platform=node, format=esm), then run with CACHE_DIR OUTPUT.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import type { OldsThread } from '@intoponet/browser-api'
import { OldsService } from '../../apps/desktop/src/main/olds/oldsService'

const [cacheDir, output] = process.argv.slice(2)
if (!cacheDir || !output) throw new Error('Usage: olds-history-audit CACHE_DIR OUTPUT')
const service = new OldsService({ cacheDir })
// Deliberately exercise only this stage, without rewriting the saved cache or
// claiming a fresh end-to-end run of all headline searches.
const enrich = (service as unknown as { addHistoricalContext(thread: OldsThread): Promise<void> }).addHistoricalContext.bind(service)
const threads = readdirSync(cacheDir).filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(`${cacheDir}/${file}`, 'utf8')) as OldsThread)
  .filter((thread) => !!thread.context?.headline)
const rows = []
for (const thread of threads) {
  const before = thread.chronicle ?? []
  await enrich(thread)
  const after = thread.chronicle ?? []
  const row = {
    headline: thread.context!.headline,
    root: thread.nodes.find((node) => node.id === thread.rootId)?.label,
    before: before.length, after: after.length,
    earliestBefore: before[0]?.at.iso ?? null, earliestAfter: after[0]?.at.iso ?? null,
    added: after.filter((entry) => entry.sourceTitle), note: thread.historyNote ?? null, partial: !!thread.partial,
  }
  rows.push(row)
  writeFileSync(output, `${JSON.stringify(rows, null, 2)}\n`)
  console.log(`${rows.length}/${threads.length} ${row.root}: ${row.earliestBefore} → ${row.earliestAfter} (+${row.added.length})`)
}
