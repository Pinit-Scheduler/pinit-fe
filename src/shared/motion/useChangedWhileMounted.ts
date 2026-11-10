import { useState } from 'react'

/**
 * True once `value` differs from the value it had when it was mounted, so a state the screen
 * opened with shows still and only a change made while it is on screen animates.
 * Pass `mounted = false` while the thing is not shown; the next mount starts a new baseline.
 */
export function useChangedWhileMounted<T>(value: T, mounted = true): boolean {
  const [tracked, setTracked] = useState<{ first: T; changed: boolean } | null>(() =>
    mounted ? { first: value, changed: false } : null,
  )
  if (!mounted) {
    if (tracked !== null) setTracked(null)
    return false
  }
  if (tracked === null) {
    setTracked({ first: value, changed: false })
    return false
  }
  if (!tracked.changed && !Object.is(value, tracked.first)) {
    setTracked({ first: tracked.first, changed: true })
    return true
  }
  return tracked.changed
}
