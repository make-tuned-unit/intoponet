#!/usr/bin/env node
// Makes the globe's two Earth textures from NASA's original files, so how they were made is on record.
//
//   node scripts/build-earth-textures.mjs            download NASA's originals, check them, resize, write the textures
//   node scripts/build-earth-textures.mjs --from DIR use originals already downloaded into DIR (same file names)
//   node scripts/build-earth-textures.mjs --check    only check that the textures in the repository are the recorded ones
//
// The resize is macOS `sips` (the command is printed and is in each texture's .license file beside it):
//   sips -s format jpeg -s formatOptions 72 -z 2048 4096 <original> --out <texture>
// The result was byte for byte the same on repeated runs with sips-316 (macOS 26.2). A different
// version of sips may write different bytes; then look at the picture, and record the new checksum
// in the .license file and below.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/desktop/src/renderer/assets')

export const textures = [
  {
    file: 'earth-day.jpg',
    original: 'world.topo.bathy.200410.3x21600x10800.jpg',
    url: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/october/world.topo.bathy.200410.3x21600x10800.jpg',
    originalSha256: 'af9bea6c86e684923d72842e629be0a9401d0d4f0cb76411199c8519519114ce',
    sha256: '0a77aaaf07318674a8a38f542924e9ec02486f7ad4981b9082e7e3c8fd091ff4',
  },
  {
    file: 'earth-night.jpg',
    original: 'BlackMarble_2016_3km.jpg',
    url: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
    originalSha256: '230aac448ae68c358be433dd518888cccb3a85ccf66f7b44326441c324ad6725',
    sha256: '875cc331b2819e7c667b616b9ef98e05c94b7e9205f4ab8193db1ba1b63a566e',
  },
]

export const resizeArguments = (original, output) => ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', '-z', '2048', '4096', original, '--out', output]
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

async function main(args) {
  if (args.includes('--check')) {
    for (const texture of textures) {
      const found = sha256(join(assets, texture.file))
      if (found !== texture.sha256) throw new Error(`${texture.file} is not the recorded file: SHA-256 ${found}, recorded ${texture.sha256}`)
      console.log(`${texture.file}: ${found} (as recorded)`)
    }
    return
  }
  if (process.platform !== 'darwin') throw new Error('the recorded resize uses macOS sips')
  const from = args.includes('--from') ? resolve(args[args.indexOf('--from') + 1] ?? '') : null
  const work = mkdtempSync(join(tmpdir(), 'intoponet-earth-textures-'))
  try {
    for (const texture of textures) {
      const original = join(work, texture.original)
      if (from) copyFileSync(join(from, texture.original), original)
      else {
        console.log(`Downloading ${texture.url}`)
        const response = await fetch(texture.url)
        if (!response.ok) throw new Error(`${texture.url} answered ${response.status}`)
        writeFileSync(original, Buffer.from(await response.arrayBuffer()))
      }
      const originalSha = sha256(original)
      if (originalSha !== texture.originalSha256) throw new Error(`${texture.original} is not the file recorded: SHA-256 ${originalSha}, recorded ${texture.originalSha256}`)
      const output = join(work, texture.file)
      console.log(`sips ${resizeArguments(texture.original, texture.file).join(' ')}`)
      execFileSync('sips', resizeArguments(original, output), { stdio: 'ignore' })
      if (!existsSync(output)) throw new Error(`sips wrote no ${texture.file}`)
      const made = sha256(output)
      copyFileSync(output, join(assets, texture.file))
      console.log(`${texture.file}: ${made}${made === texture.sha256 ? ' (as recorded)' : ` (recorded: ${texture.sha256}; this sips writes different bytes, so look at the picture and update the record)`}`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`earth textures: ${error.message}`)
    process.exitCode = 1
  })
}
