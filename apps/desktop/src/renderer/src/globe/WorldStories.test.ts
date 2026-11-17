import { describe, expect, it } from 'vitest'
import { termLabel, worldEmptyText } from './WorldStories'

describe('worldEmptyText', () => {
  it('says the list waits for a connection when offline, not that it needs hours of headlines', () => {
    expect(worldEmptyText(false)).toMatch(/^Waiting for a connection/)
    expect(worldEmptyText(false)).not.toMatch(/few hours/)
  })
  it('keeps the explanation for an online list that has no story yet', () => {
    expect(worldEmptyText(true)).toMatch(/few hours of headlines/)
  })
})

describe('termLabel', () => {
  it('shows a country among a story’s shared words as its name, not as a slug', () => {
    expect(['south-africa', 'shootings', 'dr-congo'].map(termLabel).join(', ')).toBe('south africa, shootings, dr congo')
  })
})
