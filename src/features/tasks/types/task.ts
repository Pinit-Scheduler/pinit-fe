import type { DateWithOffset, DateTimeWithZone } from '@shared/types/datetime'

export type TaskDependency = {
  fromId: number
  toId: number
}

export type TaskRequest = {
  title: string
  description: string
  dueDate: DateWithOffset
  importance: number // 1~9
  difficulty: number // fibonacci values
  addDependencies?: TaskDependency[]
  removeDependencies?: TaskDependency[]
}

export type Task = {
  id: number
  title: string
  description: string
  dueDate: DateWithOffset
  importance: number
  difficulty: number
  completed: boolean
  isCompleted?: boolean
  inboundDependencyCount?: number
  previousTaskIds?: number[]
  nextTaskIds?: number[]
  ownerId?: number
  createdAt?: string
  updatedAt?: string
}

export type TaskListResponse = {
  content: Task[]
  number?: number
  size?: number
  totalElements?: number
  totalPages?: number
  numberOfElements?: number
  first?: boolean
  last?: boolean
  empty?: boolean
}

export type TaskArchiveCursorResponse = {
  items: Task[]
  nextCursor: string | null
  hasNext?: boolean
}

export type TaskScheduleRequest = {
  title?: string
  description?: string
  date: DateTimeWithZone
  scheduleType: 'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK'
}
