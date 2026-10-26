/**
 * BERT uncased WordPiece tokenizer (equivalent to Hugging Face BertTokenizer
 * with do_lower_case, strip accents, tokenize_chinese_chars). Pure JS, no I/O.
 */

export const SPECIAL = { pad: '[PAD]', unk: '[UNK]', cls: '[CLS]', sep: '[SEP]' } as const

function isControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false
  return /\p{Cc}|\p{Cf}/u.test(String.fromCodePoint(code))
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || /\p{Zs}/u.test(char)
}

function isPunctuation(char: string): boolean {
  const code = char.codePointAt(0)!
  if ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)) return true
  return /\p{P}/u.test(char)
}

function isCjk(code: number): boolean {
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) || (code >= 0x2b740 && code <= 0x2b81f) || (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff) || (code >= 0x2f800 && code <= 0x2fa1f)
}

/** Basic tokenization: clean, split CJK, lowercase + strip accents, split punctuation. */
export function basicTokenize(text: string): string[] {
  let cleaned = ''
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code === 0 || code === 0xfffd || isControl(code)) continue
    if (isWhitespace(char)) cleaned += ' '
    else if (isCjk(code)) cleaned += ` ${char} `
    else cleaned += char
  }
  const out: string[] = []
  for (const raw of cleaned.trim().split(/\s+/)) {
    if (!raw) continue
    const word = raw.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '')
    let current = ''
    for (const char of word) {
      if (isPunctuation(char)) {
        if (current) out.push(current)
        out.push(char)
        current = ''
      } else {
        current += char
      }
    }
    if (current) out.push(current)
  }
  return out
}

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>
  readonly ids: { pad: number; unk: number; cls: number; sep: number }

  constructor(vocabText: string) {
    this.vocab = new Map()
    vocabText.split(/\r?\n/).forEach((token, index) => {
      if (token && !this.vocab.has(token)) this.vocab.set(token, index)
    })
    const get = (token: string): number => {
      const id = this.vocab.get(token)
      if (id === undefined) throw new Error(`Vocabulary is missing ${token}.`)
      return id
    }
    this.ids = { pad: get(SPECIAL.pad), unk: get(SPECIAL.unk), cls: get(SPECIAL.cls), sep: get(SPECIAL.sep) }
  }

  /** Word pieces for one text, without special tokens. */
  pieces(text: string): number[] {
    const out: number[] = []
    for (const word of basicTokenize(text)) {
      const chars = [...word]
      if (chars.length > 100) { out.push(this.ids.unk); continue }
      const pieces: number[] = []
      let start = 0
      let bad = false
      while (start < chars.length) {
        let end = chars.length
        let found: number | undefined
        while (start < end) {
          const sub = (start > 0 ? '##' : '') + chars.slice(start, end).join('')
          found = this.vocab.get(sub)
          if (found !== undefined) break
          end -= 1
        }
        if (found === undefined) { bad = true; break }
        pieces.push(found)
        start = end
      }
      if (bad) out.push(this.ids.unk)
      else out.push(...pieces)
    }
    return out
  }

  /** [CLS] pieces [SEP], truncated to maxLength. */
  encode(text: string, maxLength = 256): number[] {
    const pieces = this.pieces(text).slice(0, Math.max(0, maxLength - 2))
    return [this.ids.cls, ...pieces, this.ids.sep]
  }

  countTokens(text: string): number {
    return this.pieces(text).length
  }
}
