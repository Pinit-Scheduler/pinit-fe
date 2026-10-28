import type { DateTimeWithZone, DateWithOffset } from '@shared/types/datetime'
import type { RecurrenceRef } from '@features/recurrence/types/recurrence'

/** 작업과 함께 지운 일정. 작업을 복구하면 함께 돌아온다(ADR-0024 §3). */
export type TrashedTaskSchedule = {
  scheduleId: number
  title: string
  date: DateTimeWithZone
}

export type TrashedTask = {
  taskId: number
  title: string
  dueDate: DateWithOffset
  completed: boolean
  recurrence: RecurrenceRef | null
  deletedAt: DateTimeWithZone
  /** 이 시각에 자동으로 영구 삭제된다. */
  purgeAt: DateTimeWithZone
  schedules: TrashedTaskSchedule[]
}

export type TrashedSchedule = {
  scheduleId: number
  title: string
  date: DateTimeWithZone
  state: 'NOT_STARTED' | 'COMPLETED' | string
  recurrence: RecurrenceRef | null
  deletedAt: DateTimeWithZone
  purgeAt: DateTimeWithZone
}

export type TrashContents = {
  retentionDays: number
  tasks: TrashedTask[]
  /** 혼자 지운 일정. */
  schedules: TrashedSchedule[]
}

export type TaskRestoreResponse = {
  taskId: number
  restoredScheduleIds: number[]
  relinkedScheduleIds: number[]
  restoredDependencies: number
  /** 상대 작업이 없거나 사이클이 생겨 다시 걸지 못한 선후관계 수 */
  skippedDependencies: number
}

export type ScheduleRestoreResponse = {
  scheduleId: number
  linkedTaskId: number | null
}
