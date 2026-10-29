import type { PublicFieldStatus, PublicSourceHealth } from '@intoponet/browser-api'

const SOURCE_LABELS = { reading: 'Wikipedia reading', usgs: 'USGS', eonet: 'NASA EONET' } as const

function shortDate(value: string | null): string | null {
  if (!value) return null
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')}Z` : null
}

function describeSource(source: keyof typeof SOURCE_LABELS, health: PublicSourceHealth): string {
  const retrieved = shortDate(health.latestRecordRetrievedAt)
  const checked = shortDate(health.lastCheckedAt)
  const observation = shortDate(health.latestObservationAt)
  const records = `${health.recordCount} record${health.recordCount === 1 ? '' : 's'}`
  const observed = observation ? `; latest observation ${observation}` : ''
  switch (health.state) {
    case 'current':
      return health.recordCount
        ? `${SOURCE_LABELS[source]} checked ${checked ?? 'recently'}; ${records} collected ${retrieved ?? 'at check time'}${observed}`
        : `${SOURCE_LABELS[source]} checked ${checked ?? 'recently'}; no located records returned`
    case 'cached':
      return `${SOURCE_LABELS[source]} checked ${checked ?? 'time unknown'}; retained ${records}${retrieved ? ` collected ${retrieved}` : ''}${observed}`
    case 'not-due':
      return `${SOURCE_LABELS[source]} not due${checked ? ` (last checked ${checked})` : ''}; ${records}${retrieved ? ` collected ${retrieved}` : ''}${observed}`
    case 'failed':
      return `${SOURCE_LABELS[source]} check failed${checked ? ` ${checked}` : ''}; ${records} retained${retrieved ? ` from ${retrieved}` : ''}${observed}`
    case 'unavailable':
      return `${SOURCE_LABELS[source]} unavailable${checked ? ` (check failed ${checked})` : ''}; no records`
  }
}

/** A concise source-by-source disclosure for the existing coverage detail. */
export function formatPublicSourceHealth(status: PublicFieldStatus): string {
  if (status.mode !== 'local' || !status.sourceHealth) return ''
  return (Object.keys(SOURCE_LABELS) as Array<keyof typeof SOURCE_LABELS>)
    .map((source) => describeSource(source, status.sourceHealth![source]))
    .join(' · ')
}
