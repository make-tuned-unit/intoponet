import { describe, expect, it } from 'vitest'
import { LatestWriter, latestWritesInFlight } from './latestWriter'

function deferredWrites() {
  const written: string[] = []
  const gates: Array<() => void> = []
  const writer = new LatestWriter<string>((value) => new Promise<void>((resolve, reject) => {
    gates.push(() => {
      if (value === 'bad') reject(new Error('disk full'))
      else { written.push(value); resolve() }
    })
  }))
  const release = async (): Promise<void> => {
    await Promise.resolve()
    gates.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { writer, written, release, gates }
}

describe('latest-only ordered writer', () => {
  it('writes in order and skips values superseded while a write runs', async () => {
    const { writer, written, release } = deferredWrites()
    const first = writer.save('a')
    const second = writer.save('b')
    const third = writer.save('c')
    expect(writer.pending).toBe(true)
    await release()
    await release()
    await Promise.all([first, second, third])
    expect(written).toEqual(['a', 'c'])
    expect(writer.pending).toBe(false)
  })

  it('reports a failed write to its callers and keeps going', async () => {
    const { writer, written, release } = deferredWrites()
    const bad = writer.save('bad')
    const outcome = bad.then(() => 'ok', (error: Error) => error.message)
    await release()
    expect(await outcome).toBe('disk full')
    const good = writer.save('good')
    await release()
    await good
    expect(written).toEqual(['good'])
  })

  it('flush waits for everything asked for', async () => {
    const { writer, written, release } = deferredWrites()
    void writer.save('a')
    void writer.save('b')
    let flushed = false
    const flushing = writer.flush().then(() => { flushed = true })
    await release()
    expect(flushed).toBe(false)
    await release()
    await flushing
    expect(flushed).toBe(true)
    expect(written).toEqual(['a', 'b'])
  })

  it('discard drops a waiting value but lets a running write finish', async () => {
    const { writer, written, release } = deferredWrites()
    void writer.save('a')
    const dropped = writer.save('b')
    const discarding = writer.discard()
    await dropped
    await release()
    await discarding
    expect(written).toEqual(['a'])
    expect(writer.pending).toBe(false)
  })
  it('is listed for the quit while a save runs or waits, until its last save is written', async () => {
    const { writer, written, release } = deferredWrites()
    expect(latestWritesInFlight()).toEqual([])
    void writer.save('a')
    expect(latestWritesInFlight()).toHaveLength(1)
    const listed = Promise.all(latestWritesInFlight()).then(() => [...written])
    // A save asked for while the first runs (a late one) is part of the same wait.
    void writer.save('b')
    await release()
    expect(latestWritesInFlight()).toHaveLength(1)
    await release()
    expect(await listed).toEqual(['a', 'b'])
    expect(latestWritesInFlight()).toEqual([])
  })
})
