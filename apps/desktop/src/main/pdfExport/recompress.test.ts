import { PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib'
import { zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { recompressImages, shrinkRgba } from './recompress'

function rawImage(doc: PDFDocument, width: number, height: number, extra: Record<string, unknown> = {}) {
  let seed = 7
  // A photo-like gradient with a little grain (pure noise would not shrink as JPEG either).
  const pixels = new Uint8Array(width * height * 3).map((_, i) => ((i / 3) % width) / width * 200 + ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 15))
  const data = zlibSync(pixels)
  const dict = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode', Length: data.byteLength, ...extra })
  return doc.context.register(PDFRawStream.of(dict, data))
}

describe('PDF image recompression', () => {
  it('turns big raw photos into JPEG at print size', async () => {
    const doc = await PDFDocument.create()
    const ref = rawImage(doc, 2000, 200)
    expect(recompressImages(doc)).toBe(1)
    const image = doc.context.lookup(ref) as PDFRawStream
    expect(image.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'))
    expect(image.dict.get(PDFName.of('Width'))?.toString()).toBe('1600')
    expect(image.dict.get(PDFName.of('Height'))?.toString()).toBe('160')
  })
  it('leaves transparent and small images alone', async () => {
    const doc = await PDFDocument.create()
    const mask = rawImage(doc, 10, 10)
    rawImage(doc, 800, 300, { SMask: mask })
    rawImage(doc, 20, 20)
    expect(recompressImages(doc)).toBe(0)
  })
  it('drops an alpha mask that is solid everywhere, and keeps one that hides anything', async () => {
    const grey = (doc: PDFDocument, values: Uint8Array) => {
      const data = zlibSync(values)
      return doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 800, Height: 300, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode', Length: data.byteLength }), data))
    }
    const doc = await PDFDocument.create()
    const solid = rawImage(doc, 800, 300, { SMask: grey(doc, new Uint8Array(800 * 300).fill(254)) })
    const cutout = new Uint8Array(800 * 300).fill(255)
    cutout.fill(0, 0, 800)
    const shaped = rawImage(doc, 800, 300, { SMask: grey(doc, cutout) })
    expect(recompressImages(doc)).toBe(1)
    const photo = doc.context.lookup(solid) as PDFRawStream
    expect(photo.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'))
    expect(photo.dict.has(PDFName.of('SMask'))).toBe(false)
    const kept = doc.context.lookup(shaped) as PDFRawStream
    expect(kept.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'))
    expect(kept.dict.has(PDFName.of('SMask'))).toBe(true)
  })
  it('scales by averaging', () => {
    const data = new Uint8Array(4 * 4 * 4).fill(200)
    const out = shrinkRgba(data, 4, 4, 2)
    expect([out.width, out.height]).toEqual([2, 2])
    expect(out.data[0]).toBe(200)
    expect(shrinkRgba(data, 4, 4, 10).width).toBe(4)
  })
})
