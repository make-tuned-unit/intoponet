import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { ChevronLeft, ChevronRight, Copy, ExternalLink, FolderOpen, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CaptureRecord } from '@intoponet/browser-api'
import { bookmarkHost, formatDuration, UNSORTED_GROUP_ID } from '../bookmarkGroups'
import { useGlassSheen } from '../glass/useGlassSheen'
import '../glass/glass.css'
import './captures.css'

const spring: Transition = { type: 'spring', stiffness: 380, damping: 36 }

export type CaptureViewerProps = {
  records: CaptureRecord[]
  openId: string
  groups: Array<{ id: string; label: string }>
  onNavigate: (id: string) => void
  onClose: () => void
  onMove: (id: string, groupId: string | null) => void
  onDelete: (id: string) => void
  onOpenSource: (url: string) => void
  notify: (message: string) => void
}

function useVideoUrl(record: CaptureRecord | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!record || record.kind !== 'video') return
    let objectUrl: string | null = null
    let cancelled = false
    // Fetch into a Blob URL so seeking works without range support.
    void fetch(window.intoponet.captures.mediaUrl(record, 'media'))
      .then((response) => response.blob())
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [record])
  return url
}

/**
 * MediaRecorder WebM files carry no duration, so the scrubber reads
 * 0:00 / 0:00. Seeking far past the end makes Chromium scan the file and
 * learn its real length; then rewind and play.
 */
function RecordedVideo({ src }: { src: string }) {
  return (
    <video
      src={src}
      controls
      muted
      playsInline
      onLoadedMetadata={(event) => {
        const video = event.currentTarget
        if (video.duration !== Infinity && !Number.isNaN(video.duration)) return void video.play().catch(() => undefined)
        const settle = (): void => {
          video.removeEventListener('durationchange', settle)
          video.currentTime = 0
          void video.play().catch(() => undefined)
        }
        video.addEventListener('durationchange', settle)
        video.currentTime = Number.MAX_SAFE_INTEGER
      }}
    />
  )
}

export function CaptureViewer({ records, openId, groups, onNavigate, onClose, onMove, onDelete, onOpenSource, notify }: CaptureViewerProps) {
  const reduceMotion = useReducedMotion()
  const bar = useGlassSheen<HTMLDivElement>()
  const index = records.findIndex((record) => record.id === openId)
  const record = records[index]
  const videoUrl = useVideoUrl(record)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // The native page view would otherwise sit above this overlay.
  useEffect(() => {
    void window.intoponet.captures.setPageHidden(true)
    return () => { void window.intoponet.captures.setPageHidden(false) }
  }, [])

  useEffect(() => setConfirmDelete(false), [openId])
  useEffect(() => { if (!record) onClose() }, [onClose, record])

  const step = (delta: number): void => {
    const next = records[(index + delta + records.length) % records.length]
    if (next) onNavigate(next.id)
  }

  const copy = (): void => {
    if (record?.kind !== 'image') return
    void window.intoponet.captures.copyImage(record.id).then(() => notify('Copied screenshot')).catch(() => notify('Could not copy the screenshot'))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLSelectElement) return
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'ArrowLeft') step(-1)
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') copy()
      else return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  })

  if (!record) return null
  const groupValue = record.groupId && groups.some((group) => group.id === record.groupId) ? record.groupId : UNSORTED_GROUP_ID
  const date = new Date(record.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <motion.div
      className="cap-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${record.kind === 'image' ? 'Screenshot' : 'Recording'}: ${record.title}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      <div className="cap-viewer-backdrop" onClick={onClose} aria-hidden="true" />

      <motion.div
        ref={bar}
        className="cap-viewer-bar lg-surface lg-sheen"
        initial={reduceMotion ? false : { y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={spring}
      >
        <div className="cap-viewer-title">
          <strong title={record.title}>{record.title || bookmarkHost(record.sourceUrl)}</strong>
          <span>
            {bookmarkHost(record.sourceUrl)} · {date} · {record.kind === 'video' && record.durationMs !== undefined ? formatDuration(record.durationMs) : `${record.width} × ${record.height}`}
          </span>
        </div>
        <label className="cap-group">
          <span>Group</span>
          <select value={groupValue} onChange={(event) => onMove(record.id, event.target.value === UNSORTED_GROUP_ID ? null : event.target.value)} aria-label="Move to group">
            {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
          </select>
        </label>
        <div className="cap-viewer-actions">
          {record.kind === 'image' && (
            <button type="button" className="lg-icon-button" aria-label="Copy screenshot" title="Copy (⌘C)" onClick={copy}><Copy size={15} /></button>
          )}
          <button
            type="button"
            className="lg-icon-button"
            aria-label="Show in Finder"
            title={`Show in Finder${record.fileName ? `: ${record.fileName}` : ''}`}
            onClick={() => void window.intoponet.captures.reveal(record.id).catch(() => notify('This capture was moved or deleted in Finder'))}
          >
            <FolderOpen size={15} />
          </button>
          {record.sourceUrl && (
            <button type="button" className="lg-icon-button" aria-label="Open the source page" title="Open the source page" onClick={() => onOpenSource(record.sourceUrl)}>
              <ExternalLink size={15} />
            </button>
          )}
          <button
            type="button"
            className={`lg-icon-button${confirmDelete ? ' is-danger' : ''}`}
            aria-label={confirmDelete ? 'Confirm delete' : 'Delete capture'}
            title={confirmDelete ? 'Click again to delete' : 'Delete'}
            onBlur={() => setConfirmDelete(false)}
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true)
              const next = records[index + 1] ?? records[index - 1]
              onDelete(record.id)
              if (next) onNavigate(next.id)
              else onClose()
            }}
          >
            <Trash2 size={15} />
          </button>
          <span className="cap-divider" aria-hidden="true" />
          <button type="button" className="lg-icon-button" aria-label="Close viewer" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
        </div>
      </motion.div>

      <div className="cap-viewer-stage">
        <AnimatePresence mode="popLayout" initial={false}>
          {record.kind === 'image' ? (
            <motion.img
              key={record.id}
              layoutId={`capture-${record.id}`}
              className="cap-viewer-media"
              src={window.intoponet.captures.mediaUrl(record, 'media')}
              alt={record.title}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={spring}
            />
          ) : (
            <motion.div
              key={record.id}
              layoutId={`capture-${record.id}`}
              className="cap-viewer-media cap-viewer-video"
              style={{ aspectRatio: `${record.width} / ${record.height}` }}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={spring}
            >
              {videoUrl
                ? <RecordedVideo src={videoUrl} />
                : <img src={window.intoponet.captures.mediaUrl(record, 'thumb')} alt="" />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {records.length > 1 && (
        <>
          <button type="button" className="cap-viewer-nav cap-viewer-nav--prev lg-surface" aria-label="Previous capture" onClick={() => step(-1)}><ChevronLeft size={20} /></button>
          <button type="button" className="cap-viewer-nav cap-viewer-nav--next lg-surface" aria-label="Next capture" onClick={() => step(1)}><ChevronRight size={20} /></button>
          <span className="cap-viewer-count">{index + 1} / {records.length}</span>
        </>
      )}
    </motion.div>
  )
}
