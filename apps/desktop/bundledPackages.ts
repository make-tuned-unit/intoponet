/**
 * Records which npm packages the build compiled into the app. The release SBOM is made from this
 * (scripts/release-inventory.cjs): `npm sbom --omit=dev` cannot see a library that is a
 * devDependency and still ends up inside the app's own files.
 *
 * It reads Rollup's own account of each build: every module that left code in a chunk, and every
 * emitted asset (fonts, pictures) with the file it came from. A module under node_modules belongs to
 * the package whose folder it is in; name, version and licence come from that package's package.json.
 * One file per build (main with its workers, preload, renderer) is written beside the build output,
 * outside it, so it does not ship.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Plugin } from 'vite'

export type BundledPackage = { name: string; version: string; license: string | null; modules: number }
export type BundledPackages = { target: string; files: string[]; packages: BundledPackage[] }

/**
 * The folder of the npm package a module id belongs to, or null for the app's own code.
 * Ids can carry a plugin's marker in front (\0) and a query behind (?raw, ?inline, ?commonjs-proxy).
 * The innermost node_modules counts: a package nested in another's node_modules is its own package.
 */
export function packageFolderOf(id: string): string | null {
  const path = id.replace(/^\0+/, '').replace(/[?#].*$/, '').replace(/\\/g, '/')
  const at = path.lastIndexOf('/node_modules/')
  if (at < 0) return null
  const parts = path.slice(at + '/node_modules/'.length).split('/')
  const name = parts[0]?.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)
  if (name.some((part) => !part) || (parts[0]?.startsWith('@') && name.length < 2)) return null
  // A file directly in node_modules (a bundler's cache, say) is not a package.
  if (parts.length <= name.length) return null
  return `${path.slice(0, at)}/node_modules/${name.join('/')}`
}

function licenceOf(manifest: { license?: unknown; licenses?: unknown }): string | null {
  if (typeof manifest.license === 'string' && manifest.license.trim()) return manifest.license.trim()
  const old = manifest.license ?? manifest.licenses
  const list = (Array.isArray(old) ? old : [old]).map((entry) => (typeof entry === 'string' ? entry : (entry as { type?: unknown } | null)?.type)).filter((entry): entry is string => typeof entry === 'string' && !!entry)
  return list.length ? list.join(' OR ') : null
}

/** Name, version and licence of each package the given module files belong to. */
export function packagesOf(ids: Iterable<string>, root = ''): BundledPackage[] {
  const found = new Map<string, BundledPackage>()
  for (const id of ids) {
    const relative = id.replace(/^\0+/, '')
    const folder = packageFolderOf(root && !relative.startsWith('/') && !/^[A-Za-z]:/.test(relative) ? `${root.replace(/\\/g, '/')}/${relative}` : relative)
    if (!folder) continue
    const manifestPath = join(folder, 'package.json')
    if (!existsSync(manifestPath)) throw new Error(`A bundled module is in ${folder}, which has no package.json: ${id}`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; version?: unknown; license?: unknown; licenses?: unknown }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw new Error(`${manifestPath} has no name or version (bundled module ${id})`)
    const key = `${manifest.name}@${manifest.version}`
    const known = found.get(key)
    if (known) known.modules += 1
    else found.set(key, { name: manifest.name, version: manifest.version, license: licenceOf(manifest), modules: 1 })
  }
  return [...found.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name < b.name ? -1 : 1))
}

/** Writes `<file>` with the packages compiled into this build. Add it to each of the three builds. */
export function bundledPackagesPlugin(target: 'main' | 'preload' | 'renderer', file: string): Plugin {
  let root = process.cwd()
  return {
    name: 'intoponet-bundled-packages',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    generateBundle(_options, bundle) {
      const ids: string[] = []
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') {
          // A module that left nothing in the chunk (tree-shaken away) is not shipped.
          for (const [id, module] of Object.entries(output.modules)) if (module.renderedLength > 0) ids.push(id)
        } else {
          // Fonts and pictures: the files they were copied from, relative to the project.
          for (const original of output.originalFileNames ?? []) ids.push(resolve(root, original))
        }
      }
      // Styles are taken out of the scripts they were imported by, so their modules show no code of
      // their own; a stylesheet from a package ships all the same (the Inter font's, for one).
      for (const id of this.getModuleIds()) if (/\.(css|scss|sass|less|styl)(\?|$)/.test(id.replace(/^\0+/, ''))) ids.push(id)
      const record: BundledPackages = { target, files: Object.keys(bundle).sort(), packages: packagesOf(ids, root) }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${JSON.stringify(record, null, 1)}\n`)
    },
  }
}
