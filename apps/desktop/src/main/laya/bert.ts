/**
 * Pure-JS MiniLM-L6 (BERT) sentence encoder: safetensors weights, mean pooling,
 * L2 normalisation — the all-MiniLM-L6-v2 recipe. No native code, no network.
 */

export const BERT_CONFIG = {
  hidden: 384,
  layers: 6,
  heads: 12,
  intermediate: 1536,
  maxPositions: 512,
  layerNormEps: 1e-12,
} as const

export type Weights = (name: string) => Float32Array

/** Parse a safetensors file (F32 tensors only) into named Float32Array views. */
export function parseSafetensors(bytes: Uint8Array): Map<string, Float32Array> {
  if (bytes.byteLength < 8) throw new Error('Model file is truncated.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLength = Number(view.getBigUint64(0, true))
  if (headerLength <= 0 || headerLength > 10_000_000 || 8 + headerLength > bytes.byteLength) throw new Error('Model header is invalid.')
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as Record<string, { dtype?: string; shape?: number[]; data_offsets?: [number, number] }>
  const dataStart = 8 + headerLength
  const tensors = new Map<string, Float32Array>()
  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__' || info.dtype !== 'F32' || !info.data_offsets) continue
    const [begin, end] = info.data_offsets
    const length = (end - begin) / 4
    const offset = bytes.byteOffset + dataStart + begin
    if (end > bytes.byteLength - dataStart || !Number.isInteger(length)) throw new Error(`Tensor ${name} is out of range.`)
    // Zero-copy when aligned (it is, for files saved by safetensors); copy otherwise.
    tensors.set(name, offset % 4 === 0
      ? new Float32Array(bytes.buffer, offset, length)
      : new Float32Array(bytes.slice(dataStart + begin, dataStart + end).buffer))
  }
  return tensors
}

export function weightsFrom(tensors: Map<string, Float32Array>): Weights {
  return (name: string) => {
    const tensor = tensors.get(name)
    if (!tensor) throw new Error(`Model is missing ${name}.`)
    return tensor
  }
}

/** out[M,N] = x[M,K] · W[N,K]ᵀ + b[N]  (PyTorch Linear layout). */
export function linear(x: Float32Array, M: number, K: number, W: Float32Array, b: Float32Array, N: number, out: Float32Array): Float32Array {
  for (let m = 0; m < M; m += 1) {
    const xo = m * K
    const oo = m * N
    for (let n = 0; n < N; n += 1) {
      const wo = n * K
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0
      let k = 0
      for (; k + 3 < K; k += 4) {
        s0 += x[xo + k]! * W[wo + k]!
        s1 += x[xo + k + 1]! * W[wo + k + 1]!
        s2 += x[xo + k + 2]! * W[wo + k + 2]!
        s3 += x[xo + k + 3]! * W[wo + k + 3]!
      }
      for (; k < K; k += 1) s0 += x[xo + k]! * W[wo + k]!
      out[oo + n] = s0 + s1 + s2 + s3 + b[n]!
    }
  }
  return out
}

/** In-place LayerNorm over rows of width D. */
export function layerNorm(x: Float32Array, rows: number, D: number, gamma: Float32Array, beta: Float32Array, eps: number): void {
  for (let r = 0; r < rows; r += 1) {
    const o = r * D
    let mean = 0
    for (let i = 0; i < D; i += 1) mean += x[o + i]!
    mean /= D
    let variance = 0
    for (let i = 0; i < D; i += 1) {
      const d = x[o + i]! - mean
      variance += d * d
    }
    const inv = 1 / Math.sqrt(variance / D + eps)
    for (let i = 0; i < D; i += 1) x[o + i] = (x[o + i]! - mean) * inv * gamma[i]! + beta[i]!
  }
}

