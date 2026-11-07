import { describe, expect, it } from 'vitest'
import { archiveAfterMs, TabArchive } from './tabArchive'

describe('tab archive', () => {
  it('maps the setting to a wait, or off', () => {
    expect(archiveAfterMs('off')).toBeNull()
    expect(archiveAfterMs('12h')).toBe(12 * 3_600_000)
    expect(archiveAfterMs('1w', 1_000)).toBe(168_000)
  })

  it('keeps one entry per address, newest first, with its back/forward list', () => {
    let now = 1_000
    const archive = new TabArchive(() => now)
    archive.add({ url: 'https://a.example/', title: 'A', favicon: '', history: { entries: [{ url: 'https://a.example/x', title: 'X' }, { url: 'https://a.example/', title: 'A' }], index: 1 } })
    now = 2_000
    archive.add({ url: 'https://b.example/', title: 'B', favicon: 'https://evil.example/i.png' })
    now = 3_000
    archive.add({ url: 'https://a.example/', title: 'A again', favicon: '' })
    expect(archive.list().map((entry) => entry.title)).toEqual(['A again', 'B'])
    expect(archive.list()[1]!.favicon).toBe('')
    expect(archive.add({ url: 'file:///etc/passwd', title: 'no', favicon: '' })).toBeNull()
    const taken = archive.take(archive.list()[0]!.id)
    expect(taken?.url).toBe('https://a.example/')
    expect(archive.size).toBe(1)
  })

  it('round-trips, drops bad entries, and is cleared with history', () => {
    let now = 10_000
    const archive = new TabArchive(() => now)
    archive.add({ url: 'https://a.example/', title: 'A', favicon: '', history: { entries: [{ url: 'https://a.example/', title: 'A' }], index: 0 } })
    now = 20_000
    archive.add({ url: 'https://b.example/', title: 'B', favicon: '' })
    const restored = new TabArchive(() => now)
    const payload = JSON.parse(archive.serialize())
    payload.entries.push({ id: 'x', url: 'javascript:alert(1)', title: 'bad', favicon: '', archivedAt: 1 })
    expect(restored.load(JSON.stringify(payload))).toBe(true)
    expect(restored.list().map((entry) => entry.url)).toEqual(['https://b.example/', 'https://a.example/'])
    expect(restored.take(restored.list()[1]!.id)?.history?.entries).toHaveLength(1)
    // An unreadable payload says so, so the caller keeps that file instead of saving over it.
    expect(restored.load('not json')).toBe(false)
    expect(restored.load(JSON.stringify({ schema: 'something-else', entries: [] }))).toBe(false)
    expect(restored.size).toBe(1)
    restored.deleteSince(15_000)
    expect(restored.size).toBe(0)
  })

  it('keeps the workspace and folder a tab was archived from, but lists neither', () => {
    const archive = new TabArchive(() => 5_000)
    archive.add({ url: 'https://a.example/', title: 'A', favicon: '', workspaceId: 'work', folderId: 'papers' })
    archive.add({ url: 'https://b.example/', title: 'B', favicon: '' })
    expect(Object.keys(archive.list()[0]!).sort()).toEqual(['archivedAt', 'favicon', 'id', 'title', 'url'])
    const restored = new TabArchive(() => 5_000)
    const payload = JSON.parse(archive.serialize())
    // An entry saved before workspaces were recorded, and one with a damaged place.
    payload.entries.push({ id: 'old', url: 'https://old.example/', title: 'Old', favicon: '', archivedAt: 4_000 })
    payload.entries.push({ id: 'bad', url: 'https://bad.example/', title: 'Bad', favicon: '', archivedAt: 3_000, workspaceId: 7, folderId: 'papers' })
    expect(restored.load(JSON.stringify(payload))).toBe(true)
    const place = (url: string) => {
      const entry = restored.take(restored.list().find((item) => item.url === url)!.id)
      return [entry?.workspaceId, entry?.folderId]
    }
    expect(place('https://a.example/')).toEqual(['work', 'papers'])
    expect(place('https://b.example/')).toEqual([undefined, undefined])
    expect(place('https://old.example/')).toEqual([undefined, undefined])
    expect(place('https://bad.example/')).toEqual([undefined, undefined])
  })

  it('forgets tabs archived more than 90 days ago', () => {
    let now = 0
    const archive = new TabArchive(() => now)
    archive.add({ url: 'https://a.example/', title: 'A', favicon: '' })
    now = 91 * 86_400_000
    archive.prune()
    expect(archive.size).toBe(0)
  })
})
