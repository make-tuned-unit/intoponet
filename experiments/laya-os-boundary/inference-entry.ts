import { MiniLmEncoder, parseSafetensors, weightsFrom } from '../../apps/desktop/src/main/laya/bert'
import { WordPieceTokenizer } from '../../apps/desktop/src/main/laya/tokenizer'

type ProbeGlobal = typeof globalThis & {
  TextDecoder?: new () => { decode(input: Uint8Array): string }
  layaRunInference?: (modelBytes: Uint8Array, vocabText: string, text: string) => string
}

const host = globalThis as ProbeGlobal

// JavaScriptCore's TextDecoder availability varies by OS release. The
// safetensors parser only decodes its bounded JSON header, so provide this
// small UTF-8 decoder when the runtime does not expose the Web API.
if (!host.TextDecoder) {
  host.TextDecoder = class {
    decode(input: Uint8Array): string {
      let output = ''
      const flush: string[] = []
      const bytes = input
      for (let index = 0; index < bytes.length;) {
        const first = bytes[index++]!
        let point: number
        if (first < 0x80) point = first
        else if ((first & 0xe0) === 0xc0 && index < bytes.length) point = ((first & 0x1f) << 6) | (bytes[index++]! & 0x3f)
        else if ((first & 0xf0) === 0xe0 && index + 1 < bytes.length) point = ((first & 0x0f) << 12) | ((bytes[index++]! & 0x3f) << 6) | (bytes[index++]! & 0x3f)
        else if ((first & 0xf8) === 0xf0 && index + 2 < bytes.length) point = ((first & 0x07) << 18) | ((bytes[index++]! & 0x3f) << 12) | ((bytes[index++]! & 0x3f) << 6) | (bytes[index++]! & 0x3f)
        else point = 0xfffd
        flush.push(String.fromCodePoint(point))
        if (flush.length === 4096) output += flush.splice(0).join('')
      }
      return output + flush.join('')
    }
  }
}

host.layaRunInference = (modelBytes, vocabText, text) => {
  const tokenizer = new WordPieceTokenizer(vocabText)
  const encoder = new MiniLmEncoder(weightsFrom(parseSafetensors(modelBytes)))
  const tokenIds = tokenizer.encode(text, 256)
  const vector = Array.from(encoder.embed(tokenIds))
  return JSON.stringify({ tokenIds, vector })
}
