import type { DateTimeWithZone } from './datetime'

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
  deadline: DateTimeWithZone
  importance: number
  urgency: number
  state: ScheduleState
  previousTasks?: ScheduleSummary[]
  nextTasks?: ScheduleSummary[]
}

export type DependencyRequest = {
  fromId: number
  toId: number
}

export type ScheduleRequest = {
  title: string
  description: string
  date: DateTimeWithZone
  deadline: DateTimeWithZone
  importance: number
  urgency: number
  taskType: ScheduleTaskType
  addDependencies?: DependencyRequest[]
  removeDependencies?: DependencyRequest[]
}

export type ScheduleFormValues = {
  title: string
  description: string
  date: Date
  deadline: Date
  importance: number
  urgency: number
  taskType: ScheduleTaskType
  previousTaskIds: number[]
  nextTaskIds: number[]
}

export type ScheduleSummary = {
  id: number
  ownerId: number
  title: string
  description: string
  date: DateTimeWithZone
  deadline: DateTimeWithZone
  importance: number
  urgency: number
  taskType?: ScheduleTaskType // 백엔드에서 제공하지 않을 수 있음
  state: ScheduleState
  previousTasks?: ScheduleSummary[]
  nextTasks?: ScheduleSummary[]
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
