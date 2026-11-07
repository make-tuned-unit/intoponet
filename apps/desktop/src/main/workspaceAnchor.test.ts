import { describe, expect, it } from 'vitest'
import { parseWorkspaceCommand, workspaceAnchor } from '@intoponet/browser-api'
import { MAIN_WORKSPACE, parseSavedWorkspaces, WorkspaceSet, type Workspace } from './workspaces'

type Tab = { id: string }
const lisbon = { lat: 38.72, lon: -9.14, label: 'Lisbon, Portugal', placeId: 'lisbon' }

describe('workspace anchors', () => {
  it('accepts a place with finite coordinates in range and a label of at most 80 characters', () => {
    expect(workspaceAnchor(lisbon)).toEqual(lisbon)
    expect(workspaceAnchor({ lat: -90, lon: 180, label: 'x'.repeat(120) }).label).toHaveLength(80)
    expect(workspaceAnchor({ lat: 0, lon: 0, label: '  Two\nlines  ' }).label).toBe('Two lines')
  })

  it('rejects latitude and longitude out of range, non-finite numbers and an empty label', () => {
    expect(() => workspaceAnchor({ ...lisbon, lat: 91 })).toThrow()
    expect(() => workspaceAnchor({ ...lisbon, lon: -180.5 })).toThrow()
    expect(() => workspaceAnchor({ ...lisbon, lat: Number.NaN })).toThrow()
    expect(() => workspaceAnchor({ ...lisbon, lon: 'nine' })).toThrow()
    expect(() => workspaceAnchor({ ...lisbon, label: '   ' })).toThrow()
    expect(() => workspaceAnchor(null)).toThrow()
  })

  it('parses update-workspace with an anchor, or with null to remove it, and leaves it out when absent', () => {
    expect(parseWorkspaceCommand({ type: 'update-workspace', id: 'main', anchor: lisbon })).toEqual({ type: 'update-workspace', id: 'main', anchor: lisbon })
    expect(parseWorkspaceCommand({ type: 'update-workspace', id: 'main', anchor: null })).toEqual({ type: 'update-workspace', id: 'main', anchor: null })
    expect(parseWorkspaceCommand({ type: 'update-workspace', id: 'main', name: 'Desk' })).toEqual({ type: 'update-workspace', id: 'main', name: 'Desk' })
    expect(() => parseWorkspaceCommand({ type: 'update-workspace', id: 'main', anchor: { lat: 200, lon: 0, label: 'x' } })).toThrow()
  })

  it('sets, replaces and removes a workspace anchor, reporting only real changes', () => {
    const set = new WorkspaceSet<Tab>()
    expect(set.update('main', { anchor: lisbon })).toBe(true)
    expect(set.get('main')?.anchor).toEqual(lisbon)
    expect(set.update('main', { anchor: { ...lisbon } })).toBe(false)
    expect(set.update('main', { anchor: { ...lisbon, label: 'Lisboa' } })).toBe(true)
    expect(set.update('main', { anchor: null })).toBe(true)
    expect(set.get('main')?.anchor).toBeUndefined()
    expect(set.update('main', { anchor: null })).toBe(false)
  })

  it('keeps a valid saved anchor and drops a damaged one without losing the workspace', () => {
    const saved = parseSavedWorkspaces({
      workspaces: [
        { id: 'main', name: 'Main', icon: 'globe', accent: 'teal', anchor: lisbon },
        { id: 'work', name: 'Work', icon: 'briefcase', accent: 'cyan', anchor: { lat: 999, lon: 0, label: 'Nowhere' } },
      ],
      activeWorkspaceId: 'main',
    })
    expect(saved.workspaces[0]?.anchor).toEqual(lisbon)
    expect(saved.workspaces[1]).toMatchObject({ id: 'work', name: 'Work' })
    expect(saved.workspaces[1]?.anchor).toBeUndefined()
  })

  it('leaves the anchor out of a workspace that has none (existing saved state reads as before)', () => {
    const saved = parseSavedWorkspaces({ workspaces: [{ id: 'main', name: 'Main', icon: 'globe', accent: 'teal' }], activeWorkspaceId: 'main' })
    expect(saved.workspaces[0]).not.toHaveProperty('anchor')
    const workspace: Workspace = { ...MAIN_WORKSPACE }
    expect(workspace.anchor).toBeUndefined()
  })
})
