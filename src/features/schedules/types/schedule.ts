import type { DateTimeWithZone } from '@shared/types/datetime'
import type { DifficultyValue } from '@constants/difficulty'

export type ScheduleState =
  | 'NOT_STARTED'   // 미시작 - 시작 버튼만
  | 'IN_PROGRESS'   // 진행 중 - 일시정지, 취소, 완료 버튼
  | 'COMPLETED'     // 완료 - 취소 버튼만
  | 'SUSPENDED'     // 일시정지 - 시작, 취소 버튼

export type ScheduleTaskType = 'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK'

export type ScheduleResponse = {
  id: number
  ownerId: number
  title: string
  description: string
  date: DateTimeWithZone
  scheduleType: ScheduleTaskType
  state: ScheduleState
  taskId?: number
  // legacy / v0 fields (optional)
  deadline?: DateTimeWithZone
  importance?: number
  difficulty?: DifficultyValue
  duration?: string
}

export type ScheduleRequest = {
  title: string
  description: string
  date: DateTimeWithZone
  scheduleType: ScheduleTaskType
  taskId?: number
}

export type ScheduleFormValues = {
  title: string
  description: string
  date: Date
  scheduleType: ScheduleTaskType
  taskId?: number
}

export type ScheduleSummary = {
  id: number
  ownerId: number
  title: string
  description: string
  date: DateTimeWithZone
  scheduleType?: ScheduleTaskType // 백엔드에서 제공하지 않을 수 있음
  state: ScheduleState
  duration?: string
  taskId?: number
  // optional legacy fields
  deadline?: DateTimeWithZone
  importance?: number
  difficulty?: DifficultyValue
}

export type DateSchedulePresence = Record<
  string,
  {
    hasSchedule: boolean
    hasOverdue?: boolean
  }
>

export type OverdueSummary = {
  hasOverdue: boolean
  count?: number
  earliestDate?: string
}
