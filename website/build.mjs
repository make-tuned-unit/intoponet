// Builds the static site into dist/: copies the site, inlines the Permagent analytics
// snippet (permagent.js, verbatim) into every page just before </head>, and writes each
// page's Content-Security-Policy as a <meta> tag whose script hash is computed from that
// page's built HTML. The hash is derived on every build, so editing the snippet can never
// leave a stale hash behind (which would block it silently).
//   node build.mjs [outDir]
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = import.meta.dirname
const out = resolve(root, process.argv[2] ?? 'dist')
const SKIP = new Set(['api', 'dist', 'node_modules', '.vercel', 'build.mjs', 'build.test.mjs', 'package.json', 'package-lock.json', 'vercel.json', 'README.md', '.env.example'])
const SNIPPET_TAG = '<script src="/permagent.js"></script>'

/** The page policy; frame-ancestors stays in the response header (it is ignored in <meta>). */
export const pagePolicy = (scriptHashes) => [
  "default-src 'self'",
  `script-src 'self' ${scriptHashes.map((hash) => `'sha256-${hash}'`).join(' ')}`.trim(),
  "img-src 'self'",
  "style-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

/** Inline the snippet once, then hash every inline script in the built page and declare those hashes. */
export function buildPage(html, snippet) {
  if (html.includes('window.permagent.v')) throw new Error('A page already carries an inline Permagent snippet; keep only the /permagent.js tag in the source.')
  const count = html.split(SNIPPET_TAG).length - 1
  if (count !== 1) throw new Error(`Expected one ${SNIPPET_TAG} in the page, found ${count}.`)
  let built = html.replace(SNIPPET_TAG, () => `<script>\n${snippet}</script>`)
  const hashes = [...built.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => createHash('sha256').update(match[1], 'utf8').digest('base64'))
  // The policy must come before any script in <head>.
  built = built.replace(/<head>/i, () => `<head>\n<meta http-equiv="Content-Security-Policy" content="${pagePolicy([...new Set(hashes)])}">`)
  return built
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(root, 'build.mjs')) {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const name of readdirSync(root)) {
    if (SKIP.has(name) || name.endsWith('.test.mjs')) continue
    cpSync(join(root, name), join(out, name), { recursive: true })
  }
  const snippet = readFileSync(join(root, 'permagent.js'), 'utf8')
  const pages = readdirSync(out).filter((name) => name.endsWith('.html'))
  for (const page of pages) writeFileSync(join(out, page), buildPage(readFileSync(join(out, page), 'utf8'), snippet))
  console.log(`Built ${pages.length} pages into ${out}`)
}
