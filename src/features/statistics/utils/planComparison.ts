export type PlannedRecord = {
  id: number
  date: string
  state: string
  plannedMinutes: number | null
}
export function summarizePlans(
  records: PlannedRecord[],
  start: string,
  end: string,
) {
  const unique = new Map(records.map((r) => [r.id, r]))
  const selected = [...unique.values()].filter(
    (r) => r.date >= start && r.date < end,
  )
  const days = new Map<string, number>()
  let completedPlanned = 0,
    totalPlanned = 0,
    unknown = 0
  const states: Record<string, number> = {
    NOT_STARTED: 0,
    IN_PROGRESS: 0,
    SUSPENDED: 0,
    COMPLETED: 0,
  }
  for (const r of selected) {
    states[r.state] = (states[r.state] ?? 0) + 1
    if (r.plannedMinutes === null) {
      unknown++
      continue
    }
    totalPlanned += r.plannedMinutes
    if (r.state === 'COMPLETED') completedPlanned += r.plannedMinutes
    days.set(r.date, (days.get(r.date) ?? 0) + r.plannedMinutes)
  }
  return {
    totalPlanned,
    completedPlanned,
    unknown,
    total: selected.length,
    states,
    days: [...days].sort(([a], [b]) => a.localeCompare(b)),
  }
}
