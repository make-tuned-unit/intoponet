import { AnimatePresence, motion } from 'motion/react'
import { Check, FolderOpen } from 'lucide-react'
import { useEffect } from 'react'
import type { CaptureRecord } from '@intoponet/browser-api'

export type CaptureToastState = { record: CaptureRecord; groupLabel: string; anchor: { x: number; y: number } } | null

/** A small "saved" confirmation that grows out of the browser chrome. */
export function CaptureToast({ toast, onView, onDismiss }: { toast: CaptureToastState; onView: (id: string) => void; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(onDismiss, 4200)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast])
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.record.id}
          className="cap-toast lg-surface"
          style={{ left: toast.anchor.x, top: toast.anchor.y }}
          initial={{ opacity: 0, y: -10, scale: 0.9, x: '-50%', filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, x: '-50%', filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -8, scale: 0.94, x: '-50%', filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 440, damping: 32 }}
          role="status"
        >
          <motion.img
            className="cap-toast-thumb"
            src={window.intoponet.captures.mediaUrl(toast.record, 'thumb')}
            alt=""
            initial={{ scale: 1.6, rotate: -6, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 360, damping: 22, delay: 0.05 }}
          />
          <span className="cap-toast-text">
            <Check size={12} aria-hidden="true" />
            {toast.record.kind === 'image' ? 'Screenshot' : 'Recording'} saved to <strong>{toast.groupLabel}</strong>
          </span>
          <button type="button" onClick={() => onView(toast.record.id)}>View</button>
          <button
            type="button"
            className="cap-toast-icon"
            aria-label="Show in Finder"
            title={toast.record.fileName ? `Show in Finder: ${toast.record.fileName}` : 'Show in Finder'}
            onClick={() => void window.intoponet.captures.reveal(toast.record.id)}
          >
            <FolderOpen size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
