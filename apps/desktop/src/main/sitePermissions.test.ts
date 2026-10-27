import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describePermissionKinds, parseSitePermissionCommand, type SitePermissionEvent } from '@intoponet/browser-api'
import { kindsFor, originOf, SitePermissionBroker, SitePermissionStore } from './sitePermissions'
import { popupPlan, PopupLimiter } from './popups'

describe('permission mapping', () => {
  it('maps Chromium permissions to what we ask about', () => {
    expect(kindsFor('media', ['video', 'audio'])).toEqual(['camera', 'microphone'])
    expect(kindsFor('media', ['audio'])).toEqual(['microphone'])
    expect(kindsFor('geolocation')).toEqual(['location'])
    expect(kindsFor('fullscreen')).toBe('always')
    expect(kindsFor('midiSysex')).toBeNull()
    expect(kindsFor('openExternal')).toBeNull()
    expect(originOf('https://meet.google.com/abc-def')).toBe('https://meet.google.com')
    expect(originOf('file:///etc/passwd')).toBeNull()
    expect(describePermissionKinds(['camera', 'microphone'])).toBe('use your camera and microphone')
    expect(describePermissionKinds(['notifications'])).toBe('show notifications')
  })
  it('parses commands strictly', () => {
    expect(parseSitePermissionCommand({ type: 'decide', id: 'x', decision: 'allow' })).toEqual({ type: 'decide', id: 'x', decision: 'allow' })
    expect(() => parseSitePermissionCommand({ type: 'decide', id: 'x', decision: 'always' })).toThrow()
    expect(() => parseSitePermissionCommand({ type: 'list', origin: 'https://a.test/path' })).toThrow()
    expect(() => parseSitePermissionCommand({ type: 'reset', origin: 'https://a.test', kind: 'usb' })).toThrow()
  })
})

describe('permission broker', () => {
  const setup = () => {
    const events: SitePermissionEvent[] = []
    const normal = new SitePermissionStore(null)
    const priv = new SitePermissionStore(null)
    const broker = new SitePermissionBroker({ store: (p) => (p ? priv : normal), emit: (event) => events.push(event), timeoutMs: 50 })
    return { events, normal, priv, broker }
  }
  it('asks once, remembers Allow, and answers later requests from storage', async () => {
    const { events, normal, broker } = setup()
    const answers: boolean[] = []
    broker.request({ origin: 'https://meet.test', kinds: ['camera', 'microphone'], isPrivate: false, owner: 1 }, (granted) => answers.push(granted))
    broker.request({ origin: 'https://meet.test', kinds: ['camera', 'microphone'], isPrivate: false, owner: 1 }, (granted) => answers.push(granted))
    expect(events.filter((event) => event.type === 'request')).toHaveLength(1)
    const id = (events[0] as Extract<SitePermissionEvent, { type: 'request' }>).request.id
    await broker.decide(id, 'allow')
    expect(answers).toEqual([true, true])
    expect(normal.get('https://meet.test')).toEqual({ camera: 'allow', microphone: 'allow' })
    broker.request({ origin: 'https://meet.test', kinds: ['camera'], isPrivate: false, owner: 2 }, (granted) => answers.push(granted))
    expect(answers.at(-1)).toBe(true)
  })
  it('Block is remembered; Not now is not; a blocked kind wins', async () => {
    const { events, normal, broker } = setup()
    const answers: boolean[] = []
    broker.request({ origin: 'https://a.test', kinds: ['location'], isPrivate: false, owner: 1 }, (granted) => answers.push(granted))
    await broker.decide((events[0] as Extract<SitePermissionEvent, { type: 'request' }>).request.id, 'dismiss')
    expect(normal.get('https://a.test')).toEqual({})
    broker.request({ origin: 'https://a.test', kinds: ['location'], isPrivate: false, owner: 1 }, (granted) => answers.push(granted))
    const second = events.filter((event) => event.type === 'request')[1] as Extract<SitePermissionEvent, { type: 'request' }>
    await broker.decide(second.request.id, 'block')
    expect(answers).toEqual([false, false])
    expect(broker.check('https://a.test', ['location'], false)).toBe(false)
  })
  it('private answers stay out of the saved store; unanswered prompts time out; navigation drops them', async () => {
    const { events, normal, priv, broker } = setup()
    const answers: boolean[] = []
    broker.request({ origin: 'https://p.test', kinds: ['camera'], isPrivate: true, owner: 3 }, (granted) => answers.push(granted))
    await broker.decide((events[0] as Extract<SitePermissionEvent, { type: 'request' }>).request.id, 'allow')
    expect(priv.get('https://p.test')).toEqual({ camera: 'allow' })
    expect(normal.get('https://p.test')).toEqual({})
    broker.request({ origin: 'https://t.test', kinds: ['camera'], isPrivate: false, owner: 4 }, (granted) => answers.push(granted))
    broker.request({ origin: 'https://n.test', kinds: ['camera'], isPrivate: false, owner: 5 }, (granted) => answers.push(granted))
    broker.dropOwner(5)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(answers).toEqual([true, false, false])
    expect(broker.list()).toEqual([])
  })
  it('saves answers to a private file and reads them back', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'perm-')), 'site-permissions.json')
    new SitePermissionStore(file).set('https://a.test', ['notifications'], 'block')
    expect(new SitePermissionStore(file).get('https://a.test')).toEqual({ notifications: 'block' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'https://a.test': { notifications: 'block' } })
  })
})

describe('popups', () => {
  it('opens sign-in popups as windows, new-tab links as tabs, and refuses other schemes', () => {
    expect(popupPlan({ url: 'https://accounts.google.com/o/oauth2', disposition: 'new-window', features: 'width=500,height=600' })).toEqual({ action: 'window', width: 500, height: 600 })
    expect(popupPlan({ url: 'about:blank', disposition: 'new-window', features: '' })).toEqual({ action: 'window', width: 520, height: 680 })
    expect(popupPlan({ url: 'https://news.test/a', disposition: 'foreground-tab', features: '' })).toEqual({ action: 'tab', background: false })
    expect(popupPlan({ url: 'https://news.test/a', disposition: 'background-tab', features: '' })).toEqual({ action: 'tab', background: true })
    expect(popupPlan({ url: 'javascript:alert(1)', disposition: 'new-window', features: '' }).action).toBe('deny')
    expect(popupPlan({ url: 'https://x.test', disposition: 'new-window', features: 'width=5000,height=10' })).toEqual({ action: 'window', width: 1200, height: 320 })
  })
  it('stops bursts of popups', () => {
    const limiter = new PopupLimiter(3, 10_000)
    expect([1, 2, 3, 4].map((i) => limiter.allow(7, 1000 + i))).toEqual([true, true, true, false])
    expect(limiter.allow(7, 20_000)).toBe(true)
  })
})
