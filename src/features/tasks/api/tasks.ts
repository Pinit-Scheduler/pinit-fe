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
import { getSelectedScope } from '@features/spaces/store'
import {
  getMetadata,
  rememberMetadata,
  type WorkspaceTaskView,
  type WorkspaceScheduleView,
} from '@features/spaces/metadata'
import type { ScheduleResponse } from '@features/schedules/types/schedule'

type TaskApiResponse = Omit<Task, 'isCompleted'> & {
  isCompleted?: boolean | null
  completed?: boolean | null
  inboundDependencyCount?: number | null
}
type PageResponse = {
  content?: WorkspaceTaskView<TaskApiResponse>[]
  number?: number
  size?: number
  totalElements?: number
  totalPages?: number
  numberOfElements?: number
  first?: boolean
  last?: boolean
  empty?: boolean
}
type ListParams = {
  page?: number
  size?: number
  readyOnly?: boolean
  signal?: AbortSignal
  spaceId?: number | null
  projectId?: number | null
  mine?: boolean
}
const url = (path = '') => buildApiUrl('/workspace/tasks' + path, 'v2')
const normalizeTask = (view: WorkspaceTaskView<TaskApiResponse>): Task => {
  const { task, ...metadata } = view
  const result: Task = {
    ...task,
    ...metadata,
    recurrence: task.recurrence
      ? { ...task.recurrence, version: metadata.recurrenceVersion ?? undefined }
      : null,
    completed: task.completed ?? task.isCompleted ?? false,
    isCompleted: task.completed ?? task.isCompleted ?? false,
    inboundDependencyCount: task.inboundDependencyCount ?? undefined,
    previousTaskIds: task.previousTaskIds ?? [],
    nextTaskIds: task.nextTaskIds ?? [],
    tags: task.tags ?? [],
  }
  rememberMetadata('task', result.id, metadata)
  return result
}
function scopeQuery(
  query: URLSearchParams,
  params: Pick<ListParams, 'spaceId' | 'projectId' | 'mine'> = {},
) {
  const selected = getSelectedScope()
  const spaceId =
    params.spaceId === undefined ? selected.spaceId : params.spaceId
  const projectId =
    params.projectId === undefined ? selected.projectId : params.projectId
  if (spaceId !== null && spaceId !== undefined)
    query.set('spaceId', String(spaceId))
  if (projectId !== null && projectId !== undefined)
    query.set('projectId', String(projectId))
  if (params.mine !== undefined) query.set('mine', String(params.mine))
  return query
}
const normalizePage = (response: PageResponse): TaskListResponse => ({
  ...response,
  content: (response.content ?? []).map(normalizeTask),
})
export async function fetchTasks({
  page = 0,
  size = 20,
  readyOnly = false,
  signal,
  ...scope
}: ListParams): Promise<TaskListResponse> {
  const query = scopeQuery(
    new URLSearchParams({
      page: String(page),
      size: String(size),
      readyOnly: String(readyOnly),
    }),
    scope,
  )
  return normalizePage(
    await httpClient<PageResponse>(url(`?${query}`), { signal }),
  )
}
export async function searchTasks({
  page = 0,
  size = 20,
  params = [],
  signal,
  spaceId,
  projectId,
}: {
  spaceId?: number | null
  projectId?: number | null
  page?: number
  size?: number
  params?: [string, string][]
  signal?: AbortSignal
}): Promise<TaskListResponse> {
  const query = scopeQuery(new URLSearchParams(params), { spaceId, projectId })
  query.set('page', String(page))
  query.set('size', String(size))
  return normalizePage(
    await httpClient<PageResponse>(url(`?${query}`), { signal }),
  )
}
export async function fetchTasksByDeadline(
  date: string,
  zoneId?: string,
): Promise<Task[]> {
  const result: Task[] = []
  for (let page = 0; ; page++) {
    const query = new URLSearchParams({
      date,
      mine: 'true',
      page: String(page),
      size: '100',
    })
    if (zoneId) query.set('zoneId', zoneId)
    const response = normalizePage(
      await httpClient<PageResponse>(url(`?${query}`)),
    )
    result.push(...response.content)
    if (response.last ?? response.content.length < 100) break
  }
  return result
}
export async function fetchTaskArchiveByCursor({
  size = 20,
  cursor,
  signal,
}: {
  size?: number
  cursor?: string | null
  signal?: AbortSignal
}): Promise<TaskArchiveCursorResponse> {
  const page = /^\d+$/.test(cursor ?? '') ? Number(cursor) : 0
  const query = scopeQuery(
    new URLSearchParams({
      page: String(page),
      size: String(size),
      status: 'COMPLETED',
    }),
  )
  const result = normalizePage(
    await httpClient<PageResponse>(url(`?${query}`), { signal }),
  )
  const hasNext = !(result.last ?? result.content.length < size)
  return {
    items: result.content,
    hasNext,
    nextCursor: hasNext ? String(page + 1) : null,
  }
}
export const fetchTaskDetail = async (taskId: number, signal?: AbortSignal) =>
  normalizeTask(
    await httpClient<WorkspaceTaskView<TaskApiResponse>>(url(`/${taskId}`), {
      signal,
    }),
  )
