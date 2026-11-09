import { useEffect, useState } from 'react'
import {
  dropExited,
  nextExitDue,
  reconcilePresence,
  type PresenceEntry,
} from './presence'
import { MOTION_EXIT_MS } from './tokens'

type ListState<T> = {
  signature: string | null
  resetKey: unknown
  entries: PresenceEntry<T>[]
}

const signatureOf = <T>(
  items: readonly T[] | undefined,
  getKey: (item: T) => string | number,
) => (items === undefined ? null : items.map((item) => String(getKey(item))).join('\u0000'))

/**
 * Keyed list presence: inserted items enter, removed items stay for one exit animation.
 * A refetch that returns the same keys animates nothing.
 *
 *   const rows = useListPresence(data?.tasks, (task) => task.id, { resetKey: filterKey })
 *   rows.map(({ key, item, phase }) => (
 *     <li key={key} {...presenceProps(phase)}>...</li>
 *   ))
 *
 * - Pass `undefined` while the first load is pending. The first defined list is the baseline and does not animate.
 * - Change `resetKey` (filter, date, space) to start a new baseline instead of animating the swap.
 */
export function useListPresence<T>(
  items: readonly T[] | undefined,
  getKey: (item: T) => string | number,
  { resetKey, exitMs = MOTION_EXIT_MS }: { resetKey?: unknown; exitMs?: number } = {},
): PresenceEntry<T>[] {
  const signature = signatureOf(items, getKey)
  const [state, setState] = useState<ListState<T>>(() => ({
    signature,
    resetKey,
    entries: items ? reconcilePresence([], items, getKey, true) : [],
  }))
  let current = state
  if (state.signature !== signature || !Object.is(state.resetKey, resetKey)) {
    const baseline = state.signature === null || !Object.is(state.resetKey, resetKey)
    current = {
      signature,
      resetKey,
      entries: items ? reconcilePresence(state.entries, items, getKey, baseline) : [],
    }
    setState(current)
  }

  const entries = current.entries
  useEffect(() => {
    const due = nextExitDue(entries, exitMs)
    if (due === null) return
    const timer = setTimeout(
      () =>
        setState((latest) => ({ ...latest, entries: dropExited(latest.entries, exitMs) })),
      due + 1,
    )
    return () => clearTimeout(timer)
  }, [entries, exitMs])

  // Present rows always render the latest item object; leaving rows keep their last snapshot.
  const byKey = new Map<string, T>()
  items?.forEach((item) => byKey.set(String(getKey(item)), item))
  return entries.map((entry) =>
    entry.phase === 'exit' ? entry : { ...entry, item: byKey.get(entry.key) ?? entry.item },
  )
}

/** Attributes for a list row in a given phase. Leaving rows ignore pointer input and leave the a11y tree. */
export const presenceProps = (phase: PresenceEntry<unknown>['phase']) =>
  phase === 'present'
    ? {}
    : phase === 'enter'
      ? { 'data-presence': 'enter' as const }
      : { 'data-presence': 'exit' as const, 'aria-hidden': true as const, inert: true }

export default useListPresence
