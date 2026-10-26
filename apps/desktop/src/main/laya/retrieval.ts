/**
 * Laya's pure retrieval logic: chunking with paragraph citations, cosine
 * similarity, reciprocal-rank fusion, deterministic k-means themes and
 * extractive passage trimming. No I/O, no model.
 */

export type Chunk = {
  /** Inclusive paragraph range this chunk covers (citation). */
  paragraphStart: number
  paragraphEnd: number
  text: string
}

/** Split very long text at sentence ends, then words, so no piece exceeds maxTokens. */
function splitLong(text: string, countTokens: (text: string) => number, maxTokens: number): string[] {
  if (countTokens(text) <= maxTokens) return [text]
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+["'”’)]*\s*|[^.!?。！？]+$/g) ?? [text]
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const candidate = current ? `${current}${sentence}` : sentence
    if (countTokens(candidate) <= maxTokens) {
      current = candidate
      continue
    }
    if (current) out.push(current.trim())
    if (countTokens(sentence) <= maxTokens) {
      current = sentence
      continue
    }
    // A single enormous sentence: cut by words.
    let words: string[] = []
    for (const word of sentence.split(/\s+/)) {
      words.push(word)
      if (countTokens(words.join(' ')) > maxTokens) {
        words.pop()
        if (words.length) out.push(words.join(' '))
        words = [word]
      }
    }
    current = words.join(' ')
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/**
 * Merge short paragraphs and split long ones into chunks of at most maxTokens,
 * each remembering which paragraphs it came from.
 */
export function chunkParagraphs(paragraphs: string[], countTokens: (text: string) => number, maxTokens = 220, maxChunks = 160): Chunk[] {
  const chunks: Chunk[] = []
  let buffer: Chunk | null = null
  let bufferTokens = 0
  const flush = (): void => {
    if (buffer && buffer.text.trim()) chunks.push(buffer)
    buffer = null
    bufferTokens = 0
  }
  paragraphs.forEach((paragraph, index) => {
    const text = paragraph.trim()
    if (!text) return
    const tokens = countTokens(text)
    if (tokens > maxTokens) {
      flush()
      for (const piece of splitLong(text, countTokens, maxTokens)) chunks.push({ paragraphStart: index, paragraphEnd: index, text: piece })
      return
    }
    if (buffer && bufferTokens + tokens > maxTokens) flush()
    if (!buffer) {
      buffer = { paragraphStart: index, paragraphEnd: index, text }
      bufferTokens = tokens
    } else {
      buffer = { paragraphStart: buffer.paragraphStart, paragraphEnd: index, text: `${buffer.text}\n${text}` }
      bufferTokens += tokens
    }
  })
  flush()
  return chunks.slice(0, maxChunks)
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!
  return sum
}

export function normalise(vector: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < vector.length; i += 1) norm += vector[i]! * vector[i]!
  norm = Math.sqrt(norm) || 1
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i]! / norm
  return out
}

export function meanVector(vectors: Float32Array[]): Float32Array {
  const dims = vectors[0]?.length ?? 0
  const out = new Float32Array(dims)
  for (const vector of vectors) for (let i = 0; i < dims; i += 1) out[i] = out[i]! + vector[i]!
  return normalise(out)
}

/**
 * Reciprocal-rank fusion of two ranked lists of keys (k = 60). Returns keys
 * with fused scores and which lists contributed.
 */
