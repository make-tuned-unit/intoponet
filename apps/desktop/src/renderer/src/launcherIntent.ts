import { inferLauncherIntent } from '@intoponet/browser-api'

export type ExploreTopic = { id: string; label: string }

/** URL strings open directly; explicit topic matches explore; other text searches. */
export function inferUnifiedLauncherIntent(value: string, topics: readonly ExploreTopic[]) {
  const text = value.trim()
  const automatic = inferLauncherIntent(text, 'search')
  if (automatic.kind === 'url') return automatic

  const explorePrefix = text.match(/^(?:explore|topic):\s*(.+)$/i)
  if (explorePrefix?.[1]?.trim()) return { kind: 'topic' as const, value: explorePrefix[1].trim() }
  const searchPrefix = text.match(/^(?:search|web):\s*(.+)$/i)
  if (searchPrefix?.[1]?.trim()) return { kind: 'search' as const, value: searchPrefix[1].trim() }

  const normalized = text.toLocaleLowerCase('en').replace(/\s+/g, ' ')
  const matchedTopic = topics.find((topic) =>
    topic.label.toLocaleLowerCase('en').replace(/\s+/g, ' ') === normalized ||
    topic.id.toLocaleLowerCase('en').replace(/\s+/g, ' ') === normalized,
  )
  return matchedTopic
    ? { kind: 'topic' as const, value: matchedTopic.label }
    : automatic
}
