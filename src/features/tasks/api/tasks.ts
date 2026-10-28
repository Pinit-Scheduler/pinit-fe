import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type {
  Task,
  TaskArchiveCursorResponse,
  TaskListResponse,
  TaskRequest,
  TaskScheduleRequest,
} from '../types/task'
import type { DateTimeWithZone } from '@shared/types/datetime'
import { toApiDateTimeWithZone } from '@shared/utils/datetime'

const TASK_API_VERSION = 'v2'

type ListParams = {
  page?: number
  size?: number
  readyOnly?: boolean
}

type TaskApiResponse = Omit<Task, 'isCompleted'> & {
  isCompleted?: boolean | null
  completed?: boolean | null
  inboundDependencyCount?: number | null
}

type PageTaskApiResponse = {
  content?: TaskApiResponse[] | null
  number?: number
  size?: number
  totalElements?: number
  totalPages?: number
  numberOfElements?: number
  first?: boolean
  last?: boolean
  empty?: boolean
}
type TaskCursorApiResponse = {
  data?: TaskApiResponse[] | null
  hasNext?: boolean
  nextCursor?: string | null
}

const normalizeTask = (task: TaskApiResponse): Task => ({
  ...task,
  inboundDependencyCount: task.inboundDependencyCount ?? 0,
  completed: task.completed ?? task.isCompleted ?? false,
  isCompleted: task.completed ?? task.isCompleted ?? false,
  previousTaskIds: task.previousTaskIds ?? [],
  nextTaskIds: task.nextTaskIds ?? [],
  tags: task.tags ?? [],
})

const normalizeTaskList = (tasks?: TaskApiResponse[] | null) => (tasks ?? []).map(normalizeTask)

export const fetchTasks = async ({ page = 0, size = 20, readyOnly = false }: ListParams): Promise<TaskListResponse> => {
  const query = new URLSearchParams({
    page: String(page),
    size: String(size),
    readyOnly: String(readyOnly),
  })
  const response = await httpClient<PageTaskApiResponse>(buildApiUrl(`/tasks?${query.toString()}`, TASK_API_VERSION))
  return {
    content: normalizeTaskList(response.content),
    number: response.number,
    size: response.size,
    totalElements: response.totalElements,
    totalPages: response.totalPages,
    numberOfElements: response.numberOfElements,
    first: response.first,
    last: response.last,
    empty: response.empty,
  }
}

const toListResponse = (response: PageTaskApiResponse): TaskListResponse => ({
  content: normalizeTaskList(response.content),
  number: response.number,
  size: response.size,
  totalElements: response.totalElements,
  totalPages: response.totalPages,
  numberOfElements: response.numberOfElements,
  first: response.first,
  last: response.last,
  empty: response.empty,
})

/**
 * 작업 검색(ADR-0023 §3). `params`는 `toSearchParams`가 만든 검색 인자다(`tagIds`는 여러 번 온다).
 */
export const searchTasks = async (
  { page = 0, size = 20, params = [] }: { page?: number; size?: number; params?: [string, string][] },
): Promise<TaskListResponse> => {
  const query = new URLSearchParams(params)
  query.set('page', String(page))
  query.set('size', String(size))
  const response = await httpClient<PageTaskApiResponse>(buildApiUrl(`/tasks/search?${query.toString()}`, TASK_API_VERSION))
  return toListResponse(response)
}

/** 그 날짜(YYYY-MM-DD)가 마감인 작업. 시간대를 주지 않으면 회원 설정 시간대로 해석한다. */
export const fetchTasksByDeadline = async (date: string, zoneId?: string): Promise<Task[]> => {
  const query = new URLSearchParams({ date })
  if (zoneId) query.set('zoneId', zoneId)
  const response = await httpClient<TaskApiResponse[]>(buildApiUrl(`/tasks/by-deadline?${query.toString()}`, TASK_API_VERSION))
  return normalizeTaskList(response)
}

export const fetchTaskArchiveByCursor = async (
  { size = 20, cursor }: { size?: number; cursor?: string | null },
): Promise<TaskArchiveCursorResponse> => {
  const query = new URLSearchParams({
    size: String(size),
  })
  if (cursor) query.set('cursor', cursor)
  const response = await httpClient<TaskCursorApiResponse>(
    buildApiUrl(`/tasks/completed?${query.toString()}`, TASK_API_VERSION),
  )
  return {
    items: normalizeTaskList(response.data),
    nextCursor: response.nextCursor ?? null,
    hasNext: response.hasNext,
  }
}

export const fetchTaskDetail = async (taskId: number) =>
  normalizeTask(await httpClient<TaskApiResponse>(buildApiUrl(`/tasks/${taskId}`, TASK_API_VERSION)))

export const createTask = async (payload: TaskRequest) =>
  normalizeTask(await httpClient<TaskApiResponse>(buildApiUrl('/tasks', TASK_API_VERSION), {
    method: 'POST',
    json: payload,
  }))

export const updateTask = async (taskId: number, payload: TaskRequest) =>
  normalizeTask(await httpClient<TaskApiResponse>(buildApiUrl(`/tasks/${taskId}`, TASK_API_VERSION), {
    method: 'PATCH',
    json: payload,
  }))

export const deleteTask = (taskId: number, deleteSchedules = false) => {
  const query = new URLSearchParams({
    deleteSchedules: String(deleteSchedules),
  })
  return httpClient<void>(buildApiUrl(`/tasks/${taskId}?${query.toString()}`, TASK_API_VERSION), {
    method: 'DELETE',
  })
}

export const completeTask = (taskId: number) =>
  httpClient<void>(buildApiUrl(`/tasks/${taskId}/complete`, TASK_API_VERSION), {
    method: 'POST',
  })

export const reopenTask = (taskId: number) =>
  httpClient<void>(buildApiUrl(`/tasks/${taskId}/reopen`, TASK_API_VERSION), {
    method: 'POST',
  })

export const createScheduleFromTask = (taskId: number, payload: TaskScheduleRequest | { date: DateTimeWithZone; scheduleType: TaskScheduleRequest['scheduleType']; title?: string; description?: string }) =>
  httpClient<void>(buildApiUrl(`/tasks/${taskId}/schedules`, TASK_API_VERSION), {
    method: 'POST',
    json: {
      ...payload,
      date: toApiDateTimeWithZone(payload.date),
    },
  })
