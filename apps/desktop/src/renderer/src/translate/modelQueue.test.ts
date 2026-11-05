import { describe, expect, it } from 'vitest'
import type { TranslateStatus } from '@intoponet/browser-api'
import { ModelQueue, modelsToFetch } from './modelQueue'

function status(downloaded: string[], downloading: string | null = null): TranslateStatus {
  return {
    languages: ['de', 'es', 'fr', 'ru'].map((code) => ({ code, bytes: 70_000_000, downloaded: downloaded.includes(code) })),
    engine: { bytes: 5_000_000, downloaded: downloaded.length > 0 },
    downloading: downloading ? { code: downloading, receivedBytes: 0, totalBytes: 1 } : null,
    lastError: null,
    attribution: '',
  }
}

/** A fake main process: one download at a time, like TranslateService. */
function fakeApi(options: { fail?: string[]; busyFirst?: number } = {}) {
  const installed: string[] = []
  const calls: string[] = []
  let running = false
  let busy = options.busyFirst ?? 0
  return {
    installed,
    calls,
    api: {
      status: async () => status(installed),
      install: async (code: string) => {
        calls.push(code)
        if (busy > 0) {
          busy -= 1
          throw new Error("Error invoking remote method 'x': Error: Another language is downloading. Try again when it finishes.")
        }
        if (running) throw new Error('Another language is downloading. Try again when it finishes.')
        if (options.fail?.includes(code)) throw new Error('Download failed (503).')
        running = true
        await Promise.resolve()
        installed.push(code)
        running = false
        return status(installed)
      },
    },
  }
}

const noWait = async (): Promise<void> => undefined

describe('model queue', () => {
  it('downloads missing languages one at a time, each once, skipping English and ones present', async () => {
    const fake = fakeApi()
    const queue = new ModelQueue(fake.api, () => undefined, noWait)
    const [a, b] = await Promise.all([queue.ensure(['en', 'ru', 'es']), queue.ensure(['es', 'ru'])])
    expect(a).toEqual([])
    expect(b).toEqual([])
    expect(fake.calls).toEqual(['ru', 'es'])
    expect(await queue.ensure(['ru'])).toEqual([])
    expect(fake.calls).toEqual(['ru', 'es'])
  })

  it('waits for a download started elsewhere instead of failing', async () => {
    const fake = fakeApi({ busyFirst: 2 })
    const queue = new ModelQueue(fake.api, () => undefined, noWait)
    expect(await queue.ensure(['de'])).toEqual([])
    expect(fake.installed).toEqual(['de'])
  })

  it('reports failures quietly and does not retry them automatically, but a manual install does', async () => {
    const fake = fakeApi({ fail: ['fr'] })
    const queue = new ModelQueue(fake.api, () => undefined, noWait)
    expect(await queue.ensure(['fr', 'de'])).toEqual(['fr'])
    expect(await queue.ensure(['fr'])).toEqual(['fr'])
    expect(fake.calls.filter((code) => code === 'fr')).toHaveLength(1)
    await expect(queue.install('fr')).rejects.toThrow(/503/)
    expect(fake.calls.filter((code) => code === 'fr')).toHaveLength(2)
  })

  it('lets the open page and manual downloads go ahead of headline ones', async () => {
    const fake = fakeApi()
    const queue = new ModelQueue(fake.api, () => undefined, noWait)
    const quiet = queue.ensure(['de', 'es', 'fr'])
    const page = queue.ensure(['ru'], { urgent: true })
    const manual = queue.install('fr')
    await Promise.all([quiet, page, manual])
    expect(fake.calls).toEqual(['de', 'ru', 'fr', 'es'])
  })

  it('treats unknown languages as unavailable without asking the main process', async () => {
    const fake = fakeApi()
    const queue = new ModelQueue(fake.api, () => undefined, noWait)
    expect(await queue.ensure(['pap'])).toEqual(['pap'])
    expect(fake.calls).toEqual([])
  })

  it('downloads a removed language again when next needed', async () => {
    const fake = fakeApi()
    const queue = new ModelQueue(fake.api, () => undefined, noWait)
    await queue.ensure(['ru'])
    fake.installed.length = 0
    queue.status = status([])
    queue.forget('ru')
    await queue.ensure(['ru'])
    expect(fake.calls).toEqual(['ru', 'ru'])
  })
})

describe('models to fetch', () => {
  const supported = (code: string | null): boolean => !!code && ['en', 'de', 'es', 'ru'].includes(code)
  it('puts your language first, then sources by how many items need them', () => {
    const groups = new Map<string, unknown[]>([['es', [1]], ['ru', [1, 2, 3]]])
    expect(modelsToFetch(groups, 'de', new Set(['en']), supported)).toEqual(['de', 'ru', 'es'])
    expect(modelsToFetch(groups, 'en', new Set(['en', 'ru']), supported)).toEqual(['es'])
  })
  it('fetches nothing when nothing needs translating', () => {
    expect(modelsToFetch(new Map(), 'de', new Set(['en']), supported)).toEqual([])
  })
})
