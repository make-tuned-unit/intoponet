import { useCallback, useEffect, useRef, useState } from 'react'
import { CAPTURE_LIMITS, type CaptureCrop, type CaptureRecord } from '@intoponet/browser-api'

export type RecorderState =
  | { status: 'idle' }
  | { status: 'starting' | 'recording' | 'saving'; startedAt: number; elapsedMs: number }

const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/**
 * Silent recording of the visible page area. The main process streams the
 * page's own compositor frames (already cropped); they are painted into a
 * canvas and encoded on-device with MediaRecorder. No OS screen capture.
 */
export function useRecorder(onSaved: (record: CaptureRecord) => void, onError: (message: string) => void) {
  const [state, setState] = useState<RecorderState>({ status: 'idle' })
  const session = useRef<{
    pendingId: string
    groupId: string | null
    canvas: HTMLCanvasElement
    context: CanvasRenderingContext2D
    recorder: MediaRecorder | null
    chunks: Blob[]
    startedAt: number
    unsubscribe: () => void
    timer: number
    ticker: number
    latest: ImageBitmap | null
    finishing: boolean
  } | null>(null)
  const callbacks = useRef({ onSaved, onError })
  callbacks.current = { onSaved, onError }

  const finish = useCallback(async () => {
    const current = session.current
    if (!current || current.finishing) return
    current.finishing = true
    window.clearInterval(current.timer)
    window.clearInterval(current.ticker)
    current.unsubscribe()
    await window.intoponet.captures.stopFrames().catch(() => undefined)
    const recorder = current.recorder
    const durationMs = Math.min(Date.now() - current.startedAt, CAPTURE_LIMITS.recordingMs)
    setState({ status: 'saving', startedAt: current.startedAt, elapsedMs: durationMs })
    try {
      if (!recorder) throw new Error('The recording did not start.')
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
      if (recorder.state !== 'inactive') recorder.stop()
      await stopped
      const blob = new Blob(current.chunks, { type: recorder.mimeType || 'video/webm' })
      if (blob.size === 0) throw new Error('The recording was empty.')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const mimeType = (recorder.mimeType || 'video/webm').replace(/\s+/g, '')
      const record = await window.intoponet.captures.saveVideo(current.pendingId, bytes, mimeType, durationMs, current.groupId)
      callbacks.current.onSaved(record)
    } catch (reason) {
      await window.intoponet.captures.cancel(current.pendingId).catch(() => undefined)
      callbacks.current.onError(reason instanceof Error ? reason.message : 'The recording could not be saved.')
    } finally {
      current.latest?.close()
      session.current = null
      setState({ status: 'idle' })
    }
  }, [])

  const start = useCallback(async (pendingId: string, crop: CaptureCrop, groupId: string | null) => {
    if (session.current) return
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) {
      callbacks.current.onError('Recording is unavailable in this window.')
      return
    }
    const startedAt = Date.now()
    const current = {
      pendingId, groupId, canvas, context, recorder: null as MediaRecorder | null, chunks: [] as Blob[],
      startedAt, unsubscribe: () => {}, timer: 0, ticker: 0, latest: null as ImageBitmap | null, finishing: false,
    }
    session.current = current
    setState({ status: 'starting', startedAt, elapsedMs: 0 })

    current.unsubscribe = window.intoponet.captures.subscribe((event) => {
      if (event.type === 'recording-interrupted') {
        void finish()
        return
      }
      if (event.type !== 'frame' || session.current !== current) return
      void createImageBitmap(new Blob([event.jpeg as BlobPart], { type: 'image/jpeg' })).then((bitmap) => {
        if (session.current !== current) return bitmap.close()
        current.latest?.close()
        current.latest = bitmap
        if (!current.recorder) {
          // Size the encoder from the first frame (even dimensions for VP8/9).
          canvas.width = Math.max(2, event.width - (event.width % 2))
          canvas.height = Math.max(2, event.height - (event.height % 2))
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
          const recorder = new MediaRecorder(canvas.captureStream(30), {
            ...(mimeType ? { mimeType } : {}),
            videoBitsPerSecond: 8_000_000,
          })
          recorder.ondataavailable = (data) => { if (data.data.size > 0) current.chunks.push(data.data) }
          recorder.start(1000)
          current.recorder = recorder
          current.startedAt = Date.now()
          setState({ status: 'recording', startedAt: current.startedAt, elapsedMs: 0 })
          // Pages repaint only when they change; the encoder needs a steady
          // timeline, so repaint the latest frame at 30 fps.
          current.ticker = window.setInterval(() => {
            if (current.latest) context.drawImage(current.latest, 0, 0, canvas.width, canvas.height)
          }, 1000 / 30)
        }
      })
    })

    current.timer = window.setInterval(() => {
      if (!current.recorder) return
      const elapsedMs = Date.now() - current.startedAt
      setState({ status: 'recording', startedAt: current.startedAt, elapsedMs })
      if (elapsedMs >= CAPTURE_LIMITS.recordingMs) void finish()
    }, 250)

    try {
      await window.intoponet.captures.startRecording(pendingId, crop)
    } catch (reason) {
      window.clearInterval(current.timer)
      window.clearInterval(current.ticker)
      current.unsubscribe()
      session.current = null
      setState({ status: 'idle' })
      callbacks.current.onError(reason instanceof Error ? reason.message : 'Recording could not start.')
    }
  }, [finish])

  useEffect(() => () => {
    const current = session.current
    if (!current) return
    window.clearInterval(current.timer)
    window.clearInterval(current.ticker)
    current.unsubscribe()
    void window.intoponet.captures.stopFrames()
  }, [])

  return { state, start, stop: finish }
}
