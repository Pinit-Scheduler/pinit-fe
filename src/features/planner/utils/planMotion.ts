/** Pure helpers behind the PlanPage motion: the arrival stagger, and which rows flash after a new proposal. */

/** Rows of the arrival stagger after the first few start together, so long lists never wait. */
export const PLAN_STAGGER_CAP = 6
export const staggerIndex = (index: number) =>
  Math.max(0, Math.min(index, PLAN_STAGGER_CAP))

/**
 * Task ids whose suggested start or type moved between two proposals for the same request.
 * Rows that are new or gone are left to list presence.
 */
export const movedSuggestions = (
  previous: readonly { taskId: number; suggestedStartLocal: string; suggestedType: string }[],
  next: readonly { taskId: number; suggestedStartLocal: string; suggestedType: string }[],
): Set<number> => {
  const before = new Map(previous.map((draft) => [draft.taskId, draft]))
  const moved = new Set<number>()
  next.forEach((draft) => {
    const old = before.get(draft.taskId)
    if (
      old &&
      (old.suggestedStartLocal !== draft.suggestedStartLocal ||
        old.suggestedType !== draft.suggestedType)
    )
      moved.add(draft.taskId)
  })
  return moved
}
