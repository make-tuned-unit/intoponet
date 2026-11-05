import { describe, expect, it, vi } from 'vitest'
import { parseBrowsingCommand, type BrowsingEvent } from '@intoponet/browser-api'
import { classifyExternalUrl, displayTarget, ExternalOpenBroker, MAX_EXTERNAL_URL_LENGTH, parseRemembered } from './externalOpen'

describe('which links may open another app', () => {
  it.each([
    'mailto:someone@example.com?subject=Hi',
    'tel:+15551234567',
    'facetime:someone@example.com',
    'sms:+15551234567',
    'maps:?q=Halifax',
    'zoommtg://zoom.us/join?confno=123',
    'msteams:/l/meetup-join/abc',
    'slack://open?team=T1',
    'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    'webcal://example.com/cal.ics',
  ])('asks for %s', (url) => {
    expect(classifyExternalUrl(url).kind).toBe('external')
  })

  it('leaves web pages to the tab', () => {
    expect(classifyExternalUrl('https://example.com/').kind).toBe('web')
    expect(classifyExternalUrl('http://example.com/').kind).toBe('web')
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<b>x</b>',
    'blob:https://example.com/uuid',
    'about:blank',
    'chrome://settings',
    'chrome-extension://abc/x.html',
    'view-source:https://example.com',
    'smb://evil.example/share',
    'afp://evil.example/share',
    'ssh://evil.example',
    'x-man-page://ls',
    'shortcuts://run-shortcut?name=x',
    'itms-services://?action=download-manifest&url=https://x',
    'intoponet-capture://x',
  ])('refuses %s', (url) => {
    expect(classifyExternalUrl(url).kind).toBe('blocked')
  })

  it('refuses credentials, over-long links and nonsense', () => {
    expect(classifyExternalUrl('zoommtg://user:secret@zoom.us/join').kind).toBe('blocked')
    expect(classifyExternalUrl(`mailto:a@b.c?body=${'x'.repeat(MAX_EXTERNAL_URL_LENGTH)}`).kind).toBe('blocked')
    expect(classifyExternalUrl('not a url').kind).toBe('blocked')
    expect(classifyExternalUrl('').kind).toBe('blocked')
  })

  it('shortens what the prompt shows and strips direction tricks', () => {
    expect(displayTarget(`mailto:a@b.c?body=${'x'.repeat(300)}`).length).toBe(120)
    expect(displayTarget('tel:+1‮555')).toBe('tel:+1555')
  })
})

function broker(options: { remembered?: unknown; appName?: string; now?: () => number } = {}) {
  const events: BrowsingEvent[] = []
  const opened: string[] = []
  const saved: string[] = []
  const b = new ExternalOpenBroker({
    emit: (event) => events.push(event),
    openExternal: async (href) => { opened.push(href) },
    appName: () => options.appName ?? 'Mail',
    remembered: options.remembered,
    save: (data) => saved.push(data),
    ...(options.now ? { now: options.now } : {}),
  })
  const requests = () => events.flatMap((event) => (event.type === 'external-request' ? [event.request] : []))
  return { b, events, opened, saved, requests }
}

const page = 'https://shop.example/contact'

