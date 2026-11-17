import type { WebContents, WebFrameMain } from 'electron'

type FrameOwner = Pick<WebContents, 'isDestroyed' | 'mainFrame'>

/**
 * A page's main frame, or null when there is none to reach: its contents is destroyed, or its renderer has gone.
 * A crashed page's contents lives on for a moment, and Electron throws on reading its frame then ("Render frame
 * was disposed before WebFrameMain could be accessed"); thrown from a timer, that stops the whole app behind
 * an error alert.
 */
export function mainFrameOf(contents: FrameOwner): WebFrameMain | null {
  try {
    return contents.isDestroyed() ? null : contents.mainFrame ?? null
  } catch {
    return null
  }
}

/** Every frame of a page (its main frame first); none when the page's renderer has gone. */
export function framesOf(contents: FrameOwner): WebFrameMain[] {
  try {
    return mainFrameOf(contents)?.framesInSubtree ?? []
  } catch {
    return []
  }
}