export async function createTask(payload: TaskRequest) {
  const selected = getSelectedScope()
  const {
    spaceId = selected.spaceId,
    projectId = selected.projectId,
    assigneeId,
    expectedVersion: _version,
    ...task
  } = payload
  void _version
  const response = await httpClient<WorkspaceTaskView<TaskApiResponse>>(url(), {
    method: 'POST',
    json: {
      task,
      ...(spaceId === null || spaceId === undefined
        ? {}
        : { location: { spaceId, projectId } }),
      ...(assigneeId !== undefined
        ? { assignee: { memberId: assigneeId ?? null } }
        : {}),
    },
  })
  return normalizeTask(response)
}
export async function updateTask(taskId: number, payload: TaskRequest) {
  const { expectedVersion, spaceId, projectId, assigneeId, ...task } = payload
  const version = expectedVersion ?? getMetadata('task', taskId)?.version
  if (version === undefined) throw new Error('작업을 다시 연 뒤 수정해 주세요.')
  return normalizeTask(
    await httpClient<WorkspaceTaskView<TaskApiResponse>>(url(`/${taskId}`), {
      method: 'PATCH',
      json: {
        expectedVersion: version,
        task,
        ...(spaceId === undefined
          ? {}
          : { location: { spaceId, projectId: projectId ?? null } }),
        ...(assigneeId !== undefined
          ? { assignee: { memberId: assigneeId ?? null } }
          : {}),
      },
    }),
  )
}
async function versionOf(taskId: number, expectedVersion?: number) {
  if (expectedVersion !== undefined) return expectedVersion
  const current = getMetadata('task', taskId) ?? (await fetchTaskDetail(taskId))
  if (current.version === undefined)
    throw new Error('작업을 다시 열어 최신 상태를 확인해 주세요.')
  return current.version
}
export async function deleteTask(
  taskId: number,
  deleteSchedules = false,
  expectedVersion?: number,
) {
  const version = await versionOf(taskId, expectedVersion)
  return httpClient<void>(
    url(
      `/${taskId}?expectedVersion=${version}&deleteSchedules=${deleteSchedules}`,
    ),
    { method: 'DELETE' },
  )
}
async function changeTaskState(
  taskId: number,
  action: 'COMPLETE' | 'REOPEN',
  expectedVersion?: number,
) {
  const version = await versionOf(taskId, expectedVersion)
  return normalizeTask(
    await httpClient<WorkspaceTaskView<TaskApiResponse>>(
      url(`/${taskId}/state`),
      { method: 'POST', json: { expectedVersion: version, action } },
    ),
  )
}
export const completeTask = (taskId: number, expectedVersion?: number) =>
  changeTaskState(taskId, 'COMPLETE', expectedVersion)
export const reopenTask = (taskId: number, expectedVersion?: number) =>
  changeTaskState(taskId, 'REOPEN', expectedVersion)
export async function createScheduleFromTask(
  taskId: number,
  payload:
    | TaskScheduleRequest
    | {
        date: DateTimeWithZone
        scheduleType: TaskScheduleRequest['scheduleType']
        title?: string
        description?: string
      },
  capturedVersion?: number,
) {
  const expectedVersion = await versionOf(taskId, capturedVersion)
  const view = await httpClient<WorkspaceScheduleView<ScheduleResponse>>(
    url(`/${taskId}/schedule`),
    {
      method: 'POST',
      json: {
        expectedVersion,
        schedule: { ...payload, date: toApiDateTimeWithZone(payload.date) },
      },
    },
  )
  rememberMetadata('schedule', view.schedule.id, view)
}
