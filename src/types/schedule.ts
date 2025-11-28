export type ScheduleState =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELED'
  | 'SUSPENDED'

export type ScheduleTaskType = 'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK'

export type ScheduleResponse = {
  id: number
  ownerId: number
  title: string
  description: string
  date: string
  deadline: string
  importance: number
  urgency: number
  taskType: ScheduleTaskType
  state: ScheduleState
  estimatedMinutes?: number
  actualMinutes?: number
  createdAt: string
  updatedAt: string
}

export type DependencyRequest = {
  fromScheduleId: number
  toScheduleId: number
}

export type ScheduleRequest = {
  title: string
  description: string
  date: string
  deadline: string
  importance: number
  urgency: number
  taskType: ScheduleTaskType
  estimatedMinutes?: number
  addDependencies?: DependencyRequest[]
  removeDependencies?: DependencyRequest[]
}

export type ScheduleFormValues = {
  id?: number
  title: string
  description: string
  date: Date
  deadline: Date
  importance: number
  urgency: number
  taskType: ScheduleTaskType
  estimatedMinutes?: number
  previousTaskIds: number[]
  nextTaskIds: number[]
}

export type ScheduleSummary = {
  id: number
  title: string
  description: string
  date: string
  deadline: string
  importance: number
  urgency: number
  taskType: ScheduleTaskType
  state: ScheduleState
}

export type DateSchedulePresence = Record<string, boolean>

export type OverdueSummary = {
  hasOverdue: boolean
  count?: number
  earliestDate?: string
}

