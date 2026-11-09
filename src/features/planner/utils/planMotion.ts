import type { MouseEvent } from 'react'

/**
 * Pure helpers behind the PlanPage motion: which data belongs to the current request,
 * which rows changed after a new proposal, and how far into the arrival stagger a row sits.
 */

/** Everything the day-plan fetch depends on except the manual refresh counter. */
export const dayPlanKey = ({
  date,
  zoneId,
  horizonDays,
  spaceId,
  projectId,
}: {
  date: string
  zoneId: string
  horizonDays: number
  spaceId: number | null
  projectId: number | null
}) => `${date}@${zoneId}/${horizonDays}/${spaceId ?? 'all'}/${projectId ?? 'all'}`

/** A loaded result only belongs on screen under the key it was requested for. */
export const resultForKey = <T extends { key: string }>(
  result: T | null,
  key: string,
): T | null => (result && result.key === key ? result : null)

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

/**
 * Schedules on the timeline: the ones read with the plan plus the ones this page just created,
 * so a created schedule takes its block's place at once instead of after the refetch.
 */
export const withCreatedSchedules = <S extends { id: number }>(
  schedules: readonly S[],
  created: { date: string; schedules: readonly S[] } | null,
  planDate: string | null,
): S[] => {
  if (!created || created.date !== planDate || created.schedules.length === 0)
    return schedules as S[]
  const known = new Set(schedules.map((schedule) => schedule.id))
  const extra = created.schedules.filter((schedule) => !known.has(schedule.id))
  return extra.length === 0 ? (schedules as S[]) : [...schedules, ...extra]
}

/**
 * onClick for a plain link that opens a route surface. Plain left clicks go through
 * `open()` so the page behind stays and close returns here; modified clicks keep the link.
 */
export const surfaceLinkClick =
  (open: (path: string) => void, path: string) =>
  (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return
    event.preventDefault()
    open(path)
  }
