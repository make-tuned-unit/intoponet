#!/usr/bin/env node
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const compiled = await build({
  entryPoints: [resolve(here, 'run.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
})
const source = compiled.outputFiles[0]?.text
if (!source) throw new Error('Could not bundle the isolated public feed pilot.')
process.env.INTOPONET_PUBLIC_FEED_PILOT_ENTRY = '1'
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