export function fuseRanks(words: string[], meaning: string[], k = 60): Array<{ key: string; score: number; matchedBy: 'words' | 'meaning' | 'both' }> {
  const scores = new Map<string, { score: number; words: boolean; meaning: boolean }>()
  const add = (list: string[], kind: 'words' | 'meaning'): void => {
    list.forEach((key, rank) => {
      const entry = scores.get(key) ?? { score: 0, words: false, meaning: false }
      entry.score += 1 / (k + rank + 1)
      entry[kind] = true
      scores.set(key, entry)
    })
  }
  add(words, 'words')
  add(meaning, 'meaning')
  return [...scores.entries()]
    .map(([key, entry]) => ({ key, score: entry.score, matchedBy: entry.words && entry.meaning ? 'both' as const : entry.words ? 'words' as const : 'meaning' as const }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
}

/** Small deterministic PRNG (mulberry32) so themes are stable across runs. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cosine k-means with k-means++ seeding from a fixed seed. Returns a cluster index per vector. */
export function kmeans(vectors: Float32Array[], k: number, seed = 7, iterations = 25): number[] {
  const n = vectors.length
  if (n === 0) return []
  const clusters = Math.max(1, Math.min(k, n))
  const rand = random(seed)
  const centroids: Float32Array[] = [vectors[Math.floor(rand() * n)]!]
  while (centroids.length < clusters) {
    const distances = vectors.map((vector) => Math.min(...centroids.map((centroid) => 1 - dot(vector, centroid))) ** 2)
    const total = distances.reduce((sum, value) => sum + value, 0)
    let pick = rand() * total
    let index = 0
    for (; index < n - 1; index += 1) {
      pick -= distances[index]!
      if (pick <= 0) break
    }
    centroids.push(vectors[index]!)
  }
  let assignment = new Array<number>(n).fill(0)
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = vectors.map((vector) => {
      let best = 0
      let bestScore = -Infinity
      centroids.forEach((centroid, c) => {
        const score = dot(vector, centroid)
        if (score > bestScore) { bestScore = score; best = c }
      })
      return best
    })
    const changed = next.some((value, index) => value !== assignment[index])
    assignment = next
    for (let c = 0; c < clusters; c += 1) {
      const members = vectors.filter((_, index) => assignment[index] === c)
      if (members.length) centroids[c] = meanVector(members)
    }
    if (!changed && iteration > 0) break
  }
  return assignment
}

export function themeCount(documents: number): number {
  return Math.max(1, Math.round(Math.sqrt(documents / 2)))
}

/**
 * Label a theme by terms that are frequent in its members and rarer in the
 * rest of the library (a simple distinctiveness ratio).
 */
export function distinctiveTerms(members: string[][], others: string[][], count = 3): string[] {
  const tally = (lists: string[][]): Map<string, number> => {
    const map = new Map<string, number>()
    for (const list of lists) for (const term of new Set(list.map((item) => item.toLowerCase()))) map.set(term, (map.get(term) ?? 0) + 1)
    return map
  }
  const inside = tally(members)
  const outside = tally(others)
  const display = new Map<string, string>()
  for (const list of members) for (const term of list) if (!display.has(term.toLowerCase())) display.set(term.toLowerCase(), term)
  return [...inside.entries()]
    .map(([term, n]) => ({ term, score: (n / members.length) / ((outside.get(term) ?? 0) / Math.max(1, others.length) + 0.1) * Math.log1p(n) }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, count)
    .map(({ term }) => display.get(term) ?? term)
}

/**
 * Trim a chunk to whole sentences around the part that best matches the
 * question's words, at most maxChars. Text is copied verbatim, never rewritten.
 */
export function trimPassage(text: string, question: string, maxChars = 400): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return clean
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+["'”’)]*\s*|[^.!?。！？]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [clean]
  const words = new Set(question.toLowerCase().match(/\p{L}{3,}/gu) ?? [])
  const score = (sentence: string): number => (sentence.toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter((word) => words.has(word)).length
  let best = 0
  sentences.forEach((sentence, index) => { if (score(sentence) > score(sentences[best]!)) best = index })
  let start = best
  let end = best
  let length = sentences[best]!.length
  // Grow around the best sentence while it fits.
  for (;;) {
    const before = start > 0 ? sentences[start - 1]!.length + 1 : Infinity
    const after = end < sentences.length - 1 ? sentences[end + 1]!.length + 1 : Infinity
    if (Math.min(before, after) === Infinity || length + Math.min(before, after) > maxChars) break
    if (after <= before) { end += 1; length += after } else { start -= 1; length += before }
  }
  const passage = sentences.slice(start, end + 1).join(' ')
  if (passage.length <= maxChars) return `${start > 0 ? '… ' : ''}${passage}${end < sentences.length - 1 ? ' …' : ''}`
  return `${passage.slice(0, maxChars - 1).replace(/\s+\S*$/, '')}…`
}
