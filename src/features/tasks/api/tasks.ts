import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import { ClientGuardError } from '@shared/api/errorMessage'
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
  getResourceRevision,
  handleResourceReadError,
  isResourceUnavailable,
  rejectResourceResponse,
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
const normalizeTask = (view: WorkspaceTaskView<TaskApiResponse>, requestRevision: number): Task => {
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
  if (!rememberMetadata('task', result.id, metadata, requestRevision))
    rejectResourceResponse(result)
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
const normalizePage = (response: PageResponse, revision: number): TaskListResponse => ({
  ...response,
  content: (response.content ?? []).map((view) => normalizeTask(view, revision))
    .filter((task) => !isResourceUnavailable('task', task.id, task)),
})
export async function fetchTasks({
  page = 0,
  size = 20,
  readyOnly = false,
  signal,
  ...scope
}: ListParams): Promise<TaskListResponse> {
  const revision = getResourceRevision()
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
    revision,
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
  const revision = getResourceRevision()
  const query = scopeQuery(new URLSearchParams(params), { spaceId, projectId })
  query.set('page', String(page))
  query.set('size', String(size))
  return normalizePage(
    await httpClient<PageResponse>(url(`?${query}`), { signal }),
    revision,
  )
}
/**
 * 그 스페이스의 담당자 없는 미완료 작업, 마감 순. 요약의 `unassigned.openCount`와 같은 작업이다
 * (BE 계약 `unassigned=true`, ADR-0030 §3 보충). 선택한 프로젝트로 좁히지 않는다.
 */
export const fetchUnassignedTasks = ({
  spaceId,
  ...paging
}: {
  spaceId: number
  page: number
  size: number
  signal?: AbortSignal
}): Promise<TaskListResponse> =>
  searchTasks({
    ...paging,
    spaceId,
    projectId: null,
    params: [
      ['status', 'OPEN'],
      ['unassigned', 'true'],
      ['sort', 'DEADLINE_ASC'],
    ],
  })
/** 담당자만 바꾼다. 작업 내용과 위치는 보내지 않으므로 그대로 남는다. */
export async function assignTask(
  taskId: number,
  memberId: number,
  expectedVersion: number,
): Promise<Task> {
  const revision = getResourceRevision()
  return normalizeTask(
    await httpClient<WorkspaceTaskView<TaskApiResponse>>(url(`/${taskId}`), {
      method: 'PATCH',
      json: { expectedVersion, assignee: { memberId } },
    }),
    revision,
  )
}
export async function fetchTasksByDeadline(
  date: string,
  zoneId?: string,
): Promise<Task[]> {
  const result: Task[] = []
  for (let page = 0; ; page++) {
    const revision = getResourceRevision()
    const query = new URLSearchParams({
      date,
      mine: 'true',
      page: String(page),
      size: '100',
    })
    if (zoneId) query.set('zoneId', zoneId)
    const response = normalizePage(
      await httpClient<PageResponse>(url(`?${query}`)),
      revision,
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
  const revision = getResourceRevision()
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
    revision,
  )
  const hasNext = !(result.last ?? result.content.length < size)
  return {
    items: result.content,
    hasNext,
    nextCursor: hasNext ? String(page + 1) : null,
  }
}
export async function fetchTaskDetail(taskId: number, signal?: AbortSignal) {
  const revision = getResourceRevision()
  try {
    const task = normalizeTask(await httpClient<WorkspaceTaskView<TaskApiResponse>>(
      url(`/${taskId}`), { signal }), revision)
    if (isResourceUnavailable('task', taskId, task))
      throw new ClientGuardError('작업 접근 권한이 바뀌었어요. 목록에서 다시 확인해 주세요.')
    return task
  } catch (error) {
    handleResourceReadError('task', taskId, error, revision)
    throw error
  }
}
export async function createTask(payload: TaskRequest) {
  const revision = getResourceRevision()
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
  return normalizeTask(response, revision)
}
export async function updateTask(taskId: number, payload: TaskRequest) {
  const revision = getResourceRevision()
  const { expectedVersion, spaceId, projectId, assigneeId, ...task } = payload
  const version = expectedVersion ?? getMetadata('task', taskId)?.version
  if (version === undefined) throw new ClientGuardError('작업을 다시 연 뒤 수정해 주세요.')
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
    revision,
  )
}
async function versionOf(taskId: number, expectedVersion?: number) {
  if (expectedVersion !== undefined) return expectedVersion
  const current = getMetadata('task', taskId) ?? (await fetchTaskDetail(taskId))
  if (current.version === undefined)
    throw new ClientGuardError('작업을 다시 열어 최신 상태를 확인해 주세요.')
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
  const revision = getResourceRevision()
  return normalizeTask(
    await httpClient<WorkspaceTaskView<TaskApiResponse>>(
      url(`/${taskId}/state`),
      { method: 'POST', json: { expectedVersion: version, action } },
    ),
    revision,
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
  const revision = getResourceRevision()
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
  rememberMetadata('schedule', view.schedule.id, { ...view, linkedTaskId: taskId }, revision)
}
