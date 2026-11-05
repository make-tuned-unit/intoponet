import { execFile } from 'node:child_process'

/**
 * Finder's "Where from" for a saved PDF: the com.apple.metadata:kMDItemWhereFroms attribute,
 * a binary property list holding an array of strings. Never written for private tabs.
 */
export const WHERE_FROMS_ATTRIBUTE = 'com.apple.metadata:kMDItemWhereFroms'

/** A minimal bplist00 writer for an array of strings (all this attribute needs). */
export function whereFromsPlist(urls: string[]): Buffer {
  const strings = urls.slice(0, 14).map(encodeString)
  const objects = [Buffer.from([0xa0 | strings.length, ...strings.map((_, index) => index + 1)]), ...strings]
  const offsets: number[] = []
  let position = 8
  for (const object of objects) {
    offsets.push(position)
    position += object.length
  }
  const offsetSize = position < 0x100 ? 1 : position < 0x10000 ? 2 : 4
  const table = Buffer.alloc(offsets.length * offsetSize)
  offsets.forEach((offset, index) => table.writeUIntBE(offset, index * offsetSize, offsetSize))
  const trailer = Buffer.alloc(32)
  trailer.writeUInt8(offsetSize, 6)
  trailer.writeUInt8(1, 7) // object references are one byte (at most 15 objects)
  trailer.writeBigUInt64BE(BigInt(objects.length), 8)
  trailer.writeBigUInt64BE(0n, 16) // the top object is the array
  trailer.writeBigUInt64BE(BigInt(position), 24)
  return Buffer.concat([Buffer.from('bplist00', 'ascii'), ...objects, table, trailer])
}

function encodeString(value: string): Buffer {
  const text = value.slice(0, 4000)
  const ascii = /^[\x00-\x7f]*$/.test(text)
  const body = ascii ? Buffer.from(text, 'ascii') : utf16be(text)
  const count = ascii ? body.length : body.length / 2
  return Buffer.concat([lengthMarker(ascii ? 0x50 : 0x60, count), body])
}

function utf16be(text: string): Buffer {
  const out = Buffer.alloc(text.length * 2)
  for (let index = 0; index < text.length; index += 1) out.writeUInt16BE(text.charCodeAt(index), index * 2)
  return out
}

function lengthMarker(kind: number, count: number): Buffer {
  if (count < 15) return Buffer.from([kind | count])
  if (count < 0x100) return Buffer.from([kind | 0xf, 0x10, count])
  return Buffer.from([kind | 0xf, 0x11, count >> 8, count & 0xff])
}

/** Best effort: a missing attribute only means Finder shows no origin. */
export function writeWhereFroms(path: string, urls: string[]): Promise<void> {
  if (process.platform !== 'darwin' || !path.startsWith('/') || urls.length === 0) return Promise.resolve()
  const hex = whereFromsPlist(urls).toString('hex')
  return new Promise((resolve) => {
    execFile('/usr/bin/xattr', ['-wx', WHERE_FROMS_ATTRIBUTE, hex, path], { timeout: 5_000 }, () => resolve())
  })
}
