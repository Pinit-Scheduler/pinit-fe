import type { TaskChangedDetail } from '@shared/utils/events'

/** Reasons the detail modal dispatches for its own completion toggle. */
const OWN_TOGGLE_REASONS = new Set(['complete', 'reopen'])

/**
 * Which task changes should make the detail of `taskId` read itself again (audit A6).
 * - The echo of the modal's own toggles is skipped: it already holds the saved task.
 *   `ownToggles` says how many such echoes are still expected; the rest is returned.
 * - Another task matters only when it is linked: completing a previous task changes what
 *   still blocks this one. A change without a task id (space, recurrence) always matters.
 */
export function detailRefreshNeeded(
  details: readonly TaskChangedDetail[],
  taskId: number,
  relatedIds: readonly number[],
  ownToggles: number,
): { refetch: boolean; ownToggles: number } {
  let skip = ownToggles
  const relevant = details.filter((detail) => {
    if (
      skip > 0 &&
      detail.taskId === taskId &&
      OWN_TOGGLE_REASONS.has(detail.reason ?? '')
    ) {
      skip--
      return false
    }
    return (
      detail.taskId === undefined ||
      detail.taskId === taskId ||
      relatedIds.includes(detail.taskId)
    )
  })
  return { refetch: relevant.length > 0, ownToggles: skip }
}
