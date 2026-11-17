import { describe, expect, it } from 'vitest'
import { STEADY_ROWS_MS, steadyRowsWait, worldEmptyText } from './WorldStories'

describe('worldEmptyText', () => {
  it('says the list waits for a connection when offline, not that it needs hours of headlines', () => {
    expect(worldEmptyText(false)).toMatch(/^Waiting for a connection/)
    expect(worldEmptyText(false)).not.toMatch(/few hours/)
  })
  it('keeps the explanation for an online list that has no story yet', () => {
    expect(worldEmptyText(true)).toMatch(/few hours of headlines/)
  })
  it('says the headlines are being read until the first news of a launch arrives, not that there is no story', () => {
    expect(worldEmptyText(true, true)).toMatch(/^Reading the headlines/)
    expect(worldEmptyText(true, true)).not.toMatch(/No story|few hours/)
    // Offline, nothing is being read: it waits for a connection.
    expect(worldEmptyText(false, true)).toMatch(/^Waiting for a connection/)
  })
})

describe('steadyRowsWait', () => {
  it('replaces rows at once when the pointer is not over them', () => {
    expect(steadyRowsWait(null, 10_000)).toBe(0)
  })
  it('keeps rows the pointer is moving over until it has rested, then lets the newer ones in', () => {
    expect(steadyRowsWait(10_000, 10_000)).toBe(STEADY_ROWS_MS)
    expect(steadyRowsWait(10_000, 10_000 + STEADY_ROWS_MS - 1)).toBe(1)
    expect(steadyRowsWait(10_000, 10_000 + STEADY_ROWS_MS)).toBe(0)
    expect(steadyRowsWait(10_000, 60_000)).toBe(0)
  })
})
