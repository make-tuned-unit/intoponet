#!/usr/bin/env node
import { resolve } from 'node:path'
import { buildSqlitePlaceIndex } from '../src/runtime-index.ts'

function options(argv) {
  const result = {}
  if (argv.includes('--help')) {
    process.stdout.write('Usage: node --experimental-strip-types packages/place-catalog/scripts/index-geonames.mjs --catalog-dir IMPORT_DIRECTORY --out NEW_VERSIONED_SQLITE_PATH\n')
    process.exit(0)
  }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    if (!key?.startsWith('--') || !argv[i + 1]) throw new Error(`Expected --option value; got ${key ?? ''}`)
    result[key.slice(2)] = argv[i + 1]
  }
  if (!result['catalog-dir'] || !result.out) throw new Error('Both --catalog-dir and --out are required.')
  return result
}

try {
  const args = options(process.argv.slice(2))
  let lastReport = 0
  const started = Date.now()
  const metadata = await buildSqlitePlaceIndex({
    catalogDirectory: resolve(args['catalog-dir']),
    outputPath: resolve(args.out),
    onProgress({ indexedRows, bytesRead }) {
      if (indexedRows - lastReport < 500_000) return
      lastReport = indexedRows
      process.stderr.write(`Indexed ${indexedRows.toLocaleString()} rows (${(bytesRead / 1e9).toFixed(2)} GB input) in ${((Date.now() - started) / 1000).toFixed(0)}s\n`)
    },
  })
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'GeoNames indexing failed.'}\n`)
  process.exitCode = 1
}
