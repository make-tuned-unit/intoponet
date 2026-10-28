const USER_AGENT = 'Intoponet/0.1 (+https://github.com/make-tuned-unit/intoponet; Place trends)'
const TIMEOUT_MS = 8_000
const MAX_NAMES = 8

/** Names already looked up (city id + languages), kept for the session. */
const cache = new Map<string, Promise<string[]>>()

type Entity = {
  labels?: Record<string, { value?: string }>
  aliases?: Record<string, Array<{ value?: string }>>
}

/**
 * What a city is called in its own news: its Wikidata names in the languages
 * its local outlets write in (Roma, München, Bruxelles…), found from the
 * city's GeoNames ID. Only the public city ID is sent; nothing about the user.
 */
export function localPlaceNames(geonameId: string, languages: string[]): Promise<string[]> {
  if (!/^\d{1,10}$/.test(geonameId)) return Promise.resolve([])
  const langs = [...new Set(languages.map((lang) => lang.split('-')[0]!.toLowerCase()).filter((lang) => /^[a-z]{2,3}$/.test(lang)))].slice(0, 6)
  if (!langs.length) return Promise.resolve([])
  const key = `${geonameId}:${langs.sort().join(',')}`
  let names = cache.get(key)
  if (!names) {
    names = lookup(geonameId, langs).catch(() => {
      cache.delete(key)
      return []
    })
    cache.set(key, names)
  }
  return names
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Wikidata ${response.status}`)
  return response.json()
}

async function lookup(geonameId: string, langs: string[]): Promise<string[]> {
  const search = new URL('https://www.wikidata.org/w/api.php')
  search.search = new URLSearchParams({ action: 'query', list: 'search', srsearch: `haswbstatement:P1566=${geonameId}`, srlimit: '1', format: 'json' }).toString()
  const found = await getJson(search.toString()) as { query?: { search?: Array<{ title?: string }> } }
  const qid = found.query?.search?.[0]?.title
  if (!qid || !/^Q\d+$/.test(qid)) return []
  const entities = new URL('https://www.wikidata.org/w/api.php')
  entities.search = new URLSearchParams({ action: 'wbgetentities', ids: qid, props: 'labels|aliases', languages: langs.join('|'), format: 'json' }).toString()
  const payload = await getJson(entities.toString()) as { entities?: Record<string, Entity> }
  return namesOf(payload.entities?.[qid], langs)
}

/** The labels first, then short aliases (long official names never appear in headlines). */
export function namesOf(entity: Entity | undefined, langs: string[]): string[] {
  if (!entity) return []
  const labels = langs.map((lang) => entity.labels?.[lang]?.value)
  const aliases = langs.flatMap((lang) => (entity.aliases?.[lang] ?? []).map((alias) => alias.value))
  const names = [...labels, ...aliases]
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    // A headline names a city in a word or two, not "Comune di Roma Capitale" or a postcode.
    .filter((name) => name.length >= 3 && name.length <= 40 && name.split(/\s+/).length <= 3 && /\p{L}/u.test(name))
  return [...new Set(names)].slice(0, MAX_NAMES)
}
