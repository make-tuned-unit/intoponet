import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { clipboard, ClipboardItem, nativeImage, net, shell, type BrowserWindow, type NativeImage, type WebContentsView } from 'electron'
import {
  CAPTURE_LIMITS,
  CAPTURE_SCHEME,
  captureChannels,
  isCaptureId,
  type CaptureCommand,
  type CaptureCrop,
  type CaptureEvent,
  type CaptureRecord,
  type PendingCapture,
} from '@intoponet/browser-api'
import type { CaptureLibrary } from './captureStore'

type Pending = { image: NativeImage; title: string; sourceUrl: string; createdAt: number }

const PENDING_TTL_MS = 15 * 60 * 1000
const FRAME_INTERVAL_MS = 1000 / 30
const THUMB_WIDTH = 480
/**
 * Frames stop on their own after this long even if the app never asks (the app ends recordings at
 * CAPTURE_LIMITS.recordingMs; this is the backstop if it cannot, e.g. its window reloaded).
 */
export const RECORDING_HARD_LIMIT_MS = CAPTURE_LIMITS.recordingMs + 60_000

/** Pixel rectangle for a normalized crop, clamped to the image. */
export function cropToPixels(crop: CaptureCrop, size: { width: number; height: number }) {
  const x = Math.max(0, Math.min(size.width - 1, Math.round(crop.x * size.width)))
  const y = Math.max(0, Math.min(size.height - 1, Math.round(crop.y * size.height)))
  const width = Math.max(1, Math.min(size.width - x, Math.round(crop.width * size.width)))
  const height = Math.max(1, Math.min(size.height - y, Math.round(crop.height * size.height)))
  return { x, y, width, height }
}

/** A view whose page was destroyed has no webContents at all. */
function liveContents(view: WebContentsView | null): Electron.WebContents | null {
  const contents = view?.webContents as Electron.WebContents | undefined
  return contents && !contents.isDestroyed() ? contents : null
}

function scaleToWidth(image: NativeImage, maxWidth: number): NativeImage {
  const size = image.getSize()
  return size.width > maxWidth ? image.resize({ width: maxWidth, quality: 'good' }) : image
}

/**
 * Re-encode at the capture's highest scale factor (2× on Retina) as a 1×
 * image, so crop/resize work in true device pixels and stay sharp.
 */
function pixelImage(image: NativeImage): NativeImage {
  const scaleFactor = Math.max(1, ...image.getScaleFactors())
  return nativeImage.createFromBuffer(image.toPNG({ scaleFactor }))
}

