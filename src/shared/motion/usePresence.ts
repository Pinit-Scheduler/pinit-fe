import { useEffect, useState } from 'react'
import { presenceStep, type PresenceState } from './presence'
import { MOTION_EXIT_MS } from './tokens'

export type Presence<T> = {
  /** Render the element while this is true. */
  mounted: boolean
  /** The element is playing its exit. Pass it to Modal `closing` or set data-state="closing". */
  closing: boolean
  /** The latest present value, kept through the exit so the closing element can still render it. */
  value: T | undefined
}

/**
 * Delays an unmount until the exit animation has played.
 *
 *   const presence = usePresence(isOpen)            // boolean
 *   const presence = usePresence(selectedTask)      // value or null; keeps the last task while closing
 *   {presence.mounted && <Modal closing={presence.closing} ...>}
 *
 * Pass a stable value (state, a prop or a memoized object), never an object literal built
 * during render: a new object every render would re-render forever.
 */
export function usePresence<T>(
  value: T | null | undefined | false,
  { exitMs = MOTION_EXIT_MS }: { exitMs?: number } = {},
): Presence<T> {
  const [state, setState] = useState<PresenceState<T>>(() => presenceStep(null, value))
  const next = presenceStep(state, value)
  if (next !== state) setState(next)

  const closing = next?.closing ?? false
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(
      () => setState((current) => (current?.closing ? null : current)),
      exitMs,
    )
    return () => clearTimeout(timer)
  }, [closing, exitMs])

  return { mounted: next !== null, closing, value: next?.value }
}

export default usePresence
