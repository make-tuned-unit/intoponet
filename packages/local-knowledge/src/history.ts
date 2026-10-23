export type HistoricalRelationship = 'contributed_to' | 'analogous_to' | 'preceded_by'

export type HistoricalEdge = {
  id: string
  from: string
  to: string
  relationship: HistoricalRelationship
  epistemicStatus: 'sourced' | 'contested'
  citationUrl: string
  citationTitle: string
  publishedAt: string
}

export const historicalFixtures: HistoricalEdge[] = [
  {
    id: 'edge-fixture-contribution',
    from: 'Archive record',
    to: 'Present question',
    relationship: 'contributed_to',
    epistemicStatus: 'sourced',
    citationUrl: 'https://fixtures.intoponet.test/archive',
    citationTitle: 'Synthetic archive fixture',
    publishedAt: '1980-01-01',
  },
  {
    id: 'edge-fixture-contest',
    from: 'Second reading',
    to: 'Present question',
    relationship: 'contributed_to',
    epistemicStatus: 'contested',
    citationUrl: 'https://fixtures.intoponet.test/contest',
    citationTitle: 'Synthetic contested fixture',
    publishedAt: '1994-06-01',
  },
  {
    id: 'edge-fixture-analogy',
    from: 'Earlier event',
    to: 'Later event',
    relationship: 'analogous_to',
    epistemicStatus: 'sourced',
    citationUrl: 'https://fixtures.intoponet.test/analogy',
    citationTitle: 'Synthetic analogy fixture',
    publishedAt: '1972-03-01',
  },
  {
    id: 'edge-fixture-sequence',
    from: 'Earlier event',
    to: 'Later event',
    relationship: 'preceded_by',
    epistemicStatus: 'sourced',
    citationUrl: 'https://fixtures.intoponet.test/sequence',
    citationTitle: 'Synthetic sequence fixture',
    publishedAt: '1960-01-01',
  },
]

export function relationshipLabel(edge: HistoricalEdge): string {
  if (edge.relationship === 'analogous_to') return 'Analogy. Not a cause.'
  if (edge.relationship === 'preceded_by') return 'Earlier in time. Not a cause.'
  if (edge.epistemicStatus === 'contested') return 'Contested contribution. See the citation.'
  return 'Sourced contribution. See the citation.'
}

export function presentedAsCause(edge: HistoricalEdge): boolean {
  return edge.relationship === 'contributed_to' && edge.epistemicStatus === 'sourced'
}
