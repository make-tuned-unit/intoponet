/**
 * After Enter in the address bar, the bar clears once the navigation has started: when main says it
 * has started loading that address, or when the open has settled (an open tab shown, a topic). A
 * clear that comes late never wipes the bar once anything else has changed it since (typing, ⌘L).
 */
export class LauncherClear {
  private pending: { ticket: number; url: string | null } | null = null
  private next = 0

  /** Enter was pressed for `url` (null when the address could not be worked out here): a ticket for when it settles. */
  submit(url: string | null): number {
    this.next += 1
    this.pending = { ticket: this.next, url }
    return this.next
  }

  /** The bar changed (typed in, filled from the page): no earlier Enter clears it any more. */
  edited(): void {
    this.pending = null
  }

  /** Main started loading `url`: true when that is what Enter asked for, and the bar should clear now. */
  started(url: string): boolean {
    if (!this.pending || this.pending.url === null || this.pending.url !== url) return false
    this.pending = null
    return true
  }

  /** The open for `ticket` settled: true when the bar should clear now (nothing cleared or changed it yet). */
  settled(ticket: number): boolean {
    if (this.pending?.ticket !== ticket) return false
    this.pending = null
    return true
  }

  /** The open for `ticket` failed before anything loaded: the bar keeps what was typed. */
  failed(ticket: number): void {
    if (this.pending?.ticket === ticket) this.pending = null
  }
}
