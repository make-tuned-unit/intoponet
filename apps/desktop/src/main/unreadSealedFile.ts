/**
 * A sealed file (history, archived tabs) that was on disk when the app started but could not be read,
 * because on-device encryption (the Keychain) was unavailable. It is read as soon as encryption is
 * available and before anything is saved over it: what this run recorded is merged with what it holds,
 * and what was removed in the meantime (clearing history) is left out of it too. Until then nothing may
 * be written over it.
 */
export class UnreadSealedFile<T> {
  private unread = false
  private removals: Array<(item: T) => boolean> = []
  private reading: Promise<boolean> | null = null

  constructor(private readonly options: {
    exists: () => boolean
    available: () => boolean | Promise<boolean>
    /** Decrypts the file and merges the items `keep` accepts; false (or a throw) when what it holds cannot be read. */
    read: (keep: (item: T) => boolean) => boolean | Promise<boolean>
    /** Keeps a file that cannot be read aside (setAsideUnreadable), never replaced by the next save. */
    setAside: () => void
    /** It was read: what it held is in memory now. */
    onRead?: () => void
  }) {}

  /** The file is there but encryption is unavailable: it is left unread for now. */
  markUnread(): void {
    this.unread = true
  }

  get isUnread(): boolean {
    return this.unread
  }

  /** Something was removed while the file is unread (history cleared): what it holds is filtered the same way when read. */
  removed(matches: (item: T) => boolean): void {
    if (this.unread) this.removals.push(matches)
  }

  /** Reads the file if encryption is available now. True when nothing is left unread, so saving is safe. */
  settle(): Promise<boolean> {
    if (!this.unread) return Promise.resolve(true)
    this.reading ??= this.readNow().finally(() => { this.reading = null })
    return this.reading
  }

  private async readNow(): Promise<boolean> {
    if (!this.options.exists()) {
      this.unread = false
      this.removals = []
      return true
    }
    if (!(await this.options.available())) return false
    const removals = this.removals
    try {
      if (!(await this.options.read((item) => !removals.some((matches) => matches(item))))) this.options.setAside()
    } catch (error) {
      console.error('Could not read a sealed file:', error)
      this.options.setAside()
    }
    this.unread = false
    this.removals = []
    this.options.onRead?.()
    return true
  }
}
