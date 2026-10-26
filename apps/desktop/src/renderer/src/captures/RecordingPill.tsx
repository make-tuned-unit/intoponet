import { motion } from 'motion/react'
import { Square } from 'lucide-react'
import { formatDuration } from '../bookmarkGroups'
import type { RecorderState } from './useRecorder'

/** Lives in the browser chrome while a recording runs. */
export function RecordingPill({ state, onStop }: { state: RecorderState; onStop: () => void }) {
  if (state.status === 'idle') return null
  const saving = state.status === 'saving'
  return (
    <motion.div
      className={`rec-pill${saving ? ' is-saving' : ''}`}
      initial={{ opacity: 0, scale: 0.8, width: 32 }}
      animate={{ opacity: 1, scale: 1, width: 'auto' }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      role="status"
      aria-live="polite"
    >
      <span className="rec-dot" aria-hidden="true" />
      <span className="rec-time">{saving ? 'Saving' : state.status === 'starting' ? 'Starting' : formatDuration(state.elapsedMs)}</span>
      <button type="button" className="rec-stop" onClick={onStop} disabled={saving} aria-label="Stop recording and save" title="Stop recording">
        <Square size={10} fill="currentColor" />
      </button>
    </motion.div>
  )
}
