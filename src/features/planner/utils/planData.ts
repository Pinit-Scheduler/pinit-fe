/** Which day-plan data belongs on screen, and what the timeline shows. */

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
