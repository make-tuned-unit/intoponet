import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { packageFolderOf, packagesOf } from './bundledPackages'

describe('which npm package a bundled module belongs to', () => {
  it('finds the package folder through markers, queries, scopes and nested node_modules', () => {
    expect(packageFolderOf('/repo/node_modules/react/index.js')).toBe('/repo/node_modules/react')
    expect(packageFolderOf('/repo/node_modules/@cantoo/pdf-lib/es/index.js')).toBe('/repo/node_modules/@cantoo/pdf-lib')
    // Text imported with ?raw (Readability, DOMPurify) and styles imported with ?inline (the Inter font).
    expect(packageFolderOf('/repo/node_modules/dompurify/dist/purify.min.js?raw')).toBe('/repo/node_modules/dompurify')
    expect(packageFolderOf('/repo/node_modules/@fontsource-variable/inter/opsz.css?inline')).toBe('/repo/node_modules/@fontsource-variable/inter')
    // A plugin's own module for a package file.
    expect(packageFolderOf('\0/repo/node_modules/scheduler/index.js?commonjs-module')).toBe('/repo/node_modules/scheduler')
    // A package inside another package's node_modules is its own package.
    expect(packageFolderOf('/repo/node_modules/a/node_modules/@b/c/lib/x.js')).toBe('/repo/node_modules/a/node_modules/@b/c')
    expect(packageFolderOf('C:\\repo\\node_modules\\three\\build\\three.module.js')).toBe('C:/repo/node_modules/three')
  })

  it("leaves the app's own code, workspace packages and plugin helpers out", () => {
    expect(packageFolderOf('/repo/apps/desktop/src/main/index.ts')).toBeNull()
    expect(packageFolderOf('/repo/packages/protection-engine/src/index.ts')).toBeNull()
    expect(packageFolderOf('\0commonjsHelpers.js')).toBeNull()
    expect(packageFolderOf('\0vite/modulepreload-polyfill.js')).toBeNull()
    expect(packageFolderOf('/repo/node_modules/.vite-cache.js')).toBeNull()
    expect(packageFolderOf('/repo/node_modules/@scope')).toBeNull()
  })

  const dir = mkdtempSync(join(tmpdir(), 'intoponet-bundled-packages-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const install = (path: string, manifest: object | null): void => {
    mkdirSync(join(dir, 'node_modules', path), { recursive: true })
    if (manifest) writeFileSync(join(dir, 'node_modules', path, 'package.json'), JSON.stringify(manifest))
  }

  it('reads name, version and licence from each package once, and counts its modules', () => {
    install('alpha', { name: 'alpha', version: '1.2.3', license: 'MIT' })
    install('@scope/beta', { name: '@scope/beta', version: '0.1.0', license: '(MPL-2.0 OR Apache-2.0)' })
    install('old', { name: 'old', version: '2.0.0', licenses: [{ type: 'BSD-3-Clause' }, { type: 'MIT' }] })
    install('bare', { name: 'bare', version: '3.0.0' })
    const found = packagesOf([
      `${dir}/node_modules/alpha/index.js`,
      `${dir}/node_modules/alpha/lib/more.js?raw`,
      `\0${dir}/node_modules/@scope/beta/style.css?inline`,
      `${dir}/node_modules/old/index.js`,
      `${dir}/node_modules/bare/index.js`,
      `${dir}/src/own.ts`,
      // An emitted asset's original file, relative to the project root.
      'node_modules/alpha/font.woff2',
    ], dir)
    expect(found).toEqual([
      { name: '@scope/beta', version: '0.1.0', license: '(MPL-2.0 OR Apache-2.0)', modules: 1 },
      { name: 'alpha', version: '1.2.3', license: 'MIT', modules: 3 },
      { name: 'bare', version: '3.0.0', license: null, modules: 1 },
      { name: 'old', version: '2.0.0', license: 'BSD-3-Clause OR MIT', modules: 1 },
    ])
  })

  it('refuses a bundled module whose package cannot be named', () => {
    install('nameless', { version: '1.0.0' })
    install('empty', null)
    expect(() => packagesOf([`${dir}/node_modules/nameless/index.js`])).toThrow(/no name or version/)
    expect(() => packagesOf([`${dir}/node_modules/empty/index.js`])).toThrow(/no package\.json/)
  })
})
