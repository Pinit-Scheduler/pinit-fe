/** Existing Schedule IDs survive both preview and apply. Times are ISO instants. */
export type DayReplanRequest = {
  spaceId: number
  projectId: number | null
  date: string
  zoneId: string
  delayMinutes: number
}

export type ReplanChange = {
  scheduleId: number
  taskId: number
  title: string
  expectedVersion: number
  beforeStart: string
  beforeEnd: string
  afterStart: string
  afterEnd: string
  calibrationApplied: boolean
}

export type DayReplanPreview = DayReplanRequest & {
  plannedAt: string
  snapshotToken: string
  windowStart: string
  windowEnd: string
  changes: ReplanChange[]
  protectedSchedules: {
    scheduleId: number
    title: string
    start: string
    end: string
    reason: string
  }[]
  unplaced: {
    scheduleId: number
    taskId: number
    title: string
    reason: string
  }[]
}

export type DayReplanApplyRequest = DayReplanRequest & {
  plannedAt: string
  snapshotToken: string
  selectedScheduleIds: number[]
}

export type DayReplanApplyResponse = { appliedScheduleIds: number[] }