describe('asking before opening another app', () => {
  it('asks, and opens only after Open', () => {
    const { b, opened, requests } = broker()
    expect(b.request({ href: 'mailto:a@b.c', pageUrl: page, isPrivate: false, owner: 1 })).toBe('prompted')
    expect(opened).toEqual([])
    const [request] = requests()
    expect(request).toMatchObject({ scheme: 'mailto', appName: 'Mail', site: 'https://shop.example', isPrivate: false })
    b.decide(request!.id, 'open', false)
    expect(opened).toEqual(['mailto:a@b.c'])
    expect(b.list()).toEqual([])
  })

  it('opens nothing on Cancel', () => {
    const { b, opened, requests } = broker()
    b.request({ href: 'tel:123', pageUrl: page, isPrivate: false, owner: 1 })
    b.decide(requests()[0]!.id, 'cancel', false)
    expect(opened).toEqual([])
  })

  it('remembers "Always allow" per site and scheme', () => {
    const { b, opened, requests, saved } = broker()
    b.request({ href: 'mailto:a@b.c', pageUrl: page, isPrivate: false, owner: 1 })
    b.decide(requests()[0]!.id, 'open', true)
    expect(JSON.parse(saved.at(-1)!)).toEqual({ 'https://shop.example': ['mailto'] })
    expect(b.request({ href: 'mailto:x@y.z', pageUrl: page, isPrivate: false, owner: 2 })).toBe('opened')
    expect(opened).toEqual(['mailto:a@b.c', 'mailto:x@y.z'])
    // Another scheme, or another site, still asks.
    expect(b.request({ href: 'tel:1', pageUrl: page, isPrivate: false, owner: 3 })).toBe('prompted')
    expect(b.request({ href: 'mailto:a@b.c', pageUrl: 'https://other.example/', isPrivate: false, owner: 4 })).toBe('prompted')
  })

  it('remembers nothing from private tabs, and asks there even for remembered sites', () => {
    const { b, saved, requests } = broker({ remembered: { 'https://shop.example': ['mailto'] } })
    expect(b.request({ href: 'mailto:a@b.c', pageUrl: page, isPrivate: true, owner: 1 })).toBe('prompted')
    b.decide(requests()[0]!.id, 'open', true)
    expect(saved).toEqual([])
  })

  it('shows one prompt per page and no storms', () => {
    let now = 0
    const { b, requests } = broker({ now: () => now })
    expect(b.request({ href: 'tel:1', pageUrl: page, isPrivate: false, owner: 1 })).toBe('prompted')
    expect(b.request({ href: 'tel:2', pageUrl: page, isPrivate: false, owner: 1 })).toBe('dropped')
    b.decide(requests()[0]!.id, 'cancel', false)
    // Just cancelled: quiet for a while.
    expect(b.request({ href: 'tel:3', pageUrl: page, isPrivate: false, owner: 1 })).toBe('dropped')
    now += 6_000
    for (let i = 0; i < 3; i += 1) {
      expect(b.request({ href: `tel:${i}`, pageUrl: page, isPrivate: false, owner: 1 })).toBe('prompted')
      b.decide(requests().at(-1)!.id, 'open', false)
    }
    // Four in a minute is the limit.
    expect(b.request({ href: 'tel:9', pageUrl: page, isPrivate: false, owner: 1 })).toBe('dropped')
    now += 61_000
    expect(b.request({ href: 'tel:9', pageUrl: page, isPrivate: false, owner: 1 })).toBe('prompted')
  })

  it('limits how often a remembered site opens apps', () => {
    const { b, opened } = broker({ remembered: { 'https://shop.example': ['tel'] }, now: () => 0 })
    const results = Array.from({ length: 5 }, (_, i) => b.request({ href: `tel:${i}`, pageUrl: page, isPrivate: false, owner: 1 }))
    expect(results.filter((result) => result === 'opened')).toHaveLength(3)
    expect(opened).toHaveLength(3)
  })

  it('says so when no app opens the link, and refuses blocked ones silently', () => {
    expect(broker({ appName: '' }).b.request({ href: 'weird-app:x', pageUrl: page, isPrivate: false, owner: 1 })).toBe('no-app')
    expect(broker().b.request({ href: 'file:///etc/hosts', pageUrl: page, isPrivate: false, owner: 1 })).toBe('blocked')
  })

  it('withdraws a prompt when its page closes, and times out unanswered ones', () => {
    vi.useFakeTimers()
    try {
      const { b, events } = broker()
      b.request({ href: 'tel:1', pageUrl: page, isPrivate: false, owner: 1 })
      b.dropOwner(1)
      expect(b.list()).toEqual([])
      expect(events.at(-1)?.type).toBe('external-resolved')
      b.request({ href: 'tel:1', pageUrl: page, isPrivate: false, owner: 2 })
      vi.advanceTimersByTime(61_000)
      expect(b.list()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops damaged remembered entries', () => {
    expect(parseRemembered({ 'https://a.example': ['mailto', 'file', 7], 'not a site': ['tel'], 'https://b.example/path': ['tel'] })).toEqual({ 'https://a.example': ['mailto'] })
    expect(parseRemembered('nonsense')).toEqual({})
  })
})

describe('browsing commands from the shell', () => {
  it('accepts valid commands', () => {
    expect(parseBrowsingCommand({ type: 'external-decide', id: 'x', decision: 'open', always: true })).toEqual({ type: 'external-decide', id: 'x', decision: 'open', always: true })
    expect(parseBrowsingCommand({ type: 'external-decide', id: 'x', decision: 'cancel' })).toEqual({ type: 'external-decide', id: 'x', decision: 'cancel', always: false })
    expect(parseBrowsingCommand({ type: 'set-page-appearance', appearance: 'dark' })).toEqual({ type: 'set-page-appearance', appearance: 'dark' })
    expect(parseBrowsingCommand({ type: 'make-default-browser' })).toEqual({ type: 'make-default-browser' })
  })

  it.each([
    null,
    { type: 'external-decide', id: 'x', decision: 'maybe' },
    { type: 'external-decide', id: '', decision: 'open' },
    { type: 'external-decide', id: 'x', decision: 'open', always: 'yes' },
    { type: 'set-page-appearance', appearance: 'sepia' },
    { type: 'open-external', url: 'file:///' },
  ])('refuses %j', (value) => {
    expect(() => parseBrowsingCommand(value)).toThrow()
  })
})
