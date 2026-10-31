/**
 * First-party analytics events for intoponet.com (Permagent). The website's
 * collector cleans each beacon (no IP, daily visitor hash, allowlisted UTM
 * fields) and forwards it here through the edge proxy; the Permagent daemon
 * drains them by id through the website's authenticated drain route.
 */

export type AnalyticsQuery = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

/** Events are kept this long; purge() runs from the daily retention trigger. */
export const ANALYTICS_RETENTION_DAYS = 90
export const DRAIN_DEFAULT_LIMIT = 500
export const DRAIN_MAX_LIMIT = 1000

export type AnalyticsEvent = {
  kind: 'pageview' | 'event'
  path: string
  referrer: string | null
  name: string | null
  visitorHash: string | null
  properties: Record<string, string | number | boolean> | null
  isBot: boolean
  sessionId: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  country: string | null
}

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length ? value.slice(0, max) : null)

/** Re-checks what the collector sent: this route trusts the edge secret, not the shape. */
export function parseEvent(value: unknown): AnalyticsEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row['kind'] !== 'pageview' && row['kind'] !== 'event') return null
  const path = text(row['path'], 512)
  if (!path) return null
  let properties: AnalyticsEvent['properties'] = null
  const raw = row['properties']
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const kept: Record<string, string | number | boolean> = {}
    for (const [key, item] of Object.entries(raw as Record<string, unknown>).slice(0, 32)) {
      if (typeof item === 'string') kept[key.slice(0, 64)] = item.slice(0, 256)
      else if ((typeof item === 'number' && Number.isFinite(item)) || typeof item === 'boolean') kept[key.slice(0, 64)] = item
    }
    if (Object.keys(kept).length) properties = kept
  }
  const country = text(row['country'], 2)
  return {
    kind: row['kind'],
    path,
    referrer: text(row['referrer'], 512),
    name: text(row['name'], 128),
    visitorHash: text(row['visitorHash'], 32),
    properties,
    isBot: row['isBot'] === true,
    sessionId: text(row['sessionId'], 64),
    utmSource: text(row['utmSource'], 256),
    utmMedium: text(row['utmMedium'], 256),
    utmCampaign: text(row['utmCampaign'], 256),
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
  }
}

export function createAnalytics(query: AnalyticsQuery) {
  return {
    async insert(event: AnalyticsEvent): Promise<void> {
      await query(
        `insert into permagent_analytics_events (kind, path, referrer, name, visitor_hash, properties, is_bot, session_id, utm_source, utm_medium, utm_campaign, country)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [event.kind, event.path, event.referrer, event.name, event.visitorHash, event.properties ? JSON.stringify(event.properties) : null,
          event.isBot, event.sessionId, event.utmSource, event.utmMedium, event.utmCampaign, event.country],
      )
    },
    /** Rows after the caller's cursor, oldest first: the drain's whole correctness story. */
    async drain(since: number, limit: number): Promise<Record<string, unknown>[]> {
      const rows = await query(
        `select id, kind, path, referrer, name, visitor_hash, created_at, properties, is_bot, session_id, utm_source, utm_medium, utm_campaign, country
         from permagent_analytics_events where id > $1 order by id asc limit $2`,
        [since, limit],
      )
      return rows.map((row) => ({
        id: Number(row['id']),
        kind: row['kind'],
        path: row['path'],
        referrer: row['referrer'] ?? null,
        name: row['name'] ?? null,
        visitorHash: row['visitor_hash'] ?? null,
        at: new Date(row['created_at'] as string | Date).toISOString(),
        properties: row['properties'] ?? null,
        isBot: row['is_bot'] === true,
        sessionId: row['session_id'] ?? null,
        utmSource: row['utm_source'] ?? null,
        utmMedium: row['utm_medium'] ?? null,
        utmCampaign: row['utm_campaign'] ?? null,
        country: row['country'] ?? null,
      }))
    },
    async purge(): Promise<number> {
      const rows = await query(`with gone as (delete from permagent_analytics_events where created_at < now() - make_interval(days => $1) returning 1) select count(*)::int as n from gone`, [ANALYTICS_RETENTION_DAYS])
      return Number(rows[0]?.['n'] ?? 0)
    },
  }
}

/** ?since=<id>&limit=<n>: a non-negative integer cursor and a limit capped at 1000. */
export function drainParams(search: URLSearchParams): { since: number; limit: number } | null {
  const sinceRaw = search.get('since') ?? '0'
  const limitRaw = search.get('limit') ?? String(DRAIN_DEFAULT_LIMIT)
  if (!/^\d{1,15}$/.test(sinceRaw) || !/^\d{1,6}$/.test(limitRaw)) return null
  return { since: Number(sinceRaw), limit: Math.max(1, Math.min(DRAIN_MAX_LIMIT, Number(limitRaw))) }
}
