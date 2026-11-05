/** What a tab's page is doing right now, as the tab strip shows it (see PageTabSnapshot). */
export type LiveTabFlags = { loading?: true; audible?: true; muted?: true; pinned?: true }

/** The page side of a tab: a webContents, or nothing once it has closed. */
export type TabContentsLike = {
  isLoading(): boolean
  isCurrentlyAudible(): boolean
  isAudioMuted(): boolean
}

/** Only the flags that are on, so snapshots of quiet tabs stay as small as before. */
export function liveTabFlags(contents: TabContentsLike | null, tab: { start?: boolean; pinned?: boolean }): LiveTabFlags {
  return {
    ...(contents && !tab.start && contents.isLoading() ? { loading: true as const } : {}),
    ...(contents?.isCurrentlyAudible() ? { audible: true as const } : {}),
    ...(contents?.isAudioMuted() ? { muted: true as const } : {}),
    ...(tab.pinned ? { pinned: true as const } : {}),
  }
}
