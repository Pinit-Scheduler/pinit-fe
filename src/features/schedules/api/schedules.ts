import type dayjs from 'dayjs'
import dayjsFactory from 'dayjs'
import type { ScheduleResponse } from '../types/schedule'
import type { DateTimeWithZone } from '@shared/types/datetime'
import {
  toApiDateTimeWithZone,
  toDateFromApi,
  toDisplayDayjs,
} from '@shared/utils/datetime'
import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import { getSelectedScope } from '@features/spaces/store'
import {
  getMetadata,
  rememberMetadata,
  getResourceRevision,
  handleResourceReadError,
  isResourceUnavailable,
  rejectResourceResponse,
  type WorkspaceScheduleView,
} from '@features/spaces/metadata'

export const SCHEDULE_API_VERSION = 'v2'
type Time = dayjs.Dayjs | DateTimeWithZone | string | Date
type Scope = { allSpaces?: boolean; mine?: boolean }
const url = (path = '') => buildApiUrl('/workspace/schedules' + path, 'v2')
export const normalizeSchedule = (
  view: WorkspaceScheduleView<ScheduleResponse>,
  revision = getResourceRevision(),
): ScheduleResponse => {
  const { schedule, ...metadata } = view
  const result = {
    ...schedule,
    ...metadata,
    recurrence: schedule.recurrence
      ? {
          ...schedule.recurrence,
          version: metadata.recurrenceVersion ?? undefined,
        }
      : null,
  }
  if (!rememberMetadata('schedule', schedule.id,
    { ...metadata, linkedTaskId: schedule.taskId }, revision)) rejectResourceResponse(result)
  return result
}
function queryFor(time: Time, days: number, scope: Scope = {}) {
  const local = toApiDateTimeWithZone(time)
  const date = toDisplayDayjs(time)
  const first =
    days === 7
      ? date.isoWeekday(1).format('YYYY-MM-DD')
      : date.format('YYYY-MM-DD')
  const next = dayjsFactory(first).add(days, 'day').format('YYYY-MM-DD')
  const start = toDateFromApi({
    dateTime: `${first}T00:00:00`,
    zoneId: local.zoneId,
  }).toISOString()
  const end = toDateFromApi({
    dateTime: `${next}T00:00:00`,
    zoneId: local.zoneId,
  }).toISOString()
  const query = new URLSearchParams({ start, end })
  const selected = getSelectedScope()
  if (!scope.allSpaces && selected.spaceId !== null)
    query.set('spaceId', String(selected.spaceId))
  if (!scope.allSpaces && selected.projectId !== null)
    query.set('projectId', String(selected.projectId))
  if (scope.mine !== undefined) query.set('mine', String(scope.mine))
  return query
}
async function readSchedules(query: URLSearchParams) {
  const revision = getResourceRevision()
  const views = await httpClient<WorkspaceScheduleView<ScheduleResponse>[]>(url(`?${query}`))
  return views.map((view) => normalizeSchedule(view, revision))
    .filter((schedule) => !isResourceUnavailable('schedule', schedule.id, schedule))
}
export const fetchSchedules = (time: Time, scope?: Scope) =>
  readSchedules(queryFor(time, 1, scope))
