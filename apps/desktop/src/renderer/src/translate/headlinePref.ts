import { useCallback, useEffect, useState } from 'react'
import { headlinePrefEvent, headlinePrefKey, parseHeadlinePref } from '../settings/appSettings'

export function readHeadlinePref(): boolean {
  try {
    return parseHeadlinePref(localStorage.getItem(headlinePrefKey))
  } catch {
    return true
  }
}

/** Save the Original ↔ your-language choice and tell every headline list and title. */
export function writeHeadlinePref(on: boolean): void {
  try {
    localStorage.setItem(headlinePrefKey, on ? '1' : '0')
  } catch {
    // This session only.
  }
  window.dispatchEvent(new CustomEvent(headlinePrefEvent, { detail: on }))
}

/** Headlines and titles in your language (default) or as published, shared across lists. */
export function useHeadlinePref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readHeadlinePref)
  useEffect(() => {
    const onPref = (event: Event): void => setOn((event as CustomEvent<boolean>).detail === true)
    const onStorage = (): void => setOn(readHeadlinePref())
    window.addEventListener(headlinePrefEvent, onPref)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(headlinePrefEvent, onPref)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  const set = useCallback((next: boolean) => {
    setOn(next)
    writeHeadlinePref(next)
  }, [])
  return [on, set]
}
