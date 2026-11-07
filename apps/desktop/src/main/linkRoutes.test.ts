import { describe, expect, it } from 'vitest'
import { addLinkRoute, moveLinkRoute, normalizeRouteSite, parseLinkRoutes, removeLinkRoute, routeFor, serializeLinkRoutes, siteOfWebUrl, updateLinkRoute, type LinkRoute } from './linkRoutes'

const exists = (...ids: string[]) => (id: string) => ids.includes(id)

describe('normalizeRouteSite', () => {
  it('lower-cases a host and drops a leading www.', () => {
    expect(normalizeRouteSite(' Docs.Example.COM ')).toBe('docs.example.com')
    expect(normalizeRouteSite('www.example.com')).toBe('example.com')
  })

  it('refuses ports, paths, schemes, IP addresses and junk', () => {
    for (const value of ['example.com:8080', 'example.com/path', 'https://example.com', '127.0.0.1', 'example', '', 'a b.com', '-bad.com', 'exa_mple.com', 42]) {
      expect(normalizeRouteSite(value), String(value)).toBeNull()
    }
  })

  it('accepts localhost', () => {
    expect(normalizeRouteSite('localhost')).toBe('localhost')
  })
})

describe('routeFor', () => {
  const rules: LinkRoute[] = [
    { id: 'a', site: 'example.com', workspaceId: 'work' },
    { id: 'b', site: 'docs.example.com', workspaceId: 'docs' },
  ]

  it('matches the site and its subdomains, not a site that only ends the same way', () => {
    expect(routeFor('https://example.com/x', rules, exists('work', 'docs'))).toBe('work')
    expect(routeFor('https://api.example.com/x', rules, exists('work', 'docs'))).toBe('work')
    expect(routeFor('https://notexample.com/', rules, exists('work', 'docs'))).toBeNull()
    expect(routeFor('https://example.com.evil.net/', rules, exists('work', 'docs'))).toBeNull()
  })

  it('takes the first matching rule', () => {
    expect(routeFor('https://docs.example.com/', rules, exists('work', 'docs'))).toBe('work')
    expect(routeFor('https://docs.example.com/', [rules[1]!, rules[0]!], exists('work', 'docs'))).toBe('docs')
  })

  it('skips a rule whose workspace is gone', () => {
    expect(routeFor('https://docs.example.com/', rules, exists('docs'))).toBe('docs')
    expect(routeFor('https://docs.example.com/', rules, exists())).toBeNull()
  })

  it('ignores non-web addresses and ports, and matches no site without a rule', () => {
    expect(routeFor('mailto:someone@example.com', rules, exists('work'))).toBeNull()
    expect(routeFor('http://localhost:3000/', [{ id: 'l', site: 'localhost', workspaceId: 'w' }], exists('w'))).toBe('w')
    expect(routeFor('http://127.0.0.1/', [{ id: 'l', site: 'localhost', workspaceId: 'w' }], exists('w'))).toBeNull()
  })

  it('names the site of a page', () => {
    expect(siteOfWebUrl('https://www.Docs.example.com/a?b=1')).toBe('docs.example.com')
    expect(siteOfWebUrl('http://127.0.0.1:8080/')).toBeNull()
  })
})

describe('parseLinkRoutes and serializeLinkRoutes', () => {
  it('round-trips the rules', () => {
    const rules: LinkRoute[] = [{ id: 'a', site: 'example.com', workspaceId: 'work' }]
    expect(parseLinkRoutes(JSON.parse(serializeLinkRoutes(rules)))).toEqual(rules)
  })

  it('gives no rules for a damaged file, and skips bad rules', () => {
    expect(parseLinkRoutes(null)).toEqual([])
    expect(parseLinkRoutes({ version: 2, rules: [{ id: 'a', site: 'example.com', workspaceId: 'w' }] })).toEqual([])
    expect(parseLinkRoutes({ version: 1, rules: 'nope' })).toEqual([])
    expect(parseLinkRoutes({
      version: 1,
      rules: [
        { id: 'a', site: 'example.com/path', workspaceId: 'w' },
        { id: 'b', site: 'example.com', workspaceId: 'w' },
        { id: 'b', site: 'other.com', workspaceId: 'w' },
        { id: 'c', site: '127.0.0.1', workspaceId: 'w' },
        { id: 'd', site: 'ok.com' },
      ],
    })).toEqual([{ id: 'b', site: 'example.com', workspaceId: 'w' }])
  })
})

describe('rule edits', () => {
  const base: LinkRoute[] = [
    { id: 'a', site: 'example.com', workspaceId: 'work' },
    { id: 'b', site: 'news.test', workspaceId: 'news' },
  ]

  it('adds a rule, and a second rule for the same site moves the first', () => {
    const added = addLinkRoute(base, { site: 'Mail.example.org', workspaceId: 'work', id: 'c' }, exists('work', 'news'))
    expect(added?.rule).toEqual({ id: 'c', site: 'mail.example.org', workspaceId: 'work' })
    expect(added?.rules.map((rule) => rule.id)).toEqual(['a', 'b', 'c'])
    const moved = addLinkRoute(base, { site: 'example.com', workspaceId: 'news', id: 'x' }, exists('work', 'news'))
    expect(moved?.rules).toEqual([{ id: 'a', site: 'example.com', workspaceId: 'news' }, base[1]])
  })

  it('refuses an unknown workspace, a bad site and a full list', () => {
    expect(addLinkRoute(base, { site: 'a.com', workspaceId: 'gone', id: 'c' }, exists('work'))).toBeNull()
    expect(addLinkRoute(base, { site: 'a.com/x', workspaceId: 'work', id: 'c' }, exists('work'))).toBeNull()
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, site: `s${i}.com`, workspaceId: 'work' }))
    expect(addLinkRoute(full, { site: 'extra.com', workspaceId: 'work', id: 'x' }, exists('work'))).toBeNull()
  })

  it('updates a site or workspace, and refuses a clash with another rule', () => {
    expect(updateLinkRoute(base, 'a', { workspaceId: 'news' }, exists('work', 'news'))).toEqual([{ id: 'a', site: 'example.com', workspaceId: 'news' }, base[1]])
    expect(updateLinkRoute(base, 'a', { site: 'news.test' }, exists('work', 'news'))).toBeNull()
    expect(updateLinkRoute(base, 'a', { site: 'bad site' }, exists('work', 'news'))).toBeNull()
    expect(updateLinkRoute(base, 'zzz', { site: 'x.com' }, exists('work', 'news'))).toBeNull()
  })

  it('moves a rule so that it wins first, and removes one', () => {
    expect(moveLinkRoute(base, 'b', 0)?.map((rule) => rule.id)).toEqual(['b', 'a'])
    expect(moveLinkRoute(base, 'a', 5)?.map((rule) => rule.id)).toEqual(['b', 'a'])
    expect(moveLinkRoute(base, 'nope', 0)).toBeNull()
    expect(removeLinkRoute(base, 'a')).toEqual([base[1]])
    expect(removeLinkRoute(base, 'nope')).toBeNull()
  })
})
