import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createAtomicFeedStorage, FeedFetchService, type FeedRegistrySource } from '../../apps/desktop/src/main/feed-service'
import { createAtomicIngestionStorage, ingestPublicFeedBatch, type AdmittedIngestionSource } from '../../apps/desktop/src/main/public-feed-ingestion'

type ResearchSource = Record<string, unknown> & {
  sourceId: string
  kind: 'rss' | 'atom'
  url: string
  publisherName: string
  languageTags: string[]
  declaredCoverage: { countryCodes: string[]; regionIds: string[]; cityIds: string[] }
  geographicScope: AdmittedIngestionSource['geographicScope']
  independentPublisherGroupId: string
  candidateState: string
  licenseStatus: string
  approvedFields: string[]
  termsUrl: string
  licenseUrl: string
  attribution: string
  termsEvidence: string
  retentionStatus: string
  proposedPollingMinSeconds: number
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function usage(): never {
  console.error('Usage: node experiments/public-feed-pilot/run.mjs --source-id <admitted-id> --data-dir <dedicated-dir> --enable-live')
  process.exit(2)
}

async function run(): Promise<void> {
  const sourceId = argument('--source-id')
  const dataDirArg = argument('--data-dir')
  const enableLive = process.argv.includes('--enable-live')
  const fixture = process.argv.includes('--fixture')
  if (!sourceId || !dataDirArg || (!fixture && !enableLive)) usage()
  const dataDir = resolve(dataDirArg)
  if (/(?:^|[/\\])(?:Default|Profile\s*\d*|User Data|Chrome|Chromium|Firefox)(?:[/\\]|$)/i.test(dataDir)) {
    throw new Error('Choose a dedicated public-feed data directory, not a browser profile path.')
  }
  const registryPath = resolve(process.cwd(), 'docs/data/public-source-registry.json')
  const registryDoc = JSON.parse(await (await import('node:fs/promises')).readFile(registryPath, 'utf8')) as { sources: ResearchSource[] }
  const research = registryDoc.sources.find((source) => source.sourceId === sourceId)
  if (!research) throw new Error(`Unknown source ID ${sourceId}.`)
  if (research.licenseStatus !== 'approved' || research.candidateState !== 'admitted-disabled' ||
      !research.recommendedDecision || (research.recommendedDecision as { status?: string }).status !== 'approve-scoped-metadata-pilot') {
    throw new Error(`Source ${sourceId} is not the specifically admitted metadata pilot.`)
  }
  const approvedFields = research.approvedFields
  const required = ['title', 'canonicalItemUrl', 'guid', 'publishedAt']
  if (!required.every((field) => approvedFields.includes(field))) throw new Error('Research registry does not approve the required metadata fields.')
  const source: AdmittedIngestionSource = {
    sourceId: research.sourceId,
    kind: research.kind,
    url: fixture ? (argument('--feed-url') ?? usage()) : research.url,
    publisherName: research.publisherName,
    languageTags: research.languageTags,
    candidateState: 'admitted-enabled', // one-shot opt-in only; research registry remains disabled
    licenseStatus: 'approved',
    approvedFields,
    proposedPollingMinSeconds: research.proposedPollingMinSeconds,
    activePollingMinSeconds: 300,
    retentionDays: 30,
    independentPublisherGroupId: research.independentPublisherGroupId,
    declaredCoverage: research.declaredCoverage,
    geographicScope: research.geographicScope,
    termsUrl: research.termsUrl,
    licenseUrl: research.licenseUrl,
    attribution: research.attribution,
    rightsEvidence: research.termsEvidence,
  }
  const service = new FeedFetchService({
    registry: { enabledSourceIds: [sourceId], sources: [source as FeedRegistrySource] },
    storage: createAtomicFeedStorage(resolve(dataDir, 'fetch-cache.v1.json')),
    mode: fixture ? 'fixture' : 'production',
    fetchImpl: (async (...args: Parameters<typeof fetch>) => {
      const response = await fetch(...args)
      observedHttpStatus = response.status
      return response
    }) as typeof fetch,
  })
  await mkdir(dataDir, { recursive: true })
  const startedAt = new Date().toISOString()
  const result = await service.refreshSource(sourceId)
  const completedAt = new Date().toISOString()
  const fetchSnapshot = await service.snapshot()
  const historyStorage = createAtomicIngestionStorage(resolve(dataDir, 'history.v1.json'))
  const artifact = await ingestPublicFeedBatch({
    sources: [source],
    results: [result],
    fetchStates: fetchSnapshot.sources,
    storage: historyStorage,
  })
  const runEvidence = {
    startedAt,
    completedAt,
    sourceId,
    sourceUrl: source.url,
    httpStatus: observedHttpStatus,
    fetchStatus: result.status,
    health: result.health,
    receivedItems: result.receivedItems.length,
    retainedItems: artifact.history.items.length,
    persistenceAllowed: result.persistenceAllowed,
  }
  const manifest = { ...artifact, runEvidence }
  await createAtomicIngestionStorage(resolve(dataDir, 'ingestion-manifest.v1.json')).write(JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ ...runEvidence, output: resolve(dataDir, 'ingestion-manifest.v1.json') }, null, 2))
  if (result.status === 'error') process.exitCode = 1
}

let observedHttpStatus: number | null = null

if (process.env.INTOPONET_PUBLIC_FEED_PILOT_ENTRY === '1') {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Public feed pilot failed.')
    process.exitCode = 1
  })
}
