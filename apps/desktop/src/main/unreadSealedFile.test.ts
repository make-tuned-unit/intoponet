import { describe, expect, it, vi } from 'vitest'
import { UnreadSealedFile } from './unreadSealedFile'

function sealedFile(options: { exists?: boolean; readable?: boolean } = {}) {
  let available = false
  const onDisk = ['old-a', 'old-b']
  const memory: string[] = ['new']
  const setAside = vi.fn()
  const onRead = vi.fn()
  const file = new UnreadSealedFile<string>({
    exists: () => options.exists ?? true,
    available: () => available,
    read: (keep) => {
      if (options.readable === false) throw new Error('not a sealed file')
      memory.push(...onDisk.filter(keep))
      return true
    },
    setAside,
    onRead,
  })
  return { file, memory, setAside, onRead, grant: () => { available = true } }
}

describe('a sealed file left unread at startup (the Keychain unavailable)', () => {
  it('is not read, and saving is not safe, while encryption is unavailable', async () => {
    const { file, memory, onRead } = sealedFile()
    file.markUnread()
    expect(await file.settle()).toBe(false)
    expect(file.isUnread).toBe(true)
    expect(memory).toEqual(['new'])
    expect(onRead).not.toHaveBeenCalled()
  })

  it('is read once encryption is available, merged with what this run recorded', async () => {
    const { file, memory, onRead, grant } = sealedFile()
    file.markUnread()
    await file.settle()
    grant()
    expect(await file.settle()).toBe(true)
    expect(file.isUnread).toBe(false)
    expect(memory).toEqual(['new', 'old-a', 'old-b'])
    expect(onRead).toHaveBeenCalledOnce()
    // Read once only.
    expect(await file.settle()).toBe(true)
    expect(memory).toEqual(['new', 'old-a', 'old-b'])
  })

  it('leaves out what was removed while it was unread (history cleared meanwhile)', async () => {
    const { file, memory, grant } = sealedFile()
    file.markUnread()
    file.removed((item) => item === 'old-b')
    grant()
    await file.settle()
    expect(memory).toEqual(['new', 'old-a'])
  })

  it('reads once when asked twice at the same time', async () => {
    const { file, memory, grant } = sealedFile()
    file.markUnread()
    grant()
    expect(await Promise.all([file.settle(), file.settle()])).toEqual([true, true])
    expect(memory).toEqual(['new', 'old-a', 'old-b'])
  })

  it('keeps a file that turns out unreadable aside, then saving is safe', async () => {
    const { file, setAside, grant } = sealedFile({ readable: false })
    file.markUnread()
    grant()
    expect(await file.settle()).toBe(true)
    expect(setAside).toHaveBeenCalledOnce()
  })

  it('has nothing to read when the file has gone, and removals made meanwhile are not kept', async () => {
    const { file, memory } = sealedFile({ exists: false })
    file.markUnread()
    file.removed(() => true)
    expect(await file.settle()).toBe(true)
    expect(memory).toEqual(['new'])
    // Not unread any more: later removals are not recorded.
    file.removed(() => true)
    expect(file.isUnread).toBe(false)
  })
})