export const fetchWeeklySchedules = (time: Time) => readSchedules(queryFor(time, 7))
export type ScheduleSimpleRequest = {
  title: string
  description: string
  date: DateTimeWithZone
  scheduleType: 'DEEP_WORK' | 'QUICK_TASK' | 'ADMIN_TASK'
  plannedDuration?: string
  spaceId?: number
  projectId?: number | null
  assigneeId?: number | null
  expectedVersion?: number
}
export type ScheduleSimplePatchRequest = Partial<ScheduleSimpleRequest>
export async function createSchedule(payload: ScheduleSimpleRequest) {
  const revision = getResourceRevision()
  const selected = getSelectedScope()
  const {
    spaceId = selected.spaceId,
    projectId = selected.projectId,
    assigneeId,
    expectedVersion: _version,
    ...schedule
  } = payload
  void _version
  return normalizeSchedule(
    await httpClient<WorkspaceScheduleView<ScheduleResponse>>(url(), {
      method: 'POST',
      json: {
        schedule: { ...schedule, date: toApiDateTimeWithZone(schedule.date) },
        ...(spaceId === undefined || spaceId === null
          ? {}
          : { location: { spaceId, projectId } }),
        ...(assigneeId !== undefined
          ? { assignee: { memberId: assigneeId ?? null } }
          : {}),
      },
    }),
    revision,
  )
}
export async function updateSchedule(
  scheduleId: number,
  payload: ScheduleSimplePatchRequest,
) {
  const revision = getResourceRevision()
  const { spaceId, projectId, assigneeId, expectedVersion, ...schedule } =
    payload
  const version =
    expectedVersion ?? getMetadata('schedule', scheduleId)?.version
  if (version === undefined)
    throw new Error('일정을 다시 열어 최신 상태를 확인해 주세요.')
  return normalizeSchedule(
    await httpClient<WorkspaceScheduleView<ScheduleResponse>>(
      url(`/${scheduleId}`),
      {
        method: 'PATCH',
        json: {
          expectedVersion: version,
          schedule: {
            ...schedule,
            ...(schedule.date
              ? { date: toApiDateTimeWithZone(schedule.date) }
              : {}),
          },
          ...(spaceId === undefined
            ? {}
            : { location: { spaceId, projectId: projectId ?? null } }),
          ...(assigneeId !== undefined
            ? { assignee: { memberId: assigneeId ?? null } }
            : {}),
        },
      },
    ),
    revision,
  )
}
export async function fetchScheduleDetail(scheduleId: number) {
  const revision = getResourceRevision()
  try {
    const schedule = normalizeSchedule(await httpClient<WorkspaceScheduleView<ScheduleResponse>>(
      url(`/${scheduleId}`)), revision)
    if (isResourceUnavailable('schedule', scheduleId, schedule))
      throw new Error('일정 접근 권한이 변경됐습니다. 목록에서 다시 확인해 주세요.')
    return schedule
  } catch (error) {
    handleResourceReadError('schedule', scheduleId, error, revision)
    throw error
  }
}
async function versionOf(id: number, expectedVersion?: number) {
  if (expectedVersion !== undefined) return expectedVersion
  const current = getMetadata('schedule', id) ?? (await fetchScheduleDetail(id))
  if (current.version === undefined)
    throw new Error('일정을 다시 열어 최신 상태를 확인해 주세요.')
  return current.version
}
export async function deleteSchedule(id: number, expectedVersion?: number) {
  return httpClient<void>(
    url(`/${id}?expectedVersion=${await versionOf(id, expectedVersion)}`),
    { method: 'DELETE' },
  )
}
async function changeScheduleState(
  id: number,
  action: 'START' | 'SUSPEND' | 'COMPLETE' | 'CANCEL',
  expectedVersion?: number,
) {
  const version = await versionOf(id, expectedVersion)
  const revision = getResourceRevision()
  return normalizeSchedule(
    await httpClient<WorkspaceScheduleView<ScheduleResponse>>(
      url(`/${id}/state`),
      {
        method: 'POST',
        json: { action, expectedVersion: version },
      },
    ),
    revision,
  )
}
export const startSchedule = (
  id: number,
  _at?: Time,
  expectedVersion?: number,
) => changeScheduleState(id, 'START', expectedVersion)
export const suspendSchedule = (
  id: number,
  _at?: Time,
  expectedVersion?: number,
) => changeScheduleState(id, 'SUSPEND', expectedVersion)
export const completeSchedule = (
  id: number,
  _at?: Time,
  expectedVersion?: number,
) => changeScheduleState(id, 'COMPLETE', expectedVersion)
export const cancelSchedule = (id: number, expectedVersion?: number) =>
  changeScheduleState(id, 'CANCEL', expectedVersion)
