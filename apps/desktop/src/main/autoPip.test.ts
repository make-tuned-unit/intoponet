import { describe, expect, it } from 'vitest'
import { ENTER_PIP_SCRIPT, EXIT_PIP_SCRIPT, NowPlaying, PAUSE_ALL_MEDIA_SCRIPT, TOGGLE_PLAYBACK_SCRIPT } from './autoPip'

const info = (titles: Record<string, { title: string; muted?: boolean }>) => (id: string) => (titles[id] ? { title: titles[id].title, muted: titles[id].muted ?? false } : null)
const titles = { a: { title: 'Film' }, b: { title: 'Talk' }, shown: { title: 'Here' } }

describe('NowPlaying', () => {
  it('lists nothing when no tab plays', () => {
    expect(new NowPlaying().snapshot('shown', info(titles))).toBeNull()
  })

  it('lists a playing tab that is not the one in front', () => {
    const now = new NowPlaying()
    now.update('a', { playing: true }, 1)
    now.update('shown', { playing: true }, 2)
    expect(now.snapshot('shown', info(titles))).toEqual({ tabId: 'a', title: 'Film', playing: true, muted: false, pip: false })
  })

  it('prefers the most recently started of the other tabs', () => {
    const now = new NowPlaying()
    now.update('a', { playing: true }, 1)
    now.update('b', { playing: true }, 5)
    expect(now.snapshot('shown', info(titles))?.tabId).toBe('b')
  })

  it('shows the tab in front only when no other tab is listed', () => {
    const now = new NowPlaying()
    now.update('shown', { playing: true }, 1)
    expect(now.snapshot('shown', info(titles))?.tabId).toBe('shown')
  })

  it('keeps a floating tab listed after its playback stops, and reports it as floating', () => {
    const now = new NowPlaying()
    now.update('a', { playing: true, pip: true }, 1)
    now.update('a', { playing: false }, 2)
    expect(now.snapshot('shown', info(titles))).toMatchObject({ tabId: 'a', playing: false, pip: true })
  })

  it('keeps a tab the control paused so it can be played again, and drops it once that hold ends', () => {
    const now = new NowPlaying()
    now.update('a', { playing: true }, 1)
    now.update('a', { playing: false, held: true }, 2)
    expect(now.snapshot('shown', info(titles))).toMatchObject({ tabId: 'a', playing: false })
    now.update('a', { held: false }, 3)
    expect(now.snapshot('shown', info(titles))).toBeNull()
  })

  it('forgets a tab that closed', () => {
    const now = new NowPlaying()
    now.update('a', { playing: true }, 1)
    now.forget('a')
    expect(now.snapshot('shown', info(titles))).toBeNull()
  })

  it('ignores a listed tab whose info is gone', () => {
    const now = new NowPlaying()
    now.update('a', { playing: true }, 1)
    expect(now.snapshot('shown', info({}))).toBeNull()
  })

  it('reports mute from the tab', () => {
    const now = new NowPlaying()
    now.update('a', { playing: true }, 1)
    expect(now.snapshot('shown', info({ a: { title: 'Film', muted: true } }))?.muted).toBe(true)
  })
})

describe('picture-in-picture scripts', () => {
  it('only floats a playing, loaded, visible video that allows it', () => {
    expect(ENTER_PIP_SCRIPT).toContain('disablePictureInPicture')
    expect(ENTER_PIP_SCRIPT).toContain('video.paused')
    expect(ENTER_PIP_SCRIPT).toContain('readyState < 2')
    expect(ENTER_PIP_SCRIPT).toContain('requestPictureInPicture()')
  })

  it('reports refusals rather than throwing', () => {
    expect(ENTER_PIP_SCRIPT).toContain("return 'refused'")
    expect(EXIT_PIP_SCRIPT).toContain('exitPictureInPicture')
    expect(TOGGLE_PLAYBACK_SCRIPT).toContain("'paused'")
  })
})

describe('pausing all media (the app window closed)', () => {
  type FakeMedia = { paused: boolean; pause: () => void }
  const media = (playing: boolean): FakeMedia => {
    const item: FakeMedia = { paused: !playing, pause: () => { item.paused = true } }
    return item
  }
  const root = (items: FakeMedia[], hosts: Array<{ shadowRoot: unknown }> = []) => ({
    querySelectorAll: (selector: string) => (selector === 'video, audio' ? items : hosts),
  })
  const run = (document: unknown): number => new Function('document', `return ${PAUSE_ALL_MEDIA_SCRIPT}`)(document) as number

  it('pauses what plays, in the page and in open shadow roots, and plays nothing', () => {
    const video = media(true)
    const audio = media(false)
    const shadowed = media(true)
    const played: string[] = []
    const untouched = { ...media(false), play: () => { played.push('play') } }
    const document = root([video, audio, untouched], [{ shadowRoot: root([shadowed]) }, { shadowRoot: null }])
    expect(run(document)).toBe(2)
    expect([video.paused, audio.paused, shadowed.paused]).toEqual([true, true, true])
    expect(played).toEqual([])
    expect(PAUSE_ALL_MEDIA_SCRIPT).not.toContain('.play(')
  })

  it('does nothing on a page with no media', () => {
    expect(run(root([]))).toBe(0)
  })
})
