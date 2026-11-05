import type { HistoryVisit } from '@intoponet/browser-api'

/**
 * Read-only access to browsing history for other parts of the shell (e.g. address-bar
 * suggestions). Results are newest first and already follow the privacy rules (no private tabs,
 * no excluded sites, retention applied).
 */
export async function searchHistory(query: string, limit = 8): Promise<HistoryVisit[]> {
  try {
    const result = await window.intoponet.history.search(query, { limit: Math.max(1, Math.min(500, limit)) })
    return result.days.flatMap((day) => day.visits)
  } catch {
    return []
  }
}

type Listener = () => void
const openListeners = new Set<Listener>()

/** Open the History view (the library drawer's History button; ⌘Y arrives from the app menu). */
export function openHistory(): void {
  for (const listener of openListeners) listener()
}

export function onOpenHistory(listener: Listener): () => void {
  openListeners.add(listener)
  return () => { openListeners.delete(listener) }
}
