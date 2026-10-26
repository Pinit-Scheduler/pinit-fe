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
  /** 계획 길이(ISO-8601). v2 응답에는 항상 있다 */
  plannedDuration?: string
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
  /** 계획 길이(분) 입력칸 값. 비우면 서버 기본값(새 일정 30분)이나 기존 값 */
  plannedDurationMinutes?: string
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
  /** 계획 길이(ISO-8601) */
  plannedDuration?: string
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
