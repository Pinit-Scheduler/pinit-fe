import type { DateWithOffset, DateTimeWithZone } from '@shared/types/datetime'
import type { RecurrenceRef } from '@features/recurrence/types/recurrence'

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
  /**
   * 예상 소요시간(ISO-8601, 0 또는 5분~24시간). 생성에서 생략하면 입력 안 함(난이도 환산값 사용),
   * 수정에서 생략하면 기존 값 유지, "PT0S"는 입력 해제
   */
  expectedDuration?: string
}

export type Task = {
  id: number
  title: string
  description: string
  dueDate: DateWithOffset
  importance: number
  difficulty: number
  /** 입력한 예상 소요시간(ISO-8601). 입력하지 않았으면 null */
  expectedDuration?: string | null
  /** 유효 예상 소요시간(ISO-8601). 입력값, 없으면 난이도 환산값 */
  effectiveExpectedDuration?: string
  completed: boolean
  isCompleted?: boolean
  inboundDependencyCount?: number
  previousTaskIds?: number[]
  nextTaskIds?: number[]
  ownerId?: number
  createdAt?: string
  updatedAt?: string
  /** 반복 작업의 회차이면 시리즈와 회차 날짜(ADR-0019). 아니면 null */
  recurrence?: RecurrenceRef | null
  /** 플래너 후보가 되는 첫 날짜(YYYY-MM-DD). 반복 회차만 있다 */
  availableFrom?: string | null
  /** 놓친 반복 회차: 날짜가 지났는데 미완료 */
  missed?: boolean
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
