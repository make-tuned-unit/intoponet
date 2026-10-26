import { useEffect, useState } from 'react'
import type { CaptureRecord } from '@intoponet/browser-api'

/** Live capture index from the main process (encrypted store). */
export function useCaptures(): { records: CaptureRecord[]; error: string } {
  const [records, setRecords] = useState<CaptureRecord[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void window.intoponet.captures.list()
      .then((next) => { if (!cancelled) setRecords(next) })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Captures could not be opened.')
      })
    const unsubscribe = window.intoponet.captures.subscribe((event) => {
      if (event.type === 'changed') {
        setRecords(event.records)
        setError('')
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return { records, error }
}
