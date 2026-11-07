import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

/** Just enough of NativeImage for a capture and its frames. */
class FakeImage {
  constructor(private readonly width = 200, private readonly height = 100) {}
  isEmpty(): boolean { return false }
  getScaleFactors(): number[] { return [1] }
  toPNG(): Buffer { return Buffer.from('png') }
  toJPEG(): Buffer { return Buffer.from('jpeg') }
  getSize(): { width: number; height: number } { return { width: this.width, height: this.height } }
  crop(rect: { width: number; height: number }): FakeImage { return new FakeImage(rect.width, rect.height) }
  resize(options: { width: number }): FakeImage { return new FakeImage(options.width, this.height) }
}

vi.mock('electron', () => ({
  nativeImage: { createFromBuffer: () => new FakeImage() },
  clipboard: {},
  ClipboardItem: class {},
  net: {},
  shell: {},
}))

const { CaptureService } = await import('./captureService')

let nextId = 1
/** A page whose frames the test sends by hand. */
class FakeContents extends EventEmitter {
  readonly id = nextId++
  destroyed = false
  subscriber: ((image: FakeImage) => void) | null = null
  endFrameSubscription = vi.fn(() => { this.subscriber = null })
  isDestroyed(): boolean { return this.destroyed }
  async capturePage(): Promise<FakeImage> { return new FakeImage() }
  getTitle(): string { return `Page ${this.id}` }
  getURL(): string { return `https://example.com/${this.id}` }
  beginFrameSubscription(_onlyDirty: boolean, callback: (image: FakeImage) => void): void { this.subscriber = callback }
  destroy(): void { this.destroyed = true; this.subscriber = null; this.emit('destroyed') }
}

const fakeView = (contents: FakeContents) => ({ webContents: contents, getBounds: () => ({ x: 0, y: 0, width: 200, height: 100 }), setVisible: vi.fn() })

function setup() {
  const left = new FakeContents()
  const right = new FakeContents()
  const views = { left: fakeView(left), right: fakeView(right) }
  let shown: ReturnType<typeof fakeView> = views.left
  const events: Array<{ type: string; reason?: string }> = []
  const window = { isDestroyed: () => false, webContents: { send: (_channel: string, event: { type: string; reason?: string }) => events.push(event) } }
  const service = new CaptureService({} as never, {
    window: () => window as never,
    pageView: () => shown as never,
    pageAttached: () => true,
  })
  return { service, left, right, views, events, show: (view: ReturnType<typeof fakeView>) => { shown = view } }
}

const crop = { x: 0, y: 0, width: 1, height: 1 }

describe('Recording a page', () => {
  it('stops the frames of the page it recorded, even when the other side of a split has the focus by then', async () => {
    const { service, left, right, views, show } = setup()
    const pending = await service.handle({ type: 'begin' }) as { pendingId: string }
    await service.handle({ type: 'start-recording', pendingId: pending.pendingId, crop })
    expect(left.subscriber).not.toBeNull()
    // Clicking the right side of the split moves the focus without leaving the pair.
    show(views.right)
    await service.handle({ type: 'stop-frames' })
    expect(left.endFrameSubscription).toHaveBeenCalled()
    expect(left.subscriber).toBeNull()
    expect(right.endFrameSubscription).not.toHaveBeenCalled()
  })

  it('ends when its tab closes, whichever tab is shown', async () => {
    const { service, left, views, events, show } = setup()
    const pending = await service.handle({ type: 'begin' }) as { pendingId: string }
    await service.handle({ type: 'start-recording', pendingId: pending.pendingId, crop })
    show(views.right)
    left.destroy()
    expect(events).toContainEqual({ type: 'recording-interrupted', reason: 'page-closed' })
    // A new recording can start (the old one is over).
    const again = await service.handle({ type: 'begin' }) as { pendingId: string }
    await expect(service.handle({ type: 'start-recording', pendingId: again.pendingId, crop })).resolves.toBeNull()
  })

  it('a tab change ends the recording once, with the recorded page’s frames stopped', async () => {
    const { service, left, views, events, show } = setup()
    const pending = await service.handle({ type: 'begin' }) as { pendingId: string }
    await service.handle({ type: 'start-recording', pendingId: pending.pendingId, crop })
    show(views.right)
    service.pageChanged('tab-changed', views.right as never)
    expect(left.endFrameSubscription).toHaveBeenCalledTimes(1)
    left.destroy()
    expect(events.filter((event) => event.type === 'recording-interrupted')).toHaveLength(1)
  })
})
