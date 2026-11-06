import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative, isAbsolute, sep } from 'node:path'
import type { ImportProfile } from '../../shared/browserImport'

/**
 * Chromium-based browsers and where they keep their profiles, under ~/Library/Application Support.
 * `keychain` is the "… Safe Storage" item that holds the key to their saved passwords.
 */
export type BrowserSource = {
  key: string
  name: string
  /** Folder under Application Support that holds the profiles. */
  folder: string
  keychain: { service: string; account: string }
  /** Arc: the sidebar file (spaces, pinned tabs, folders), relative to Application Support. */
  sidebar?: string
  /** Opera keeps one profile in the browser folder itself. */
  profileAtRoot?: boolean
}

export const BROWSER_SOURCES: readonly BrowserSource[] = [
  { key: 'arc', name: 'Arc', folder: join('Arc', 'User Data'), keychain: { service: 'Arc Safe Storage', account: 'Arc' }, sidebar: join('Arc', 'StorableSidebar.json') },
  { key: 'chrome', name: 'Google Chrome', folder: join('Google', 'Chrome'), keychain: { service: 'Chrome Safe Storage', account: 'Chrome' } },
  { key: 'chrome-beta', name: 'Google Chrome Beta', folder: join('Google', 'Chrome Beta'), keychain: { service: 'Chrome Safe Storage', account: 'Chrome' } },
  { key: 'brave', name: 'Brave', folder: join('BraveSoftware', 'Brave-Browser'), keychain: { service: 'Brave Safe Storage', account: 'Brave' } },
  { key: 'edge', name: 'Microsoft Edge', folder: 'Microsoft Edge', keychain: { service: 'Microsoft Edge Safe Storage', account: 'Microsoft Edge' } },
  { key: 'vivaldi', name: 'Vivaldi', folder: 'Vivaldi', keychain: { service: 'Vivaldi Safe Storage', account: 'Vivaldi' } },
  { key: 'chromium', name: 'Chromium', folder: 'Chromium', keychain: { service: 'Chromium Safe Storage', account: 'Chromium' } },
  { key: 'opera', name: 'Opera', folder: 'com.operasoftware.Opera', keychain: { service: 'Opera Safe Storage', account: 'Opera' }, profileAtRoot: true },
]

/** The files a profile may hold that the importer reads. Nothing else in a profile is opened. */
export const PROFILE_FILES = { bookmarks: 'Bookmarks', history: 'History', logins: 'Login Data' } as const

const PROFILE_FOLDER = /^(Default|Profile \d{1,4})$/

function inside(child: string, parent: string): boolean {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path) && !path.split(sep).includes('..')
}

/**
 * Where browsers keep their folders: ~/Library/Application Support. Tests point
 * INTOPONET_IMPORT_ROOT at fixture profiles; it is honoured only inside the temporary folder or
 * the app's own data folder, so it cannot point the importer at someone else's files.
 */
export function importRoot(env: NodeJS.ProcessEnv = process.env, userData?: string): { root: string; testing: boolean } {
  const override = env['INTOPONET_IMPORT_ROOT']
  if (override) {
    try {
      const real = realpathSync(override)
      const allowed = [realpathSync(tmpdir()), ...(userData ? [realpathSync(userData)] : [])]
      if (allowed.some((parent) => inside(real, parent))) return { root: real, testing: true }
    } catch {
      // A missing or unreadable override falls through to the refusal below.
    }
    throw new Error('INTOPONET_IMPORT_ROOT must be a folder inside the temporary folder.')
  }
  return { root: join(homedir(), 'Library', 'Application Support'), testing: false }
}

/** A real folder (not a link that could lead elsewhere). */
function isFolder(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** A real file (not a link) no larger than `limit`. */
export function isFile(path: string, limit = Number.POSITIVE_INFINITY): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit
  } catch {
    return false
  }
}

/** Profile names from the browser's "Local State" (info_cache), when it can be read. */
function profileNames(browserFolder: string): Record<string, string> {
  const path = join(browserFolder, 'Local State')
  if (!isFile(path, 20_000_000)) return {}
  try {
    const state = JSON.parse(readFileSync(path, 'utf8')) as { profile?: { info_cache?: Record<string, { name?: unknown }> } }
    const cache = state.profile?.info_cache
    if (!cache || typeof cache !== 'object') return {}
    const names: Record<string, string> = {}
    for (const [folder, info] of Object.entries(cache)) {
      if (PROFILE_FOLDER.test(folder) && typeof info?.name === 'string') names[folder] = info.name.slice(0, 80)
    }
    return names
  } catch {
    return {}
  }
}

export type DetectedProfile = ImportProfile & { source: BrowserSource; path: string }

const hasProfileData = (path: string): boolean => Object.values(PROFILE_FILES).some((file) => isFile(join(path, file)))

/** Every profile of every known browser under `root`. Only folder listings and profile names are read. */
export function detectProfiles(root: string): DetectedProfile[] {
  const found: DetectedProfile[] = []
  for (const source of BROWSER_SOURCES) {
    const browserFolder = join(root, source.folder)
    if (!isFolder(browserFolder)) continue
    if (source.profileAtRoot) {
      if (hasProfileData(browserFolder)) found.push({ id: `${source.key}:root`, browser: source.key, browserName: source.name, folder: 'root', name: '', source, path: browserFolder })
      continue
    }
    const names = profileNames(browserFolder)
    let folders: string[] = []
    try {
      folders = readdirSync(browserFolder).filter((name) => PROFILE_FOLDER.test(name)).sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : Number(a.slice(8)) - Number(b.slice(8))))
    } catch {
      continue
    }
    for (const folder of folders) {
      const path = join(browserFolder, folder)
      const sidebar = source.sidebar && folder === 'Default' && isFile(join(root, source.sidebar))
      if (!isFolder(path) || (!hasProfileData(path) && !sidebar)) continue
      found.push({ id: `${source.key}:${folder}`, browser: source.key, browserName: source.name, folder, name: names[folder] ?? '', source, path })
    }
  }
  return found
}

/** The profile as the shell may see it (no paths). */
export const publicProfile = ({ id, browser, browserName, folder, name }: DetectedProfile): ImportProfile => ({ id, browser, browserName, folder, name })