/** erf via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return sign * y
}

function gelu(x: Float32Array): void {
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i]!
    x[i] = 0.5 * v * (1 + erf(v * Math.SQRT1_2))
  }
}

export class MiniLmEncoder {
  private readonly w: Weights

  constructor(weights: Weights) {
    this.w = weights
  }

  /** Sentence embedding for one encoded sequence ([CLS] … [SEP]); unit length. */
  embed(ids: number[]): Float32Array {
    const { hidden: D, layers, heads, intermediate: I, layerNormEps: eps } = BERT_CONFIG
    const L = Math.min(ids.length, BERT_CONFIG.maxPositions)
    const H = D / heads
    const w = this.w
    const word = w('embeddings.word_embeddings.weight')
    const pos = w('embeddings.position_embeddings.weight')
    const type = w('embeddings.token_type_embeddings.weight')
    const h = new Float32Array(L * D)
    for (let t = 0; t < L; t += 1) {
      const id = ids[t]!
      for (let i = 0; i < D; i += 1) h[t * D + i] = word[id * D + i]! + pos[t * D + i]! + type[i]!
    }
    layerNorm(h, L, D, w('embeddings.LayerNorm.weight'), w('embeddings.LayerNorm.bias'), eps)

    const q = new Float32Array(L * D)
    const k = new Float32Array(L * D)
    const v = new Float32Array(L * D)
    const ctx = new Float32Array(L * D)
    const attn = new Float32Array(L * D)
    const inter = new Float32Array(L * I)
    const ffn = new Float32Array(L * D)
    const scores = new Float32Array(L)
    const scale = 1 / Math.sqrt(H)
    for (let layer = 0; layer < layers; layer += 1) {
      const p = `encoder.layer.${layer}.`
      linear(h, L, D, w(`${p}attention.self.query.weight`), w(`${p}attention.self.query.bias`), D, q)
      linear(h, L, D, w(`${p}attention.self.key.weight`), w(`${p}attention.self.key.bias`), D, k)
      linear(h, L, D, w(`${p}attention.self.value.weight`), w(`${p}attention.self.value.bias`), D, v)
      for (let head = 0; head < heads; head += 1) {
        const ho = head * H
        for (let i = 0; i < L; i += 1) {
          let max = -Infinity
          for (let j = 0; j < L; j += 1) {
            let s = 0
            for (let d = 0; d < H; d += 1) s += q[i * D + ho + d]! * k[j * D + ho + d]!
            s *= scale
            scores[j] = s
            if (s > max) max = s
          }
          let sum = 0
          for (let j = 0; j < L; j += 1) {
            const e = Math.exp(scores[j]! - max)
            scores[j] = e
            sum += e
          }
          for (let d = 0; d < H; d += 1) {
            let acc = 0
            for (let j = 0; j < L; j += 1) acc += scores[j]! * v[j * D + ho + d]!
            ctx[i * D + ho + d] = acc / sum
          }
        }
      }
      linear(ctx, L, D, w(`${p}attention.output.dense.weight`), w(`${p}attention.output.dense.bias`), D, attn)
      for (let i = 0; i < L * D; i += 1) attn[i] = attn[i]! + h[i]!
      layerNorm(attn, L, D, w(`${p}attention.output.LayerNorm.weight`), w(`${p}attention.output.LayerNorm.bias`), eps)
      linear(attn, L, D, w(`${p}intermediate.dense.weight`), w(`${p}intermediate.dense.bias`), I, inter)
      gelu(inter)
      linear(inter, L, I, w(`${p}output.dense.weight`), w(`${p}output.dense.bias`), D, ffn)
      for (let i = 0; i < L * D; i += 1) h[i] = ffn[i]! + attn[i]!
      layerNorm(h, L, D, w(`${p}output.LayerNorm.weight`), w(`${p}output.LayerNorm.bias`), eps)
    }
    // Mean pooling over all tokens (attention mask is all ones for one sequence), then L2.
    const out = new Float32Array(D)
    for (let t = 0; t < L; t += 1) for (let i = 0; i < D; i += 1) out[i] = out[i]! + h[t * D + i]!
    let norm = 0
    for (let i = 0; i < D; i += 1) {
      out[i] = out[i]! / L
      norm += out[i]! * out[i]!
    }
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < D; i += 1) out[i] = out[i]! / norm
    return out
  }
}
