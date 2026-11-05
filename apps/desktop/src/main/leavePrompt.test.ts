import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { bindLeavePrompt, LEAVE_PAGE_DIALOG } from './leavePrompt'

function setup(answer: number | null) {
  const contents = new EventEmitter()
  const window = { isDestroyed: () => false } as unknown as Electron.BrowserWindow
  const show = vi.fn(() => answer ?? 0)
  bindLeavePrompt(contents as unknown as Electron.WebContents, () => (answer === null ? null : window), show)
  const event = { preventDefault: vi.fn() }
  contents.emit('will-prevent-unload', event)
  return { show, event }
}

describe('leave prompt', () => {
  it('leaves (overrides beforeunload) when the person picks Leave', () => {
    const { show, event } = setup(0)
    expect(show).toHaveBeenCalledWith(expect.anything(), LEAVE_PAGE_DIALOG)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('stays when the person picks Stay', () => {
    const { event } = setup(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('leaves without asking when there is no window', () => {
    const { show, event } = setup(null)
    expect(show).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
  })
})
