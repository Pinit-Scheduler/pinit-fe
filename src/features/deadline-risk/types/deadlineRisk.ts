export type DeadlineRiskDays = 7 | 14

export type DeadlineRiskStatus =
  | 'FEASIBLE'
  | 'SHORTAGE'
  | 'AT_RISK'
  | 'OVERDUE'
  | 'UNKNOWN'

/** GET /v2/plans/deadline-risk. All instants include UTC offset/Z. */
export type DeadlineRiskItem = {
  taskId: number
  title: string
  /** Exclusive end of the task's deadline date, in its saved deadline zone. */
  deadline: string
  status: DeadlineRiskStatus
  /** Remaining task + incomplete predecessor chain; shared predecessors count once. */
  requiredMinutes: number
  /** Capacity upper bound for this chain, including its fixed reservations once. */
  availableMinutes: number
  /** max(required - capacity upper bound, 0). AT_RISK can have zero shortage. */
  shortageMinutes: number
  predecessorTaskIds: number[]
  reasons: string[]
  suggestedFinish: string | null
  recurrenceSeriesId: number | null
}

export type DeadlineRiskResponse = {
  generatedAt: string
  zoneId: string
  days: DeadlineRiskDays
  /** Exclusive local midnight at the end of the bounded forecast. */
  horizonEnd: string
  calibrationApplied: boolean
  assumptions: string[]
  limitations: string[]
  items: DeadlineRiskItem[]
}
