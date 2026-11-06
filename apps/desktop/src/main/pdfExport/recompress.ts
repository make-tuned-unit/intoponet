import { PDFArray, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFDocument, type PDFObject } from '@cantoo/pdf-lib'
import { unzlibSync } from 'fflate'
import jpeg from 'jpeg-js'

/** Widest image kept: about 250 dpi across a printed column. */
const MAX_WIDTH = 1600
/** Images smaller than this (compressed) are not worth touching. */
const MIN_BYTES = 60_000
const QUALITY = 80

/** Halve repeatedly, then a box filter down to the target width (good enough for print). */
export function shrinkRgba(data: Uint8Array, width: number, height: number, maxWidth = MAX_WIDTH): { data: Uint8Array; width: number; height: number } {
  if (width <= maxWidth) return { data, width, height }
  const scale = maxWidth / width
  const outW = maxWidth
  const outH = Math.max(1, Math.round(height * scale))
  const out = new Uint8Array(outW * outH * 4)
  for (let y = 0; y < outH; y += 1) {
    const y0 = Math.floor(y / scale)
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) / scale)))
    for (let x = 0; x < outW; x += 1) {
      const x0 = Math.floor(x / scale)
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) / scale)))
      let r = 0, g = 0, b = 0, n = 0
      for (let sy = y0; sy < y1; sy += 1) {
        let index = (sy * width + x0) * 4
        for (let sx = x0; sx < x1; sx += 1, index += 4) {
          r += data[index]!; g += data[index + 1]!; b += data[index + 2]!; n += 1
        }
      }
      const at = (y * outW + x) * 4
      out[at] = r / n; out[at + 1] = g / n; out[at + 2] = b / n; out[at + 3] = 255
    }
  }
  return { data: out, width: outW, height: outH }
}

function componentsOf(doc: PDFDocument, space: PDFObject | undefined): number | null {
  const value = space instanceof PDFRef ? doc.context.lookup(space) : space
  if (value === PDFName.of('DeviceRGB')) return 3
  if (value === PDFName.of('DeviceGray')) return 1
  if (value instanceof PDFArray && value.get(0) === PDFName.of('ICCBased')) {
    const profile = doc.context.lookup(value.get(1))
    const n = profile instanceof PDFRawStream ? profile.dict.get(PDFName.of('N')) : undefined
    return n instanceof PDFNumber ? n.asNumber() : null
  }
  return null
}

/** Pixels this opaque or more count as solid (a fade-in caught at 99% leaves masks of 253-254). */
const SOLID = 250

/**
 * True when an image's soft mask hides nothing: photos decoded from WebP or PNG often carry an
 * alpha channel that is solid everywhere, and the mask can then be dropped.
 */
function opaqueMask(doc: PDFDocument, ref: PDFObject | undefined): boolean {
  const mask = ref instanceof PDFRef ? doc.context.lookup(ref) : ref
  if (!(mask instanceof PDFRawStream)) return false
  const dict = mask.dict
  if (dict.get(PDFName.of('Filter')) !== PDFName.of('FlateDecode') || dict.has(PDFName.of('DecodeParms')) || dict.has(PDFName.of('Decode'))) return false
  const bits = dict.get(PDFName.of('BitsPerComponent'))
  if (!(bits instanceof PDFNumber) || bits.asNumber() !== 8) return false
  let alpha: Uint8Array
  try {
    alpha = unzlibSync(mask.contents)
  } catch {
    return false
  }
  if (alpha.byteLength === 0) return false
  for (let index = 0; index < alpha.byteLength; index += 1) if (alpha[index]! < SOLID) return false
  return true
}

/**
 * Chromium stores every image that was not already a JPEG (WebP, AVIF, PNG photos) as raw pixels,
 * so a page of photos makes a PDF of tens of megabytes. Large opaque 8-bit RGB or grey images are
 * re-encoded as JPEG here (and scaled to print size), dropping alpha that is solid everywhere;
 * images with any transparency or anything unusual are left exactly as they are. Returns how many were changed.
 */
export function recompressImages(doc: PDFDocument): number {
  let changed = 0
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue
    const dict = object.dict
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue
    if (dict.get(PDFName.of('Filter')) !== PDFName.of('FlateDecode')) continue
    if (dict.has(PDFName.of('Mask')) || dict.has(PDFName.of('DecodeParms')) || dict.has(PDFName.of('Decode'))) continue
    if (dict.has(PDFName.of('SMask')) && !opaqueMask(doc, dict.get(PDFName.of('SMask')))) continue
    if (object.contents.byteLength < MIN_BYTES) continue
    const bits = dict.get(PDFName.of('BitsPerComponent'))
    const widthValue = dict.get(PDFName.of('Width'))
    const heightValue = dict.get(PDFName.of('Height'))
    if (!(bits instanceof PDFNumber) || bits.asNumber() !== 8 || !(widthValue instanceof PDFNumber) || !(heightValue instanceof PDFNumber)) continue
    const components = componentsOf(doc, dict.get(PDFName.of('ColorSpace')))
    if (components !== 3 && components !== 1) continue
    const width = widthValue.asNumber()
    const height = heightValue.asNumber()
    let raw: Uint8Array
    try {
      raw = unzlibSync(object.contents)
    } catch {
      continue
    }
    if (raw.byteLength !== width * height * components) continue
    const rgba = new Uint8Array(width * height * 4)
    for (let pixel = 0, from = 0, to = 0; pixel < width * height; pixel += 1, from += components, to += 4) {
      rgba[to] = raw[from]!
      rgba[to + 1] = raw[components === 3 ? from + 1 : from]!
      rgba[to + 2] = raw[components === 3 ? from + 2 : from]!
      rgba[to + 3] = 255
    }
    const fitted = shrinkRgba(rgba, width, height)
    const encoded = jpeg.encode({ data: fitted.data, width: fitted.width, height: fitted.height }, QUALITY).data
    if (encoded.byteLength > object.contents.byteLength * 0.8) continue
    const next = doc.context.obj({
      Type: 'XObject',
      Subtype: 'Image',
      Width: fitted.width,
      Height: fitted.height,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'DCTDecode',
      Length: encoded.byteLength,
    })
    doc.context.assign(ref, PDFRawStream.of(next, new Uint8Array(encoded)))
    changed += 1
  }
  return changed
}