export class CaptureService {
  private pending = new Map<string, Pending>()
  /** The page being recorded: not always the one shown (the other side of a split can take focus meanwhile). */
  private recording: { contents: Electron.WebContents; crop: CaptureCrop; lastFrameAt: number; onGone: () => void } | null = null
  private recordingLimit: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly store: CaptureLibrary,
    private readonly host: {
      window: () => BrowserWindow | null
      pageView: () => WebContentsView | null
      pageAttached: () => boolean
      /** Hides the shown page (both sides of a pair) until shown again, through any re-layout meanwhile. */
      setPageCovered: (covered: boolean) => void
      /** A private tab's page (its captures keep nothing about the page). */
      isPrivate?: (view: WebContentsView) => boolean
    },
  ) {}

  private emit(event: CaptureEvent): void {
    const window = this.host.window()
    if (window && !window.isDestroyed()) window.webContents.send(captureChannels.event, event)
  }

  private async emitChanged(): Promise<void> {
    this.emit({ type: 'changed', records: await this.store.list() })
  }

  private setPageHidden(hidden: boolean): void {
    this.host.setPageCovered(hidden)
  }

  private takePending(pendingId: string, keep = false): Pending {
    const now = Date.now()
    for (const [id, entry] of this.pending) if (now - entry.createdAt > PENDING_TTL_MS) this.pending.delete(id)
    const entry = this.pending.get(pendingId)
    if (!entry) throw new Error('That capture has expired. Take it again.')
    if (!keep) this.pending.delete(pendingId)
    return entry
  }

  private async begin(): Promise<PendingCapture> {
    const view = this.host.pageView()
    if (!view || !this.host.pageAttached() || !liveContents(view)) throw new Error('Open a page to capture it.')
    if (this.recording) throw new Error('A recording is already running.')
    const captured = await view.webContents.capturePage()
    if (captured.isEmpty()) throw new Error('This page could not be captured.')
    const image = pixelImage(captured)
    const pendingId = randomUUID()
    // A private tab's capture is named neutrally and keeps no address (as Save as PDF does), so nothing about
    // the page shows up in Finder, Spotlight or the capture library.
    const isPrivate = this.host.isPrivate?.(view) === true
    const title = isPrivate ? 'Capture' : (view.webContents.getTitle() || view.webContents.getURL() || 'Capture').slice(0, CAPTURE_LIMITS.titleLength)
    const sourceUrl = isPrivate ? '' : view.webContents.getURL().slice(0, CAPTURE_LIMITS.urlLength)
    this.pending.set(pendingId, { image, title, sourceUrl, createdAt: Date.now() })
    while (this.pending.size > 4) this.pending.delete(this.pending.keys().next().value as string)
    // The native page view sits above the UI; hide it so the crop overlay
    // (drawn over the frozen frame) is visible in the same rectangle.
    this.setPageHidden(true)
    const size = image.getSize()
    return {
      pendingId,
      previewUrl: `data:image/jpeg;base64,${image.toJPEG(90).toString('base64')}`,
      width: size.width,
      height: size.height,
      viewBounds: view.getBounds(),
      title,
      sourceUrl,
    }
  }

  private async saveImage(pendingId: string, crop: CaptureCrop, groupId: string | null): Promise<CaptureRecord> {
    const entry = this.takePending(pendingId)
    this.setPageHidden(false)
    const cropped = entry.image.crop(cropToPixels(crop, entry.image.getSize()))
    const size = cropped.getSize()
    const record = await this.store.add({
      kind: 'image',
      title: entry.title,
      sourceUrl: entry.sourceUrl,
      width: size.width,
      height: size.height,
      groupId,
      media: cropped.toPNG(),
      thumb: scaleToWidth(cropped, THUMB_WIDTH).toJPEG(80),
    })
    await this.emitChanged()
    return record
  }

  private startRecording(pendingId: string, crop: CaptureCrop): void {
    const entry = this.takePending(pendingId, true)
    const view = this.host.pageView()
    if (!view || !liveContents(view)) throw new Error('The page closed before recording started.')
    this.stopFrames()
    this.setPageHidden(false)
    const contents = view.webContents
    // Its tab closing ends the recording (it is saved), whichever tab is shown by then.
    const onGone = (): void => {
      if (this.recording?.contents !== contents) return
      this.clearRecordingLimit()
      this.recording = null
      this.emit({ type: 'recording-interrupted', reason: 'page-closed' })
    }
    contents.once('destroyed', onGone)
    this.recording = { contents, crop, lastFrameAt: 0, onGone }
    this.recordingLimit = setTimeout(() => {
      this.recordingLimit = null
      if (!this.recording) return
      this.stopFrames()
      this.emit({ type: 'recording-interrupted', reason: 'page-closed' })
    }, RECORDING_HARD_LIMIT_MS)
    this.recordingLimit.unref?.()
    // Seed the encoder with the frozen frame so a static page still records.
    this.sendFrame(entry.image, crop)
    contents.beginFrameSubscription(false, (image) => {
      const recording = this.recording
      if (!recording || recording.contents !== contents) return
      const now = Date.now()
      if (now - recording.lastFrameAt < FRAME_INTERVAL_MS) return
      recording.lastFrameAt = now
      this.sendFrame(image, recording.crop)
    })
  }

  private sendFrame(image: NativeImage, crop: CaptureCrop): void {
    if (image.isEmpty()) return
    const frame = scaleToWidth(image.crop(cropToPixels(crop, image.getSize())), CAPTURE_LIMITS.frameWidth)
    const size = frame.getSize()
    this.emit({ type: 'frame', jpeg: new Uint8Array(frame.toJPEG(85)), width: size.width, height: size.height })
  }

  private clearRecordingLimit(): void {
    if (this.recordingLimit) clearTimeout(this.recordingLimit)
    this.recordingLimit = null
  }

  stopFrames(): void {
    this.clearRecordingLimit()
    const recording = this.recording
    this.recording = null
    if (recording) this.endRecording(recording)
  }

  /** Frames stop coming from the page that was recorded (whichever page is shown now). */
  private endRecording(recording: NonNullable<CaptureService['recording']>): void {
    const { contents } = recording
    if (contents.isDestroyed()) return
    contents.removeListener('destroyed', recording.onGone)
    try { contents.endFrameSubscription() } catch { /* already ended */ }
  }

  /** Called when the active page view changes or closes. */
  pageChanged(reason: 'tab-changed' | 'page-closed', _previous: WebContentsView | null): void {
    const recording = this.recording
    if (!recording) return
    this.clearRecordingLimit()
    this.recording = null
    this.endRecording(recording)
    this.emit({ type: 'recording-interrupted', reason })
  }

  /**
   * The app window reloaded: any capture it had in progress went with it. Stop sending frames and
   * forget unsaved captures. (The page is shown again by the caller's setPageHeld(false), which
   * knows to keep a new tab's blank view hidden.)
   */
  shellReloaded(): void {
    this.stopFrames()
    this.pending.clear()
  }

  private async saveVideo(command: Extract<CaptureCommand, { type: 'save-video' }>): Promise<CaptureRecord> {
    this.stopFrames()
    const entry = this.takePending(command.pendingId)
    const poster = scaleToWidth(entry.image, CAPTURE_LIMITS.frameWidth)
    const size = poster.getSize()
    const record = await this.store.add({
      kind: 'video',
      title: entry.title,
      sourceUrl: entry.sourceUrl,
      width: size.width,
      height: size.height,
      durationMs: Math.round(command.durationMs),
      groupId: command.groupId,
      media: Buffer.from(command.bytes.buffer, command.bytes.byteOffset, command.bytes.byteLength),
      thumb: scaleToWidth(entry.image, THUMB_WIDTH).toJPEG(80),
    })
    await this.emitChanged()
    return record
  }

  async handle(command: CaptureCommand): Promise<unknown> {
    switch (command.type) {
      case 'begin':
        return this.begin()
      case 'cancel':
        this.pending.delete(command.pendingId)
        this.setPageHidden(false)
        return null
      case 'save-image':
        return this.saveImage(command.pendingId, command.crop, command.groupId)
      case 'start-recording':
        this.startRecording(command.pendingId, command.crop)
        return null
      case 'stop-frames':
        this.stopFrames()
        return null
      case 'save-video':
        return this.saveVideo(command)
      case 'list':
        return this.store.list()
      case 'update': {
        const patch: { groupId?: string | null; title?: string } = {}
        if (command.groupId !== undefined) patch.groupId = command.groupId
        if (command.title !== undefined) patch.title = command.title
        const record = await this.store.update(command.id, patch)
        await this.emitChanged()
        return record
      }
      case 'delete':
        await this.store.remove(command.id)
        await this.emitChanged()
        return null
      case 'delete-all':
        this.stopFrames()
        this.pending.clear()
        await this.store.removeAll()
        await this.emitChanged()
        return null
      case 'reveal': {
        const { path } = await this.store.filePath(command.id)
        shell.showItemInFolder(path)
        return null
      }
      case 'open-folder': {
        const error = await shell.openPath(await this.store.folderPath(command.groupId))
        if (error) throw new Error(error)
        return null
      }
      case 'sync-groups':
        if (await this.store.syncGroups(command.groups)) await this.emitChanged()
        return null
      case 'copy-image': {
        const { record, path } = await this.store.filePath(command.id)
        if (record.kind !== 'image') throw new Error('Only screenshots can be copied as images.')
        const bytes = nativeImage.createFromPath(path).toPNG()
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })])
        return null
      }
      case 'set-page-hidden':
        this.setPageHidden(command.hidden)
        return null
    }
  }

  /** Serve decrypted media to the app window only (default session). */
  async respond(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const variant = url.hostname === 'thumb' ? 'thumb' : url.hostname === 'media' ? 'media' : null
      const id = url.pathname.replace(/^\//, '')
      if (url.protocol !== `${CAPTURE_SCHEME}:` || !variant || !isCaptureId(id)) return new Response('Not found', { status: 404 })
      if (variant === 'thumb') {
        const bytes = await this.store.readThumb(id)
        return new Response(new Uint8Array(bytes), {
          headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable', 'access-control-allow-origin': '*' },
        })
      }
      // Stream the file itself (range requests work, so video can seek).
      const { record, path } = await this.store.filePath(id)
      const response = await net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
      const headers = new Headers(response.headers)
      headers.set('content-type', record.kind === 'image' ? 'image/png' : 'video/webm')
      headers.set('cache-control', 'no-cache')
      headers.set('access-control-allow-origin', '*')
      return new Response(response.body, { status: response.status, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  }
}
