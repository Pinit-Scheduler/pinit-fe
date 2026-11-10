import { useState } from 'react'

/**
 * True once content shows for a key this screen had to wait for (a first load, or a new
 * filter or sort). Content that was already cached when the screen mounted never "arrives",
 * so returning to a screen does not replay an entrance on top of the shell's own transition.
 *
 *   const arriving = useArrival(isInitialLoading, key)
 *   <div className="row" data-arrive={arriving || undefined} />
 *
 * Rows render with the attribute from their first frame, so the CSS entrance plays once per
 * mount. A refetch keeps the rows mounted and replays nothing.
 */
export function useArrival(waiting: boolean, key: unknown = null) {
  const [waitedFor, setWaitedFor] = useState<{ key: unknown } | null>(null)
  const waitedForKey = waitedFor !== null && Object.is(waitedFor.key, key)
  if (waiting && !waitedForKey) setWaitedFor({ key })
  return !waiting && waitedForKey
}

/** Stagger step for arriving rows, capped so a long list does not keep the last rows waiting. */
export const arrivalIndex = (index: number) => Math.min(index, 8)
