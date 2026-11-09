import { useEffect, useState } from 'react'
import { MOTION_ENTER_MS } from '@shared/motion/tokens'

/**
 * How long a row that left the list because it was completed stays on screen first.
 * The completion check fills and the strike line draws (80ms delay + 240ms); the row then
 * rests in its completed style for a beat before it fades out with useListPresence.
 */
export const SETTLE_HOLD_MS = MOTION_ENTER_MS * 2

export type SettleState<T> = {
  /** The list as received, compared by identity. */
  source: readonly T[] | undefined
  resetKey: unknown
  /** What to render: the received items plus held rows at their last position. */
  shown: readonly T[] | undefined
  /** Held keys and when they stop being held (ms). */
  heldUntil: ReadonlyMap<string, number>
}

export const initialSettle = <T>(
  items: readonly T[] | undefined,
  resetKey: unknown,
): SettleState<T> => ({ source: items, resetKey, shown: items, heldUntil: new Map() })

/**
 * Next state for a new list. A row that disappears while `isSettled` says it is done is held
 * where it was until its hold ends. Rows that disappear for any other reason (a delete, a
 * reassignment) leave at once. A held row that comes back is no longer held.
 */
export function settleStep<T>(
  state: SettleState<T>,
  items: readonly T[] | undefined,
  resetKey: unknown,
  getKey: (item: T) => string | number,
  isSettled: (item: T) => boolean,
  now: number,
  holdMs = SETTLE_HOLD_MS,
): SettleState<T> {
  if (state.source === items && Object.is(state.resetKey, resetKey)) return state
  if (
    items === undefined ||
    state.shown === undefined ||
    !Object.is(state.resetKey, resetKey)
  )
    return initialSettle(items, resetKey)
  const nextKeys = new Set(items.map((item) => String(getKey(item))))
  const heldUntil = new Map<string, number>()
  const shown: T[] = [...items]
  const previous = state.shown
  previous.forEach((item, index) => {
    const key = String(getKey(item))
    if (nextKeys.has(key)) return
    const until = state.heldUntil.get(key) ?? (isSettled(item) ? now + holdMs : undefined)
    if (until === undefined || until <= now) return
    heldUntil.set(key, until)
    // Put it back after the closest earlier row that is still shown.
    let anchor = -1
    for (let i = index - 1; i >= 0; i--) {
      const previousKey = String(getKey(previous[i]))
      const at = shown.findIndex((candidate) => String(getKey(candidate)) === previousKey)
      if (at >= 0) {
        anchor = at
        break
      }
    }
    shown.splice(anchor + 1, 0, item)
  })
  return { source: items, resetKey, shown: heldUntil.size ? shown : items, heldUntil }
}

/** Drop the held rows whose hold has ended. */
export function releaseSettled<T>(
  state: SettleState<T>,
  getKey: (item: T) => string | number,
  now: number,
): SettleState<T> {
  if (!state.shown || state.heldUntil.size === 0) return state
  const heldUntil = new Map([...state.heldUntil].filter(([, until]) => until > now))
  if (heldUntil.size === state.heldUntil.size) return state
  const shown = heldUntil.size
    ? state.shown.filter((item) => {
        const key = String(getKey(item))
        return !state.heldUntil.has(key) || heldUntil.has(key)
      })
    : state.source
  return { ...state, shown, heldUntil }
}

/** Milliseconds until the next hold ends, or null when nothing is held. */
export const nextRelease = (heldUntil: ReadonlyMap<string, number>, now: number) => {
  let due: number | null = null
  heldUntil.forEach((until) => {
    const wait = Math.max(0, until - now)
    due = due === null ? wait : Math.min(due, wait)
  })
  return due
}

/**
 * Keeps a row that was just completed in place for a moment after a refetch drops it, so the
 * completion check and strike line finish before the row leaves. Feed the result to
 * useListPresence, which then fades the row out.
 */
export function useSettlingList<T>(
  items: readonly T[] | undefined,
  getKey: (item: T) => string | number,
  isSettled: (item: T) => boolean,
  { resetKey, holdMs = SETTLE_HOLD_MS }: { resetKey?: unknown; holdMs?: number } = {},
): readonly T[] | undefined {
  const [state, setState] = useState(() => initialSettle(items, resetKey))
  let current = state
  if (state.source !== items || !Object.is(state.resetKey, resetKey)) {
    current = settleStep(state, items, resetKey, getKey, isSettled, Date.now(), holdMs)
    setState(current)
  }
  const heldUntil = current.heldUntil
  useEffect(() => {
    const due = nextRelease(heldUntil, Date.now())
    if (due === null) return
    const timer = setTimeout(
      () => setState((latest) => releaseSettled(latest, getKey, Date.now())),
      due + 1,
    )
    return () => clearTimeout(timer)
    // getKey is read when the timer fires; a new function each render must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldUntil])
  return current.shown
}
