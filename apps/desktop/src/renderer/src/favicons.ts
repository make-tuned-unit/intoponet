import { useEffect, useState } from 'react'

/** Site icons as data URLs, from the main process's on-device cache. Requests are batched. */
const cache = new Map<string, string | null>()
const listeners = new Set<() => void>()
let queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function request(host: string): void {
  if (cache.has(host)) return
  cache.set(host, null)
  queue.add(host)
  timer ??= setTimeout(() => {
    const hosts = [...queue]
    queue = new Set()
    timer = null
    void window.intoponet.favicons.get(hosts).then((icons) => {
      for (const [host, data] of Object.entries(icons)) cache.set(host, data)
      for (const listener of listeners) listener()
    }).catch(() => undefined)
  }, 60)
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function useFavicon(url: string): string | null {
  const host = hostOf(url)
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = (): void => setTick((tick) => tick + 1)
    listeners.add(listener)
    if (host) request(host)
    return () => { listeners.delete(listener) }
  }, [host])
  return host ? cache.get(host) ?? null : null
}

/**
 * An icon already on hand, without asking for one: the address bar shows
 * these while typing, and typing must never reach a site (a missing icon is
 * otherwise fetched from the site's /favicon.ico).
 */
export function useKnownFavicon(url: string): string | null {
  const host = hostOf(url)
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = (): void => setTick((tick) => tick + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return host ? cache.get(host) ?? null : null
}
