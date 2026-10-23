import { beforeEach, describe, expect, it } from 'vitest'
import { rememberRecent, renameCollection, type RecentPage } from './localLibrary'

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    },
  })
})

describe('rememberRecent', () => {
  it('moves a revisited page to the front and caps the list', () => {
    const seed: RecentPage[] = Array.from({ length: 40 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: `Page ${index}`,
      visitedAt: '2026-01-01T00:00:00.000Z',
    }))

    const next = rememberRecent(seed, {
      url: 'https://example.com/2',
      title: 'Updated',
      visitedAt: '2026-01-02T00:00:00.000Z',
    })

    expect(next[0]).toMatchObject({ url: 'https://example.com/2', title: 'Updated' })
    expect(next).toHaveLength(40)
    expect(next.filter((page) => page.url === 'https://example.com/2')).toHaveLength(1)
  })
})

describe('renameCollection', () => {
  it('renames a matching collection and ignores blank labels', () => {
    const collections = [
      { id: 'a', label: 'Old', createdAt: '2026-01-01T00:00:00.000Z', memberUrls: [] },
    ]
    expect(renameCollection(collections, 'a', '  Civic  ')[0]?.label).toBe('Civic')
    expect(renameCollection(collections, 'a', '   ')).toEqual(collections)
  })
})
