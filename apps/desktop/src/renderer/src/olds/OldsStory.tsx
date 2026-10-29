import { ArrowRight, BookOpen, CircleCheck, CircleDashed, CircleHelp, Newspaper } from 'lucide-react'
import type { OldsChapter, OldsChronicleEntry, OldsContext, OldsEdge, OldsNode, OldsSupport } from '@intoponet/browser-api'

/** The path read forwards in time (old → new): how the older step relates to the newer one. */
const FORWARD: Record<string, string> = {
  'was caused by': 'led to',
  'is part of': 'includes',
  'came after': 'then',
  replaced: 'was replaced by',
}

export function supportWords(support: OldsSupport | undefined): { label: string; tone: 'strong' | 'medium' | 'weak'; detail: string } {
  if (!support) return { label: 'Not checked', tone: 'weak', detail: 'This link was not checked.' }
  const corroboration = support.corroborated === true
    ? support.checkedIn ? ` Also named in the Wikipedia article “${support.checkedIn}”.` : ''
    : support.corroborated === false && support.checkedIn ? ` Not found in the text of “${support.checkedIn}”.` : ''
  switch (support.level) {
    case 'article':
      return { label: 'From Wikipedia', tone: 'strong', detail: 'This comes from the structure of the Wikipedia history article (the chapter names it as its main article).' }
    case 'referenced':
      return { label: support.corroborated ? 'Referenced · corroborated' : 'Referenced', tone: 'strong', detail: `The Wikidata statement cites an outside source.${corroboration}` }
    case 'wiki-imported':
      return { label: support.corroborated ? 'Wikipedia only · corroborated' : 'Wikipedia only', tone: support.corroborated ? 'medium' : 'weak', detail: `The Wikidata statement's only reference is “imported from Wikipedia”.${corroboration}` }
    case 'unreferenced':
      return { label: support.corroborated ? 'Unreferenced · corroborated' : 'Unreferenced', tone: support.corroborated ? 'medium' : 'weak', detail: `The Wikidata statement has no reference.${corroboration}` }
  }
}

export function SupportBadge({ support }: { support: OldsSupport | undefined }) {
  const words = supportWords(support)
  const Icon = words.tone === 'strong' ? CircleCheck : words.tone === 'medium' ? CircleDashed : CircleHelp
  return (
    <span className={`olds-support is-${words.tone}`} title={words.detail}>
      <Icon size={11} aria-hidden="true" /> {words.label}
    </span>
  )
}

type Selection = { kind: 'step'; node: OldsNode; edge: OldsEdge | null; relation: string } | { kind: 'chapter'; chapter: OldsChapter }

/**
 * "Why it's in the news": the matched topic and the sourced path back
 * through history, read left (oldest) to right (today).
 */
