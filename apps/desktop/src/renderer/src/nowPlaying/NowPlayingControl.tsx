import { useEffect, useState } from 'react'
import { Globe2, Pause, Play, Volume2, VolumeX, ArrowUpRight } from 'lucide-react'
import type { NowPlayingSnapshot, PageTabSnapshot } from '@intoponet/browser-api'
import { TabIcon } from '../tabControls'
import './nowPlaying.css'

/** The tab the now-playing control stands for, or null when nothing plays (main decides which tab). */
export function useNowPlaying(): NowPlayingSnapshot | null {
  const [nowPlaying, setNowPlaying] = useState<NowPlayingSnapshot | null>(null)
  useEffect(() => window.intoponet.browserHost.subscribe((event) => {
    if (event.type === 'now-playing') setNowPlaying(event.nowPlaying)
  }), [])
  return nowPlaying
}

/**
 * Sidebar control for media playing in a tab: play or pause, mute, and go to the tab.
 * Hidden when nothing plays. Each action is a real button with a label, so the keyboard reaches it.
 */
export function NowPlayingControl({ nowPlaying, tabs, open }: { nowPlaying: NowPlayingSnapshot | null; tabs: PageTabSnapshot[]; open: boolean }) {
  // The tab may be in another workspace, so it is not in `tabs` (the shown workspace's): the icon falls back to a globe.
  const tab = nowPlaying ? tabs.find((item) => item.id === nowPlaying.tabId) : undefined
  if (!nowPlaying) return null
  const host = window.intoponet.browserHost
  const title = nowPlaying.title || 'tab'
  const state = nowPlaying.playing ? 'Playing' : 'Paused'
  return (
    <div className="now-playing" role="group" aria-label={`Now playing: ${title}`}>
      <span className="now-playing-icon" aria-hidden="true">{tab ? <TabIcon tab={tab} size={16} /> : <Globe2 size={14} aria-hidden="true" />}</span>
      <span className="now-playing-text" aria-hidden={!open}>
        <span className="now-playing-state">{state}{nowPlaying.pip ? ' in a small window' : ''}</span>
        <span className="now-playing-title">{title}</span>
      </span>
      <button
        type="button"
        className="now-playing-button"
        aria-label={nowPlaying.playing ? `Pause ${title}` : `Play ${title}`}
        title={nowPlaying.playing ? 'Pause' : 'Play'}
        onClick={() => void host.toggleTabPlayback(nowPlaying.tabId)}
      >
        {nowPlaying.playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="now-playing-button"
        aria-label={nowPlaying.muted ? `Unmute ${title}` : `Mute ${title}`}
        aria-pressed={nowPlaying.muted}
        title={nowPlaying.muted ? 'Unmute' : 'Mute'}
        onClick={() => void host.setTabMuted(nowPlaying.tabId, !nowPlaying.muted)}
      >
        {nowPlaying.muted ? <VolumeX size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="now-playing-button"
        aria-label={`Go to tab: ${title}`}
        title="Go to tab"
        onClick={() => void host.activateTab(nowPlaying.tabId)}
      >
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
