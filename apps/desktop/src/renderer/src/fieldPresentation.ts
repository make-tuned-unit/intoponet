import type { FieldSnapshot } from '@intoponet/field-snapshot'

export type TopicOption = { id: string; label: string; kind: 'public' | 'synthetic' | 'mixed'; measurements: string[] }

export const syntheticTopics = ['Open knowledge', 'Local archives', 'Civic memory', 'Open research'] as const
const knownTopicLabels: Record<string, string> = {
  'open-knowledge': 'Open knowledge',
  'local-archives': 'Local archives',
  'civic-memory': 'Civic memory',
  'open-research': 'Open research',
}
const measurementLabels: Record<string, string> = {
  'wikimedia-pageviews': 'Wikimedia pageviews',
  'usgs-earthquake-magnitude': 'USGS earthquake magnitude',
  'synthetic-fixture': 'Synthetic fixture',
  'declared-index': 'Declared index',
  'legacy-pageviews-weight': 'Legacy pageview estimate',
  'legacy-earthquake-weight': 'Legacy earthquake estimate',
  'legacy-untyped': 'Legacy untyped measurement',
}

export function topicLabel(id: string): string {
  return knownTopicLabels[id] ?? id.split(/[-_\s]+/).filter(Boolean).map((part) => `${part[0]?.toLocaleUpperCase() ?? ''}${part.slice(1)}`).join(' ')
}

export function topicOptions(snapshot: FieldSnapshot | null): TopicOption[] {
  if (!snapshot) return syntheticTopics.map((label) => ({ id: label, label, kind: 'synthetic', measurements: ['Synthetic fixture'] }))
  const ids = [...new Set([
    ...snapshot.sources.flatMap((source) => source.topics),
    ...snapshot.bands.flatMap((band) => band.topicIds),
  ])].filter(Boolean).sort((a, b) => a.localeCompare(b))
  return ids.map((id) => {
    const sources = snapshot.sources.filter((source) => source.topics.includes(id))
    const bands = snapshot.bands.filter((band) => band.topicIds.includes(id))
    const hasPublic = sources.some((source) => source.kind === 'public-record') || bands.some((band) => band.sourceType === 'public-aggregate')
    const hasSynthetic = sources.some((source) => source.kind === 'synthetic-fixture') || bands.some((band) => band.sourceType === 'synthetic')
    const measurements = [...new Set([
      ...sources.map((source) => measurementLabels[source.measurement.kind] ?? source.measurement.kind),
      ...bands.map((band) => measurementLabels[band.measurement.kind] ?? band.measurement.kind),
    ])].sort()
    return {
      id,
      label: topicLabel(id),
      kind: hasPublic && hasSynthetic ? 'mixed' : hasPublic ? 'public' : 'synthetic',
      measurements,
    }
  })
}

export function resolveSelectedTopic(topics: TopicOption[], activeTopic: string): TopicOption | undefined {
  return topics.find((topic) => topic.label === activeTopic || topic.id === activeTopic) ?? topics[0]
}

export function snapshotKind(snapshot: FieldSnapshot | null): 'prototype' | 'public' | 'synthetic' | 'mixed' {
  if (!snapshot || snapshot.sources.length === 0) return 'prototype'
  const kinds = new Set(snapshot.sources.map((source) => source.kind))
  return kinds.size > 1 ? 'mixed' : kinds.has('public-record') ? 'public' : 'synthetic'
}
