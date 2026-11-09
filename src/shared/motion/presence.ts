/** Pure state machines behind usePresence and useListPresence. */

export type PresenceState<T> = { value: T; closing: boolean } | null

const isPresent = <T>(value: T | null | undefined | false): value is T =>
  value !== null && value !== undefined && value !== false

/**
 * Next presence state for a value that may disappear. A value that goes away keeps rendering
 * as `closing` until the exit timer ends it. A value that comes back cancels the exit.
 * Returns the same object when nothing changes, so callers can compare by identity.
 */
export function presenceStep<T>(
  state: PresenceState<T>,
  value: T | null | undefined | false,
): PresenceState<T> {
  if (isPresent(value)) {
    if (state && !state.closing && Object.is(state.value, value)) return state
    return { value, closing: false }
  }
  if (state && !state.closing) return { value: state.value, closing: true }
  return state
}

export type PresencePhase = 'enter' | 'present' | 'exit'
export type PresenceEntry<T> = {
  key: string
  item: T
  phase: PresencePhase
  /** When the entry started leaving (ms). Only set for phase 'exit'. */
  exitedAt?: number
}

/**
 * Reconcile the rendered list with the next items.
 * - `baseline` (first data, or a reset such as a filter change): everything is present, nothing animates.
 * - New keys enter. Keys that were already shown stay present, so a refetch never replays an entrance.
 * - Missing keys exit in place, next to the neighbour they followed, until the caller removes them.
 * - A key that returns while exiting becomes present again.
 */
export function reconcilePresence<T>(
  previous: readonly PresenceEntry<T>[],
  items: readonly T[],
  getKey: (item: T) => string | number,
  baseline: boolean,
  now = Date.now(),
): PresenceEntry<T>[] {
  if (baseline)
    return items.map((item) => ({ key: String(getKey(item)), item, phase: 'present' }))
  const known = new Set(previous.filter((entry) => entry.phase !== 'exit').map((entry) => entry.key))
  const nextKeys = new Set<string>()
  const next: PresenceEntry<T>[] = items.map((item) => {
    const key = String(getKey(item))
    nextKeys.add(key)
    const wasShown = known.has(key) || previous.some((entry) => entry.key === key)
    return { key, item, phase: wasShown ? 'present' : 'enter' }
  })
  // Put each leaving entry back after the closest earlier entry that is still in the list.
  previous.forEach((entry, index) => {
    if (nextKeys.has(entry.key)) return
    const leaving: PresenceEntry<T> = {
      ...entry,
      phase: 'exit',
      exitedAt: entry.phase === 'exit' ? entry.exitedAt : now,
    }
    let anchor = -1
    for (let i = index - 1; i >= 0; i--) {
      const at = next.findIndex((candidate) => candidate.key === previous[i].key)
      if (at >= 0) {
        anchor = at
        break
      }
    }
    next.splice(anchor + 1, 0, leaving)
  })
  return next
}

/** Drop entries that have been leaving for at least `exitMs`. */
export const dropExited = <T>(
  entries: readonly PresenceEntry<T>[],
  exitMs: number,
  now = Date.now(),
) =>
  entries.filter(
    (entry) => entry.phase !== 'exit' || now - (entry.exitedAt ?? now) < exitMs,
  )

/** Milliseconds until the next leaving entry should be dropped, or null when none is leaving. */
export const nextExitDue = <T>(
  entries: readonly PresenceEntry<T>[],
  exitMs: number,
  now = Date.now(),
) => {
  let due: number | null = null
  for (const entry of entries) {
    if (entry.phase !== 'exit') continue
    const wait = Math.max(0, (entry.exitedAt ?? now) + exitMs - now)
    due = due === null ? wait : Math.min(due, wait)
  }
  return due
}
