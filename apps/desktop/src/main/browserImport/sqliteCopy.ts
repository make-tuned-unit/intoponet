import { chmodSync, constants, copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isFile } from './sources'

/** Browser databases larger than this are not copied. */
export const MAX_DATABASE_BYTES = 1_024 * 1_024 * 1_024

/**
 * Read a browser's SQLite file from a private copy: the browser may be running and holding it
 * locked, and the original must never be written to. The copy is opened read-only and deleted
 * straight after, whatever happens.
 */
export function withDatabaseCopy<T>(source: string, read: (db: DatabaseSync) => T): T {
  if (!isFile(source, MAX_DATABASE_BYTES)) throw new Error('The browser\'s file is missing or too large to read.')
  const folder = mkdtempSync(join(tmpdir(), 'intoponet-import-'))
  try {
    chmodSync(folder, 0o700)
    const copy = join(folder, 'copy.sqlite')
    copyFileSync(source, copy, constants.COPYFILE_EXCL)
    // A write-ahead log holds the newest changes; it is copied with the file when there is one.
    if (existsSync(`${source}-wal`) && isFile(`${source}-wal`, MAX_DATABASE_BYTES)) copyFileSync(`${source}-wal`, `${copy}-wal`, constants.COPYFILE_EXCL)
    chmodSync(copy, 0o600)
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/** Whether a table has every one of these columns (a file that does not is not read). */
export function hasColumns(db: DatabaseSync, table: string, columns: string[]): boolean {
  if (!/^[a-z_]+$/.test(table)) return false
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>
  const names = new Set(rows.map((row) => row.name))
  return columns.every((column) => names.has(column))
}
