// Import from another browser: what the app shell and main process say to each other.
// Passwords never cross this channel; only counts do.

export const browserImportChannels = {
  command: 'intoponet:browser-import',
} as const

export const IMPORT_CATEGORIES = ['bookmarks', 'pinned', 'open', 'history', 'passwords'] as const
export type ImportCategory = (typeof IMPORT_CATEGORIES)[number]

/** One browser profile found on this Mac. The shell only ever names it by id. */
export type ImportProfile = {
  /** "<browser>:<profile folder>", e.g. "chrome:Default". */
  id: string
  browser: string
  browserName: string
  /** The folder name (Default, Profile 1). */
  folder: string
  /** The name the browser shows for it, when it keeps one. */
  name: string
}

/** What one category would bring, before anything is written. */
export type ImportCount = {
  /** null: this browser keeps nothing that can be read reliably for this. */
  count: number | null
  /** Why a count is missing or limited, in a plain sentence. */
  note?: string
}

export type ImportPreview = {
  profileId: string
  counts: Record<ImportCategory, ImportCount>
  /** Folders (bookmark folders, sidebar spaces and folders) that become collections. */
  folders: number
}

export type ImportSkip = { category: ImportCategory; count: number; reason: string }

export type ImportRunResult = {
  /** A private-library document with the bookmarks and collections to merge (no passwords), or null. */
  library: string | null
  added: { pinned: number; open: number; history: number; passwords: number }
  skipped: ImportSkip[]
}

export type BrowserImportCommand =
  | { type: 'detect' }
  | { type: 'preview'; profileId: string }
  | { type: 'run'; profileId: string; categories: ImportCategory[] }

export interface BrowserImportApi {
  detect(): Promise<ImportProfile[]>
  preview(profileId: string): Promise<ImportPreview>
  /** Passwords: macOS asks for Keychain access to that browser's key first. */
  run(profileId: string, categories: ImportCategory[]): Promise<ImportRunResult>
}

const PROFILE_ID = /^[a-z][a-z0-9-]{1,30}:(Default|Profile \d{1,4}|Guest Profile|root)$/

export function parseBrowserImportCommand(value: unknown): BrowserImportCommand {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const profileId = (): string => {
    const id = input['profileId']
    if (typeof id !== 'string' || !PROFILE_ID.test(id)) throw new Error('Invalid browser profile.')
    return id
  }
  switch (input['type']) {
    case 'detect': return { type: 'detect' }
    case 'preview': return { type: 'preview', profileId: profileId() }
    case 'run': {
      const raw = input['categories']
      if (!Array.isArray(raw) || raw.length > IMPORT_CATEGORIES.length) throw new Error('Invalid import choice.')
      const categories = IMPORT_CATEGORIES.filter((category) => raw.includes(category))
      if (categories.length !== raw.length) throw new Error('Invalid import choice.')
      return { type: 'run', profileId: profileId(), categories }
    }
    default: throw new Error('Invalid import command.')
  }
}
