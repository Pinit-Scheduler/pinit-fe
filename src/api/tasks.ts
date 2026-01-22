import { buildApiUrl } from './config'
import { httpClient } from './httpClient'
import type {
  Task,
  TaskCursorResponse,
  TaskListResponse,
  TaskRequest,
  TaskScheduleRequest,
} from '../types/task'
import type { DateTimeWithZone } from '../types/datetime'
import { toApiDateTimeWithZone } from '../utils/datetime'

type ListParams = {
  page?: number
  size?: number
  readyOnly?: boolean
}

type CursorParams = {
  size?: number
  cursor?: string | null
  readyOnly?: boolean
}

type TaskApiResponse = Omit<Task, 'isCompleted'> & {
  isCompleted?: boolean | null
  state?: string | null
  status?: string | null
  completedAt?: string | null
  completionDate?: string | null
}

type TaskListApiResponse = Omit<TaskListResponse, 'content'> & { content?: TaskApiResponse[] | null }
type TaskCursorApiResponse = Omit<TaskCursorResponse, 'items'> & { items?: TaskApiResponse[] | null }

const isCompletedFlag = (value?: string | null) => {
  if (!value) return false
  const normalized = value.toLowerCase()
  return ['completed', 'complete', 'done', 'finished'].includes(normalized)
}

const normalizeTask = (task: TaskApiResponse): Task => ({
  ...task,
  isCompleted:
    typeof task.isCompleted === 'boolean'
      ? task.isCompleted
      : isCompletedFlag(task.state) ||
        isCompletedFlag(task.status) ||
        !!task.completedAt ||
        !!task.completionDate,
})

const normalizeTaskList = (tasks?: TaskApiResponse[] | null) => (tasks ?? []).map(normalizeTask)

export const fetchTasks = async ({ page = 0, size = 20, readyOnly = false }: ListParams) => {
  const query = new URLSearchParams({
    page: String(page),
    size: String(size),
    readyOnly: String(readyOnly),
  })
  const response = await httpClient<TaskListApiResponse>(buildApiUrl(`/tasks?${query.toString()}`, 'v1'))
  return {
    ...response,
    content: normalizeTaskList(response.content),
  }
}

export const fetchTasksByCursor = async ({ size = 20, cursor, readyOnly = false }: CursorParams) => {
  const query = new URLSearchParams({
    size: String(size),
    readyOnly: String(readyOnly),
  })
  if (cursor) query.set('cursor', cursor)
  const response = await httpClient<TaskCursorApiResponse>(
    buildApiUrl(`/tasks/cursor?${query.toString()}`, 'v1'),
  )
  return {
    ...response,
    items: normalizeTaskList(response.items),
  }
}

export const fetchTaskDetail = async (taskId: number) =>
  normalizeTask(await httpClient<TaskApiResponse>(buildApiUrl(`/tasks/${taskId}`, 'v1')))

export const createTask = async (payload: TaskRequest) =>
  normalizeTask(await httpClient<TaskApiResponse>(buildApiUrl('/tasks', 'v1'), {
    method: 'POST',
    json: payload,
  }))

export const updateTask = async (taskId: number, payload: TaskRequest) =>
  normalizeTask(await httpClient<TaskApiResponse>(buildApiUrl(`/tasks/${taskId}`, 'v1'), {
    method: 'PATCH',
    json: payload,
  }))

export const deleteTask = (taskId: number, deleteSchedules = false) => {
  const query = new URLSearchParams({
    deleteSchedules: String(deleteSchedules),
  })
  return httpClient<void>(buildApiUrl(`/tasks/${taskId}?${query.toString()}`, 'v1'), {
    method: 'DELETE',
  })
}

export const completeTask = (taskId: number) =>
  httpClient<void>(buildApiUrl(`/tasks/${taskId}/complete`, 'v1'), {
    method: 'POST',
  })

export const reopenTask = (taskId: number) =>
  httpClient<void>(buildApiUrl(`/tasks/${taskId}/reopen`, 'v1'), {
    method: 'POST',
  })

export const createScheduleFromTask = (taskId: number, payload: TaskScheduleRequest | { date: DateTimeWithZone; scheduleType: TaskScheduleRequest['scheduleType']; title?: string; description?: string }) =>
  httpClient<void>(buildApiUrl(`/tasks/${taskId}/schedules`, 'v1'), {
    method: 'POST',
    json: {
      ...payload,
      date: toApiDateTimeWithZone(payload.date),
    },
  })
