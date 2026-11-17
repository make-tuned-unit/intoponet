import { describe, expect, it } from 'vitest'
import { ClosedWindowAudio } from './closedWindowAudio'

function page(muted = false, destroyed = false) {
  const state = { muted, destroyed, calls: [] as boolean[] }
  return { state, isDestroyed: () => state.destroyed, isAudioMuted: () => state.muted, setAudioMuted: (next: boolean) => { state.muted = next; state.calls.push(next) } }
}

describe('pages silenced when the app window closes', () => {
  it('mutes every page that could be heard, and keeps it muted until the person acts in it', () => {
    const audio = new ClosedWindowAudio<ReturnType<typeof page>>()
    const playing = page()
    const other = page()
    audio.windowClosed([playing, other])
    expect([playing.state.muted, other.state.muted]).toEqual([true, true])
    expect(audio.silenced(playing)).toBe(true)
    // The window coming back changes nothing; a click or key in one tab frees that tab only.
    expect(audio.personActed(playing)).toBe(true)
    expect([playing.state.muted, other.state.muted]).toEqual([false, true])
    expect(audio.silenced(playing)).toBe(false)
    // Acting again does nothing more (a tab the person then mutes is not unmuted by their next key).
    playing.setAudioMuted(true)
    expect(audio.personActed(playing)).toBe(false)
    expect(playing.state.muted).toBe(true)
  })

  it('leaves a tab the person muted alone, and never unmutes it', () => {
    const audio = new ClosedWindowAudio<ReturnType<typeof page>>()
    const muted = page(true)
    audio.windowClosed([muted])
    expect(muted.state.calls).toEqual([])
    expect(audio.silenced(muted)).toBe(false)
    expect(audio.personActed(muted)).toBe(false)
    expect(muted.state.muted).toBe(true)
  })

  it('keeps the person\'s own choice made after the window closed', () => {
    const audio = new ClosedWindowAudio<ReturnType<typeof page>>()
    const tab = page()
    audio.windowClosed([tab])
    // Muted from the tab's own control while silenced: now it is their mute, and a key in the page keeps it.
    audio.mutedByPerson(tab)
    tab.setAudioMuted(true)
    expect(audio.silenced(tab)).toBe(false)
    expect(audio.personActed(tab)).toBe(false)
    expect(tab.state.muted).toBe(true)
  })

  it('skips pages that are gone, and closing the window twice silences once', () => {
    const audio = new ClosedWindowAudio<ReturnType<typeof page>>()
    const gone = page(false, true)
    const tab = page()
    audio.windowClosed([gone, tab])
    audio.windowClosed([gone, tab])
    expect(gone.state.calls).toEqual([])
    expect(tab.state.calls).toEqual([true])
    tab.state.destroyed = true
    expect(audio.personActed(tab)).toBe(true)
    expect(tab.state.calls).toEqual([true])
  })
})
