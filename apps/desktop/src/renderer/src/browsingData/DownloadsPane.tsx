import type { DownloadEntry } from '@intoponet/browser-api'
import { Download, FolderOpen, Pause, Play, RotateCw, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadFraction, downloadStatus, overallProgress } from './browsingDataModel'
import { holdPage } from './pageHold'
import './browsingData.css'

/** Toolbar button (shown once there are downloads) with a progress ring, opening the downloads list. */
export function DownloadsButton({ onError }: { onError?: (message: string) => void }) {
  const [downloads, setDownloads] = useState<DownloadEntry[]>([])
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const asked = useRef(new Set<string>())

  useEffect(() => {
    void window.intoponet.downloads.list().then(setDownloads, () => undefined)
    return window.intoponet.downloads.subscribe((event) => {
      if (event.type === 'list') setDownloads(event.downloads)
    })
  }, [])

  // A download waiting for an answer (dangerous type, many files at once) opens the list to ask.
  useEffect(() => {
    const waiting = downloads.filter((entry) => entry.attention && !asked.current.has(`${entry.id}:${entry.attention}`))
    if (!waiting.length) return
    for (const entry of waiting) asked.current.add(`${entry.id}:${entry.attention}`)
    setOpen(true)
  }, [downloads])

  const close = useCallback(() => {
    setOpen(false)
    button.current?.focus()
  }, [])

  const run = useCallback((action: Promise<DownloadEntry[]>) => {
    void action.then(setDownloads, (error: unknown) => onError?.(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work.'))
  }, [onError])

  if (downloads.length === 0) return null
  const { active, fraction } = overallProgress(downloads)
  const attention = downloads.some((entry) => entry.attention)
  const label = attention
    ? 'Downloads: a download needs your answer'
    : active
      ? `Downloads: ${active} in progress${fraction !== null ? `, ${Math.round(fraction * 100)}%` : ''}`
      : `Downloads (${downloads.length})`
  const circumference = 2 * Math.PI * 9

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`downloads-toggle${open ? ' selected' : ''}${attention ? ' has-offer' : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls="downloads-pane"
        title="Downloads"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="downloads-ring" aria-hidden="true">
          {active > 0 && (
            <svg viewBox="0 0 22 22" className={`downloads-progress${fraction === null ? ' is-indeterminate' : ''}`}>
              <circle cx="11" cy="11" r="9" className="downloads-ring-track" />
              <circle
                cx="11"
                cy="11"
                r="9"
                className="downloads-ring-value"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - (fraction ?? 0.25))}
              />
            </svg>
          )}
          {attention ? <TriangleAlert size={13} /> : <Download size={13} />}
        </span>
        <span className="chrome-label">Downloads</span>
      </button>
      {/* On the page body, not inside the toolbar, so the toolbar's button styles never reach the list. */}
      {open && createPortal(<DownloadsPane anchor={button.current} downloads={downloads} run={run} onClose={close} />, document.body)}
    </>
  )
}

function DownloadsPane({ anchor, downloads, run, onClose }: {
  anchor: HTMLElement | null
  downloads: DownloadEntry[]
  run: (action: Promise<DownloadEntry[]>) => void
  onClose: () => void
}) {
  const pane = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 64, right: 16 })
  const api = window.intoponet.downloads

  useLayoutEffect(() => {
    const place = (): void => {
      const rect = anchor?.getBoundingClientRect()
      if (rect) setPosition({ top: Math.round(rect.bottom + 8), right: Math.max(12, Math.round(window.innerWidth - rect.right)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor])

  useEffect(() => holdPage(), [])
  useEffect(() => {
    void api.list().then(() => undefined, () => undefined)
    // Focus the first question if one is waiting, else the list.
    const target = pane.current?.querySelector<HTMLElement>('.downloads-question button') ?? pane.current
    target?.focus()
  }, [api])

  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!pane.current?.contains(target) && !anchor?.contains(target)) onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [anchor, onClose])

  // Escape closes the list wherever focus is, before the app's own Escape handling (closing the page).
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [onClose])
  const finished = downloads.some((entry) => entry.state !== 'progressing' && entry.state !== 'paused' && !entry.attention)

  return (
    <div
      ref={pane}
      id="downloads-pane"
      className="downloads-pane lg-surface"
      role="dialog"
      aria-label="Downloads"
      tabIndex={-1}
      style={{ top: position.top, right: position.right }}
    >
      <div className="downloads-head">
        <h2>Downloads</h2>
        <div>
          {finished && <button type="button" className="downloads-text-button" onClick={() => run(api.clearFinished())}>Clear finished</button>}
          <button type="button" className="downloads-icon-button" aria-label="Close downloads" onClick={onClose}><X size={15} /></button>
        </div>
      </div>
      <ul className="downloads-list" aria-label="Downloads">
        {downloads.map((entry) => <DownloadRow key={entry.id} entry={entry} run={run} />)}
      </ul>
    </div>
  )
}

function DownloadRow({ entry, run }: { entry: DownloadEntry; run: (action: Promise<DownloadEntry[]>) => void }) {
  const api = window.intoponet.downloads
  const fraction = downloadFraction(entry)
  const active = entry.state === 'progressing' || entry.state === 'paused'
  const failed = entry.state === 'interrupted' || entry.state === 'cancelled'
  const name = entry.filename
  return (
    <li className={`download-row is-${entry.state}${entry.attention ? ' needs-answer' : ''}`} data-download-state={entry.state}>
      <div className="download-main">
        {entry.state === 'completed' && entry.exists && !entry.attention ? (
          <button type="button" className="download-name" onClick={() => run(api.open(entry.id))} aria-label={`Open ${name}`}>
            {name}
          </button>
        ) : (
          <span className="download-name">{name}</span>
        )}
        <span className="download-meta">
          {downloadStatus(entry)}
          {entry.origin && <> · {entry.origin.replace(/^https?:\/\//, '')}</>}
          {entry.isPrivate && <> · private</>}
        </span>
        {active && !entry.attention && (
          <progress
            className="download-progress"
            aria-label={`${name} progress`}
            max={1}
            {...(fraction !== null ? { value: fraction } : {})}
          />
        )}
        {entry.note && !entry.attention && <span className="download-note">{entry.note}</span>}
      </div>
      {entry.attention === 'dangerous-type' ? (
        <div className="downloads-question" role="group" aria-label={`${name} can harm your Mac`}>
          <button type="button" className="is-primary" onClick={() => run(api.discard(entry.id))}>Discard</button>
          <button type="button" onClick={() => run(api.keep(entry.id))}>Keep</button>
        </div>
      ) : entry.attention === 'multiple-downloads' ? (
        <div className="downloads-question" role="group" aria-label={`${entry.origin || 'This site'} wants to download multiple files`}>
          <button type="button" className="is-primary" onClick={() => run(api.blockMultiple(entry.id))}>Block</button>
          <button type="button" onClick={() => run(api.allowMultiple(entry.id))}>Allow</button>
        </div>
      ) : (
        <div className="download-actions">
          {entry.state === 'progressing' && entry.live && (
            <button type="button" className="downloads-icon-button" aria-label={`Pause ${name}`} onClick={() => run(api.pause(entry.id))}><Pause size={14} /></button>
          )}
          {entry.state === 'paused' && entry.live && (
            <button type="button" className="downloads-icon-button" aria-label={`Resume ${name}`} onClick={() => run(api.resume(entry.id))}><Play size={14} /></button>
          )}
          {failed && entry.canRetry && (
            <button type="button" className="downloads-icon-button" aria-label={`Retry ${name}`} onClick={() => run(api.retry(entry.id))}><RotateCw size={14} /></button>
          )}
          {entry.state === 'completed' && entry.exists && (
            <button type="button" className="downloads-icon-button" aria-label={`Show ${name} in Finder`} onClick={() => run(api.show(entry.id))}><FolderOpen size={14} /></button>
          )}
          {active ? (
            <button type="button" className="downloads-icon-button" aria-label={`Cancel ${name}`} onClick={() => run(api.cancel(entry.id))}><X size={14} /></button>
          ) : (
            <button type="button" className="downloads-icon-button" aria-label={`Remove ${name} from the list`} onClick={() => run(api.remove(entry.id))}><X size={14} /></button>
          )}
        </div>
      )}
    </li>
  )
}
