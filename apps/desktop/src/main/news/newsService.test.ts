import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchOrder, newsFeedEntries, observeNewsCoverage, readCachedNewsDigest, readCoverage } from './newsService'
import { NEWS_COVERAGE_TOLERANCE_MS, type CoverageIntervals } from '../../shared/news/newsDigest'

const h = 60 * 60 * 1000

describe('news observation coverage', () => {
  it('does not treat old RSS publication dates as observed history after startup', () => {
    const coverage: CoverageIntervals = {}
    const lastFetch = new Map<string, number>()
    const now = Date.parse('2026-10-29T12:00:00Z')

    observeNewsCoverage({
      sourceId: 'feed-a', status: 'updated', persistenceAllowed: true,
    }, coverage, lastFetch, now)

    expect(coverage['feed-a']).toEqual([[now, now]])
  })

  it('breaks continuity on a failed poll; a later 304 only resumes from that poll', () => {
    const before = Date.parse('2026-10-27T12:00:00Z')
    const failedAt = before + h
    const resumedAt = failedAt + 36 * h
    const coverage: CoverageIntervals = { 'feed-a': [[before - 4 * h, before]] }
    const lastFetch = new Map([['feed-a', before]])

    observeNewsCoverage({ sourceId: 'feed-a', status: 'error', persistenceAllowed: true }, coverage, lastFetch, failedAt)
    observeNewsCoverage({ sourceId: 'feed-a', status: 'not-modified', persistenceAllowed: true }, coverage, lastFetch, resumedAt)

    expect(lastFetch.get('feed-a')).toBe(resumedAt)
    expect(coverage['feed-a']).toEqual([[before - 4 * h, before], [resumedAt, resumedAt]])
  })

  it('does not bridge a long same-process pause beyond the coverage tolerance', () => {
    const before = Date.parse('2026-10-27T12:00:00Z')
    const resumedAt = before + 2 * h
    const coverage: CoverageIntervals = { 'feed-a': [[before - 48 * h, before]] }
    const lastFetch = new Map([['feed-a', before]])

    observeNewsCoverage({ sourceId: 'feed-a', status: 'updated', persistenceAllowed: true }, coverage, lastFetch, resumedAt)

    expect(coverage['feed-a']).toEqual([[before - 48 * h, before], [resumedAt, resumedAt]])
  })

  it('invalidates future-dated coverage and avoids an inverted span after a clock rollback', () => {
    const previous = Date.parse('2026-10-29T12:00:00Z')
    const now = previous - h
    const coverage: CoverageIntervals = { 'feed-a': [[previous - 10 * h, previous]] }
    const lastFetch = new Map([['feed-a', previous]])

    observeNewsCoverage({ sourceId: 'feed-a', status: 'updated', persistenceAllowed: true }, coverage, lastFetch, now)

    expect(coverage['feed-a']).toEqual([[now, now]])
    expect(lastFetch.get('feed-a')).toBe(now)
  })

  it('does not persist no-store observations or carry continuity through them', () => {
    const before = Date.parse('2026-10-29T10:00:00Z')
    const now = before + h
    const coverage: CoverageIntervals = { 'feed-a': [[before - 48 * h, before]] }
    const lastFetch = new Map([['feed-a', before]])

    observeNewsCoverage({ sourceId: 'feed-a', status: 'updated', persistenceAllowed: false }, coverage, lastFetch, now)

    expect(coverage).toEqual({ 'feed-a': [] })
    expect(lastFetch.has('feed-a')).toBe(false)
  })

  it('rejects legacy inferred coverage and reads only the versioned observation envelope', () => {
    const directory = mkdtempSync(join(tmpdir(), 'news-coverage-'))
    try {
      const path = join(directory, 'news-coverage.json')
      const now = Date.parse('2026-10-29T12:00:00Z')
      const legacy = { 'feed-a': [[now - h, now]] }
      writeFileSync(path, JSON.stringify(legacy))
      expect(readCoverage(path, new Set(['feed-a']), now)).toEqual({})

      writeFileSync(path, JSON.stringify({ schemaVersion: 2, sources: legacy }))
      expect(readCoverage(path, new Set(['feed-a']), now)).toEqual(legacy)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('emits only a current same-version cached digest before a fresh publish', () => {
    const directory = mkdtempSync(join(tmpdir(), 'news-digest-'))
    try {
      const path = join(directory, 'news-digest.json')
      const now = Date.now()
      const base = {
        schema: 'intoponet.news-digest.v1', generatedAt: new Date(now).toISOString(),
        windowHours: 48, feedCount: 0, healthyFeedCount: 0, countries: [], places: [], quietCountryCodes: [], rising: [],
      }
      writeFileSync(path, JSON.stringify(base))
      expect(readCachedNewsDigest(path)).toBeNull()

      const current = JSON.stringify({ ...base, coverageSchemaVersion: 2 })
      writeFileSync(path, current)
      expect(readCachedNewsDigest(path, now)).toBe(current)

      const stale = JSON.stringify({ ...base, generatedAt: new Date(now - NEWS_COVERAGE_TOLERANCE_MS - 1).toISOString(), coverageSchemaVersion: 2 })
      writeFileSync(path, stale)
      expect(readCachedNewsDigest(path, now)).toBeNull()

      const future = JSON.stringify({ ...base, generatedAt: new Date(now + 60_001).toISOString(), coverageSchemaVersion: 2 })
      writeFileSync(path, future)
      expect(readCachedNewsDigest(path, now)).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('news fetch order', () => {
  it('reaches every country early instead of going through the alphabet', () => {
    const feeds = newsFeedEntries()
    const order = fetchOrder(feeds)
    expect(order).toHaveLength(feeds.length)
    expect(new Set(order.map((feed) => feed.sourceId)).size).toBe(feeds.length)
    const countries = new Set(feeds.filter((feed) => feed.geographicScope !== 'international').map((feed) => feed.countryCode))
    const desks = feeds.filter((feed) => feed.geographicScope === 'international').length
    // One full turn: every country's first feed comes before any country's second.
    const firstTurn = new Set(order.slice(desks, desks + countries.size).map((feed) => feed.countryCode))
    expect(firstTurn.size).toBe(countries.size)
    const us = order.findIndex((feed) => feed.countryCode === 'US' && feed.geographicScope !== 'international')
    expect(us).toBeLessThan(desks + countries.size)
    expect(order[us]!.geographicScope).toBe('national')
  })
})
