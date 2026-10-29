import { describe, expect, it } from 'vitest'
import type { PublicFieldStatus } from '@intoponet/browser-api'
import { formatPublicSourceHealth } from './publicFieldStatus'

const localStatus: PublicFieldStatus = {
  mode: 'local', sourceLabel: 'Wikipedia · USGS · NASA EONET', configuredOrigin: null,
  state: 'stale', evaluationTime: '2026-10-29T12:00:00.000Z', message: 'Some sources failed.',
  sourceHealth: {
    reading: { state: 'not-due', lastCheckedAt: '2026-10-29T09:00:00.000Z', latestRecordRetrievedAt: '2026-10-29T09:00:00.000Z', latestObservationAt: '20261028', recordCount: 42 },
    usgs: { state: 'failed', lastCheckedAt: '2026-10-29T12:00:00.000Z', latestRecordRetrievedAt: '2026-10-29T09:00:00.000Z', latestObservationAt: '2026-10-29T10:00:00.000Z', recordCount: 12 },
    eonet: { state: 'current', lastCheckedAt: '2026-10-29T12:00:00.000Z', latestRecordRetrievedAt: '2026-10-29T12:00:00.000Z', latestObservationAt: null, recordCount: 0 },
  },
}

describe('public field source health disclosure', () => {
  it('distinguishes not-due and failed checks from newly collected records', () => {
    const note = formatPublicSourceHealth(localStatus)
    expect(note).toContain('Wikipedia reading not due')
    expect(note).toContain('latest observation 2026-10-28')
    expect(note).toContain('USGS check failed')
    expect(note).toContain('12 records retained')
    expect(note).toContain('NASA EONET checked')
    expect(note).toContain('no located records returned')
  })

  it('does not append local source checks to a shared artifact status', () => {
    expect(formatPublicSourceHealth({ ...localStatus, mode: 'shared' })).toBe('')
  })
})
