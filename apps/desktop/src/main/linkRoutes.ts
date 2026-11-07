import { LINK_ROUTE_SITE_MAX } from '@intoponet/browser-api'

/**
 * Links go where they belong: a rule sends links from other apps to a workspace by site. A rule for
 * `example.com` matches example.com and any subdomain, never a site that merely ends the same way.
 * Rules are kept in link-routes.json in userData (so on this Mac, and in backups), first match wins,
 * and a rule whose workspace is gone is skipped. macOS does not say which app opened a link, so
 * rules never depend on the source app.
 */

export const LINK_ROUTES_VERSION = 1
export const MAX_LINK_ROUTES = 100

export type LinkRoute = { id: string; site: string; workspaceId: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const SITE_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80

/**
 * A host a rule can name: lower case, without a leading `www.`. Ports, paths, schemes, IP addresses
 * and anything else that is not a host name are refused (null). `localhost` is the one name without a dot.
 */
export function normalizeRouteSite(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let site = value.trim().toLowerCase()
  if (site.startsWith('www.')) site = site.slice(4)
  if (site.length === 0 || site.length > LINK_ROUTE_SITE_MAX) return null
  if (site === 'localhost') return site
  const labels = site.split('.')
  if (labels.length < 2 || labels.some((label) => !SITE_LABEL.test(label))) return null
  // A top-level domain is letters only, so `127.0.0.1` is refused.
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1]!)) return null
  return site
}

/** The lower-case host of a web address, or null for anything that is not http(s). */
export function hostOfWebUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** The site a page's address would be filed under, as a rule would name it. */
export function siteOfWebUrl(url: string): string | null {
  const host = hostOfWebUrl(url)
  return host ? normalizeRouteSite(host) : null
}

export function routeMatchesHost(site: string, host: string): boolean {
  return host === site || host.endsWith(`.${site}`)
}

/** The workspace of the first rule that matches the address and whose workspace still exists; null when none does. */
export function routeFor(url: string, rules: readonly LinkRoute[], workspaceExists: (id: string) => boolean): string | null {
  const host = hostOfWebUrl(url)
  if (!host) return null
  for (const rule of rules) {
    if (routeMatchesHost(rule.site, host) && workspaceExists(rule.workspaceId)) return rule.workspaceId
  }
  return null
}

/** Reads the saved file. A damaged file, or a bad rule in it, gives fewer rules, never an error. */
export function parseLinkRoutes(value: unknown): LinkRoute[] {
  if (!isRecord(value) || value['version'] !== LINK_ROUTES_VERSION || !Array.isArray(value['rules'])) return []
  const rules: LinkRoute[] = []
  const ids = new Set<string>()
  for (const item of value['rules']) {
    if (rules.length >= MAX_LINK_ROUTES) break
    if (!isRecord(item) || !isId(item['id']) || !isId(item['workspaceId']) || ids.has(item['id'])) continue
    const site = normalizeRouteSite(item['site'])
    if (!site) continue
    ids.add(item['id'])
    rules.push({ id: item['id'], site, workspaceId: item['workspaceId'] })
  }
  return rules
}

export function serializeLinkRoutes(rules: readonly LinkRoute[]): string {
  return JSON.stringify({ version: LINK_ROUTES_VERSION, rules }, null, 2) + '\n'
}

/**
 * Adds a rule for the site, or, when the site already has one, moves that rule to the workspace
 * (keeping its place). Null when the site is not a host, the workspace is unknown, or the list is full.
 */
export function addLinkRoute(
  rules: readonly LinkRoute[],
  input: { site: unknown; workspaceId: string; id: string },
  workspaceExists: (id: string) => boolean,
): { rules: LinkRoute[]; rule: LinkRoute } | null {
  const site = normalizeRouteSite(input.site)
  if (!site || !workspaceExists(input.workspaceId)) return null
  const existing = rules.find((rule) => rule.site === site)
  if (existing) {
    const rule = { ...existing, workspaceId: input.workspaceId }
    return { rules: rules.map((item) => (item.id === existing.id ? rule : item)), rule }
  }
  if (rules.length >= MAX_LINK_ROUTES) return null
  const rule = { id: input.id, site, workspaceId: input.workspaceId }
  return { rules: [...rules, rule], rule }
}

/** Changes a rule's site or workspace. Null when the rule is unknown, the site is not a host, or the workspace is unknown. */
export function updateLinkRoute(
  rules: readonly LinkRoute[],
  id: string,
  changes: { site?: unknown; workspaceId?: string | undefined },
  workspaceExists: (id: string) => boolean,
): LinkRoute[] | null {
  const current = rules.find((rule) => rule.id === id)
  if (!current) return null
  const site = changes.site === undefined ? current.site : normalizeRouteSite(changes.site)
  if (!site) return null
  const workspaceId = changes.workspaceId ?? current.workspaceId
  if (!workspaceExists(workspaceId)) return null
  // Another rule already names this site: the two would be one, so the edit is refused.
  if (rules.some((rule) => rule.id !== id && rule.site === site)) return null
  return rules.map((rule) => (rule.id === id ? { id, site, workspaceId } : rule))
}

/** Moves a rule to a position in the order (0 is first, and wins first). Null when the rule is unknown. */
export function moveLinkRoute(rules: readonly LinkRoute[], id: string, toIndex: number): LinkRoute[] | null {
  const from = rules.findIndex((rule) => rule.id === id)
  if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0) return null
  const next = rules.filter((rule) => rule.id !== id)
  next.splice(Math.min(toIndex, next.length), 0, rules[from]!)
  return next
}

export function removeLinkRoute(rules: readonly LinkRoute[], id: string): LinkRoute[] | null {
  return rules.some((rule) => rule.id === id) ? rules.filter((rule) => rule.id !== id) : null
}
