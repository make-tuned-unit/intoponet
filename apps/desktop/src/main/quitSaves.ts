/**
 * Quitting waits for saves on their way to disk: the ones running when the quit began and any that
 * start while it waits (the one-second history save, a library save sent as the window closes),
 * until none are left or the deadline passes. Resolves true when every save finished, false when
 * the deadline came first.
 */
export async function waitForSaves(pending: () => ReadonlyArray<Promise<unknown>>, deadline: number, now: () => number = Date.now): Promise<boolean> {
  for (;;) {
    const saves = pending()
    if (!saves.length) return true
    const left = deadline - now()
    if (left <= 0) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finished = await Promise.race([
      Promise.allSettled(saves).then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), left) }),
    ])
    clearTimeout(timer)
    if (!finished) return false
    // A save takes itself off its list just after it settles: let that happen before looking again.
    await new Promise((resolve) => setImmediate(resolve))
  }
}
