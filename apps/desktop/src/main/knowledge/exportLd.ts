import type { KnowledgeDocument } from './contract'

export const KNOWLEDGE_EXPORT_SCHEMA = 'intoponet.knowledge-export.v1'

/**
 * PRD §8.4 portability: absorbed pages as schema.org JSON-LD. Paragraphs keep
 * their order, so a paragraph's index is the same citation anchor the app
 * uses. Embeddings and search indexes are derived data and are not exported.
 */
export function knowledgeToJsonLd(documents: KnowledgeDocument[], exportedAt: Date): string {
  const parts = documents.map((doc) => ({
    '@type': 'CreativeWork',
    '@id': doc.url,
    url: doc.url,
    name: doc.title,
    ...(doc.siteName ? { publisher: { '@type': 'Organization', name: doc.siteName } } : {}),
    ...(doc.lang ? { inLanguage: doc.lang } : {}),
    ...(doc.publishedAt ? { datePublished: doc.publishedAt } : {}),
    dateCreated: doc.absorbedAt,
    ...(doc.note ? { comment: { '@type': 'Comment', text: doc.note } } : {}),
    wordCount: doc.wordCount,
    absorbScope: doc.scope,
    keywords: doc.entities.map((entity) => entity.text),
    spatialCoverage: doc.places.map((place) => ({
      '@type': 'Place',
      name: place.name,
      address: { '@type': 'PostalAddress', addressCountry: place.countryCode },
      geo: { '@type': 'GeoCoordinates', latitude: place.lat, longitude: place.lon },
      mentions: place.count,
    })),
    temporalCoverage: doc.dates.map((date) => date.iso ?? date.text),
    paragraphs: doc.paragraphs,
  }))
  return `${JSON.stringify({
    '@context': {
      '@vocab': 'https://schema.org/',
      paragraphs: { '@id': 'https://schema.org/text', '@container': '@list' },
      absorbScope: { '@id': 'urn:intoponet:absorbScope' },
      mentions: { '@id': 'urn:intoponet:mentions' },
      exportSchema: { '@id': 'urn:intoponet:exportSchema' },
    },
    '@type': 'Collection',
    exportSchema: KNOWLEDGE_EXPORT_SCHEMA,
    name: 'Intoponet knowledge',
    dateCreated: exportedAt.toISOString(),
    description: 'Pages absorbed on this device, with their readable text. A paragraph’s position in "paragraphs" is its citation index.',
    hasPart: parts,
  }, null, 2)}\n`
}
