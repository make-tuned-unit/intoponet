/**
 * The page is a native view drawn above the app window; panels that cover it hide it while open.
 * Several panels may hold it at once: it comes back when the last one lets go.
 */
let holders = 0

export function holdPage(): () => void {
  holders += 1
  if (holders === 1) void window.intoponet.browserHost.holdPage(true).catch(() => undefined)
  let released = false
  return () => {
    if (released) return
    released = true
    holders = Math.max(0, holders - 1)
    if (holders === 0) void window.intoponet.browserHost.holdPage(false).catch(() => undefined)
  }
}
