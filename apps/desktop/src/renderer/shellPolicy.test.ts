import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CAPTURE_SCHEME } from '@intoponet/browser-api'
import { SHELL_POLICY_META, devShellPolicy, parsePolicy, withDevShellPolicy } from './shellPolicy'

const html = readFileSync(join(__dirname, 'index.html'), 'utf8')
const policy = SHELL_POLICY_META.exec(html)?.[1] ?? ''
const directives = parsePolicy(policy)

describe("the app window's Content-Security-Policy", () => {
  it('is in index.html before anything it governs', () => {
    expect(policy).not.toBe('')
    const at = html.search(SHELL_POLICY_META)
    for (const tag of ['<script', '<link', '<style']) {
      const found = html.indexOf(tag)
      if (found >= 0) expect(at).toBeLessThan(found)
    }
  })

  it('runs only its own scripts, and nothing it could be tricked into framing, posting or rebasing', () => {
    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.get('script-src')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('base-uri')).toEqual(["'none'"])
    expect(directives.get('form-action')).toEqual(["'none'"])
    expect(directives.get('frame-src')).toEqual(["'none'"])
    expect(directives.get('worker-src')).toEqual(["'none'"])
    expect(policy).not.toMatch(/unsafe-(inline|eval|hashes)|wasm-unsafe-eval|strict-dynamic|\*|ws:|localhost|127\.0\.0\.1|http:/)
  })

  it('allows only the inline style framer-motion adds empty, and its own stylesheets', () => {
    const empty = `'sha256-${createHash('sha256').update('').digest('base64')}'`
    expect(directives.get('style-src')).toEqual(["'self'", empty])
  })

  it('loads the images, media, fonts and connections the shell uses, and no others', () => {
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:', `${CAPTURE_SCHEME}:`, 'https://upload.wikimedia.org'])
    expect(directives.get('media-src')).toEqual(['blob:'])
    expect(directives.get('font-src')).toEqual(["'self'"])
    expect(directives.get('connect-src')).toEqual(["'self'", `${CAPTURE_SCHEME}:`, 'https://wvs.earthdata.nasa.gov'])
  })

  it("adds the dev server's needs in development only, keeping everything else", () => {
    const dev = parsePolicy(devShellPolicy(policy))
    expect(dev.get('script-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(dev.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(dev.get('connect-src')).toEqual([...directives.get('connect-src')!, 'ws://localhost:*', 'ws://127.0.0.1:*'])
    for (const name of ['default-src', 'img-src', 'media-src', 'font-src', 'worker-src', 'object-src', 'base-uri', 'form-action', 'frame-src']) {
      expect(dev.get(name)).toEqual(directives.get(name))
    }
    const served = withDevShellPolicy(html)
    expect(SHELL_POLICY_META.exec(served)?.[1]).toBe(devShellPolicy(policy))
    expect(served.replace(SHELL_POLICY_META, '')).toBe(html.replace(SHELL_POLICY_META, ''))
  })
})
