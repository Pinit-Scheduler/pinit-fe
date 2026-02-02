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
