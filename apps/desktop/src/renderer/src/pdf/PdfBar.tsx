import { useEffect, useState, type ReactElement } from 'react'
import { Check, FileDown, FolderOpen, LoaderCircle, RotateCcw, X } from 'lucide-react'
import type { PdfExportEvent, PdfExportOptions } from '@intoponet/browser-api'
import './pdf.css'

export type PdfGroupChoice = { id: string; label: string }

const STEP_LABEL: Record<'preparing' | 'printing' | 'finishing', string> = {
  preparing: 'Loading images and reading the page',
  printing: 'Laying out pages',
  finishing: 'Adding details and compressing',
}

/** "1.2 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** What the result line says about how the PDF was made. */
export function pdfResultNotes(event: Extract<PdfExportEvent, { state: 'saved' }>): string[] {
  const notes: string[] = []
  if (event.mode === 'formatted') notes.push('Formatted for reading')
  else if (event.fellBack) notes.push(`As seen: ${event.fellBack}`)
  else notes.push('As seen')
  if (event.ads > 0) notes.push(`${event.ads} ad${event.ads === 1 ? '' : 's'} left out`)
  if (event.missingImages > 0) notes.push(`${event.missingImages} image${event.missingImages === 1 ? '' : 's'} had not loaded and were left out`)
  return notes
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): ReactElement {
  return (
    <span className="pdf-field">
      <span className="pdf-label" id={`pdf-${label}`}>{label}</span>
      <span className="pdf-segmented" role="radiogroup" aria-labelledby={`pdf-${label}`}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? 'is-on' : ''}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </span>
    </span>
  )
}

/**
 * The bar under the page toolbar for Export as PDF: progress while it is being made, then where it
 * went (Open, Show in Finder). With options open it also sets how the next PDFs are made.
 */
export function PdfBar({ status, optionsOpen, groups, isPrivate, onClose, onCloseOptions, onError }: {
  status: PdfExportEvent | null
  optionsOpen: boolean
  groups: PdfGroupChoice[]
  isPrivate: boolean
  /** Dismiss the result line. */
  onClose: () => void
  onCloseOptions: () => void
  onError: (message: string) => void
}): ReactElement | null {
  const [options, setOptions] = useState<PdfExportOptions | null>(null)

  useEffect(() => {
    if (!optionsOpen) return
    let live = true
    window.intoponet.browserHost.getPdfSettings().then((value) => { if (live) setOptions(value) }, () => undefined)
    return () => { live = false }
  }, [optionsOpen])

  const change = (patch: Partial<PdfExportOptions>): void => {
    if (!options) return
    const next = { ...options, ...patch }
    setOptions(next)
    void window.intoponet.browserHost.setPdfSettings(next).catch(() => undefined)
  }
  const exportNow = (override?: Partial<PdfExportOptions>): void => {
    const next = options ? { ...options, ...override } : undefined
    void window.intoponet.browserHost.exportPdf(next).catch((error: unknown) => onError(error instanceof Error ? error.message : 'The PDF could not be made.'))
  }
  const open = (path: string, reveal: boolean): void => {
    window.intoponet.browserHost.openSavedFile(path, reveal).catch(() => onError('That PDF is no longer there.'))
  }

  const working = status?.state === 'working'
  let statusRow: ReactElement | null = null
  if (status?.state === 'working') {
    statusRow = (
      <div className="pdf-row">
        <span className="pdf-status" role="status">
          <LoaderCircle size={14} className="pdf-spin" aria-hidden="true" />
          Saving as PDF · {STEP_LABEL[status.step]}…
        </span>
        <span className="pdf-spacer" />
        <button type="button" className="pdf-button" onClick={() => void window.intoponet.browserHost.cancelPdfExport()}>Cancel</button>
      </div>
    )
  } else if (status?.state === 'saved') {
    const group = status.groupId ? groups.find((item) => item.id === status.groupId) : null
    statusRow = (
      <div className="pdf-row">
        <span className="pdf-status pdf-done" role="status">
          <Check size={14} aria-hidden="true" />
          <span className="pdf-name" title={status.path}>Saved “{status.filename}”</span>
          <span className="pdf-meta">
            {status.pages ? `${status.pages} page${status.pages === 1 ? '' : 's'} · ` : ''}{formatBytes(status.bytes)}
            {' · '}{pdfResultNotes(status).join(' · ')}
            {group ? ` · In bookmarks: ${group.label}` : ''}
          </span>
        </span>
        <span className="pdf-spacer" />
        {status.mode === 'asSeen' && status.fellBack && (
          <button type="button" className="pdf-button" onClick={() => exportNow({ mode: 'formatted' })}>Try formatted</button>
        )}
        <button type="button" className="pdf-button pdf-primary" onClick={() => open(status.path, false)}>Open</button>
        <button type="button" className="pdf-button" onClick={() => open(status.path, true)}>
          <FolderOpen size={13} aria-hidden="true" /> Show in Finder
        </button>
        <button type="button" className="pdf-close" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>
    )
  } else if (status?.state === 'failed') {
    statusRow = (
      <div className="pdf-row">
        <span className="pdf-status pdf-failed" role="alert">The PDF could not be saved: {status.reason}</span>
        <span className="pdf-spacer" />
        <button type="button" className="pdf-button" onClick={() => exportNow()}><RotateCcw size={13} aria-hidden="true" /> Try again</button>
        <button type="button" className="pdf-button" onClick={() => void window.intoponet.browserHost.print()}>Print…</button>
        <button type="button" className="pdf-close" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>
    )
  }

  if (!statusRow && !optionsOpen) return null
  return (
    <div className="pdf-bar" aria-label="Save as PDF">
      {statusRow}
      {optionsOpen && (
        <div className="pdf-row pdf-options">
          <FileDown size={15} className="pdf-icon" aria-hidden="true" />
          {options ? (
            <>
              <Segmented
                label="Layout"
                value={options.mode}
                options={[{ value: 'auto', label: 'Auto' }, { value: 'formatted', label: 'Formatted' }, { value: 'asSeen', label: 'As seen' }]}
                onChange={(mode) => change({ mode })}
              />
              <Segmented
                label="Paper"
                value={options.paper}
                options={[{ value: 'auto', label: 'Auto' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }]}
                onChange={(paper) => change({ paper })}
              />
              <Segmented
                label="Text"
                value={options.textSize}
                options={[{ value: 'small', label: 'S' }, { value: 'medium', label: 'M' }, { value: 'large', label: 'L' }]}
                onChange={(textSize) => change({ textSize })}
              />
              <label className="pdf-check"><input type="checkbox" checked={options.images} onChange={(event) => change({ images: event.target.checked })} /> Images</label>
              <label className="pdf-check" title="Title, author, site, dates and address on page one; title and page numbers in the footer">
                <input type="checkbox" checked={options.citation} onChange={(event) => change({ citation: event.target.checked })} /> Source details
              </label>
              <label className="pdf-field" title={isPrivate ? 'Pages from private tabs are not added to bookmarks' : 'Also bookmark the page in this group, linked to the PDF in Finder'}>
                <span className="pdf-label">Bookmark in</span>
                <select value={options.groupId} disabled={isPrivate} onChange={(event) => change({ groupId: event.target.value })}>
                  <option value="">Don’t bookmark</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                </select>
              </label>
              <span className="pdf-spacer" />
              <button type="button" className="pdf-button pdf-primary" disabled={working} onClick={() => exportNow()}>
                Save PDF
              </button>
            </>
          ) : (
            <span className="pdf-status">Loading options…</span>
          )}
          <button type="button" className="pdf-close" aria-label="Close PDF options" onClick={onCloseOptions}><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