export function OldsStory({
  context,
  selectedKey,
  onSelect,
  onPickTopic,
  onOpen,
  onFollowArticle,
  chronicle = [],
}: {
  context: OldsContext
  selectedKey: string | null
  onSelect: (key: string, selection: Selection) => void
  onPickTopic?: ((topic: string) => void) | undefined
  onOpen: (url: string) => void
  /** Open a Wikipedia topic as its own history thread. */
  onFollowArticle?: ((title: string) => void) | undefined
  /** Dated events from the topic's own article, oldest first. */
  chronicle?: OldsChronicleEntry[] | undefined
}) {
  // Oldest first: the chapter, then the path reversed, then today.
  const steps = [...context.path].reverse()
  return (
    <div className="olds-story">
      <div className="olds-story-track" aria-label="The path from history to this story">
        {context.chapter && (
          <>
            <button
              type="button"
              className={`olds-story-card is-chapter${selectedKey === 'chapter' ? ' is-selected' : ''}`}
              onClick={() => onSelect('chapter', { kind: 'chapter', chapter: context.chapter! })}
            >
              <span className="olds-story-kind"><BookOpen size={11} aria-hidden="true" /> Chapter of {context.chapterSource?.title.replace(/^History of /, '') ?? 'its history'}</span>
              <strong>{context.chapter.title}</strong>
              {context.chapter.start && <span className="olds-card-date">{context.chapter.start.label}{context.chapter.end ? ` – ${context.chapter.end.label}` : ' – today'}</span>}
            </button>
            <span className="olds-story-link is-context" aria-hidden="true"><ArrowRight size={13} /><small>context</small></span>
          </>
        )}
        {steps.map((step, index) => {
          const key = `step-${step.node.id}`
          // Each step stores how the newer step relates to it ("was caused by"), which labels the link after this card.
          const newer = steps[index + 1]
          const relation = newer ? step.relation : ''
          const isTopic = step.node.id === context.topicId
          return (
            <span key={key} className="olds-story-step">
              <button
                type="button"
                className={`olds-story-card${isTopic ? ' is-topic' : ''}${selectedKey === key ? ' is-selected' : ''}`}
                onClick={() => onSelect(key, { kind: 'step', node: step.node, edge: step.edge, relation: step.relation })}
              >
                <span className="olds-story-kind">{isTopic ? 'This story is about' : index === 0 ? 'Where it starts' : 'Then'}</span>
                <strong>{step.node.label}</strong>
                <span className="olds-card-date">{step.node.start?.label ?? 'Undated'}</span>
                {step.edge && <SupportBadge support={step.edge.support} />}
              </button>
              {newer && relation ? (
                <span className="olds-story-link" aria-hidden="true"><ArrowRight size={13} /><small>{FORWARD[relation] ?? relation}</small></span>
              ) : null}
            </span>
          )
        })}
        <span className="olds-story-link is-now" aria-hidden="true"><ArrowRight size={13} /><small>today</small></span>
        <div className="olds-story-card is-today">
          <span className="olds-story-kind"><Newspaper size={11} aria-hidden="true" /> In the news</span>
          <strong>{context.headline}</strong>
          {context.filedUnder && context.filedUnder.threads.length > 0 && (
            <span className="olds-filed" title={`Wikipedia’s Current events, ${context.filedUnder.date}: ${context.filedUnder.item}`}>
              Part of{' '}
              {context.filedUnder.threads.map((title, index) => (
                <span key={title}>
                  {index > 0 && ' › '}
                  {onFollowArticle ? <button type="button" onClick={() => onFollowArticle(title)}>{title}</button> : title}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      {chronicle.length > 0 && (
        <section className="olds-chronicle" aria-label="How we got here">
          <h3 title="Dated passages from the topic’s Wikipedia article and explicitly linked background articles. Open each passage to see its sources.">How we got here</h3>
          <ol>
            {chronicle.map((entry, index) => (
              <li key={`${entry.at.iso}-${index}`}>
                <time dateTime={entry.at.iso}>{entry.at.label}</time>
                <div>
                  <p>{entry.text}</p>
                  <span className="olds-chronicle-actions">
                    <button type="button" onClick={() => onOpen(entry.url)}>{entry.sourceTitle ? `Context: ${entry.sourceTitle} · ` : 'From '}“{entry.section}”</button>
                    {entry.link && onFollowArticle && <button type="button" onClick={() => onFollowArticle(entry.link!)}>{entry.link}: its history <ArrowRight size={10} aria-hidden="true" /></button>}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {context.related && context.related.length > 0 && (
        <section className="olds-related" aria-label="Topics behind this story">
          <h3 title="The subjects this story is about, in its country, from Wikipedia. Figures are quoted from each article; open it to check their sources and dates.">Topics behind this story</h3>
          <div className="olds-related-cards">
            {context.related.map((topic) => (
              <article key={topic.title} className="olds-related-card">
                <strong>{topic.title}</strong>
                {topic.description && <small>{topic.description}</small>}
                {topic.figures.length > 0 && (
                  <ul aria-label="Key figures">
                    {topic.figures.map((figure) => <li key={figure}>{figure}</li>)}
                  </ul>
                )}
                <span className="olds-related-actions">
                  {onFollowArticle && <button type="button" onClick={() => onFollowArticle(topic.title)}>Its history <ArrowRight size={11} aria-hidden="true" /></button>}
                  <button type="button" onClick={() => onOpen(topic.url)}>Read on Wikipedia</button>
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
      <p className="olds-story-note">
        {context.matchedBy} {context.path.length > 1 ? 'Each step follows a cause, “part of” or sequence link on Wikidata, checked against Wikipedia text.' : 'Wikidata has no cause or “part of” links for this topic yet, so the path stops here; its own timeline and links are under Timeline.'}
      </p>
      {context.candidates.length > 0 && onPickTopic && (
        <div className="olds-story-alts">
          <span>Not the right topic?</span>
          {context.candidates.map((candidate) => (
            <button key={candidate.id} type="button" className="olds-chip" title={candidate.description ?? undefined} onClick={() => onPickTopic(candidate.id)}>
              {candidate.label}
            </button>
          ))}
        </div>
      )}
      {context.chapter && context.chapterSource && (
        <button type="button" className="olds-story-source" onClick={() => onOpen(context.chapter!.url)}>
          Chapter from “{context.chapterSource.title}” on Wikipedia
        </button>
      )}
    </div>
  )
}

export type { Selection as StorySelection }
