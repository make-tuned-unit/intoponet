import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keyboard focus on a control that a render takes away (a folder deleted from its own menu, a workspace
 * deleted, an Undo used or expired) is never dropped on the page body: once the region has rendered without
 * it, focus goes to the first of `fallbacks` that is on screen. Focus that had moved elsewhere is left alone.
 * The focused control is read as the region renders (before the change is applied), so this does not depend
 * on focus events, which a window in the background does not get.
 */
export function useFocusRescue(root: RefObject<HTMLElement | null>, fallbacks: () => ReadonlyArray<HTMLElement | null | undefined>): void {
  const focusedBefore = useRef<Element | null>(null)
  const active = typeof document === 'undefined' ? null : document.activeElement
  focusedBefore.current = active && active !== document.body && root.current?.contains(active) ? active : null
  useEffect(() => {
    const element = focusedBefore.current
    if (!element || element.isConnected) return
    const now = document.activeElement
    if (now && now !== document.body) return
    fallbacks().find((candidate) => candidate?.isConnected)?.focus()
  })
}
