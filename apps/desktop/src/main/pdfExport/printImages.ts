import { nativeImage } from 'electron'

/** Widest image kept in a PDF: about 250 dpi across the printed column. */
export const MAX_PRINT_WIDTH = 1600
const MAX_SOURCE_BYTES = 30 * 1024 * 1024

/** True when every pixel is opaque (BGRA or RGBA: alpha is every fourth byte). */
export function opaque(bitmap: Uint8Array): boolean {
  for (let index = 3; index < bitmap.length; index += 4) if (bitmap[index] !== 255) return false
  return true
}

/**
 * An image as it should go into a PDF. Chromium stores WebP, AVIF and PNG photos losslessly, so a
 * page of photos can reach tens of megabytes: opaque images become JPEG and big ones are scaled to
 * print size. JPEGs small enough already, SVGs and anything that cannot be decoded pass through.
 */
export function printableImage(bytes: Uint8Array, contentType: string): { bytes: Uint8Array; contentType: string } {
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  if (type === 'image/svg+xml' || bytes.byteLength === 0) return { bytes, contentType }
  const image = nativeImage.createFromBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  if (image.isEmpty()) return { bytes, contentType }
  const { width } = image.getSize()
  if (type === 'image/jpeg' && width <= MAX_PRINT_WIDTH) return { bytes, contentType }
  const fitted = width > MAX_PRINT_WIDTH ? image.resize({ width: MAX_PRINT_WIDTH, quality: 'best' }) : image
  if (type !== 'image/jpeg' && !opaque(fitted.toBitmap())) {
    // Transparent (logos, diagrams): kept as PNG, only scaled.
    return width > MAX_PRINT_WIDTH ? { bytes: fitted.toPNG(), contentType: 'image/png' } : { bytes, contentType }
  }
  const jpeg = fitted.toJPEG(84)
  return jpeg.byteLength < bytes.byteLength || type !== 'image/jpeg' ? { bytes: jpeg, contentType: 'image/jpeg' } : { bytes, contentType }
}

export async function readLimited(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_SOURCE_BYTES) return null
  const buffer = new Uint8Array(await response.arrayBuffer())
  return buffer.byteLength > MAX_SOURCE_BYTES ? null : buffer
}
