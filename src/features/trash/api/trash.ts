import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { ScheduleRestoreResponse, TaskRestoreResponse, TrashContents } from '../types/trash'

const TRASH_API_VERSION = 'v2'

/** 휴지통(ADR-0024). 없는 대상은 404, 작업과 함께 지운 일정을 따로 다루면 409(errors[0].rejectedValue = TRASHED_WITH_TASK)다. */
export const fetchTrash = () => httpClient<TrashContents>(buildApiUrl('/trash', TRASH_API_VERSION))

export const restoreTask = (taskId: number) =>
  httpClient<TaskRestoreResponse>(buildApiUrl(`/trash/tasks/${taskId}/restore`, TRASH_API_VERSION), { method: 'POST' })

export const restoreSchedule = (scheduleId: number) =>
  httpClient<ScheduleRestoreResponse>(buildApiUrl(`/trash/schedules/${scheduleId}/restore`, TRASH_API_VERSION), {
    method: 'POST',
  })

export const purgeTask = (taskId: number) =>
  httpClient<void>(buildApiUrl(`/trash/tasks/${taskId}`, TRASH_API_VERSION), { method: 'DELETE' })

export const purgeSchedule = (scheduleId: number) =>
  httpClient<void>(buildApiUrl(`/trash/schedules/${scheduleId}`, TRASH_API_VERSION), { method: 'DELETE' })

export const emptyTrash = () => httpClient<void>(buildApiUrl('/trash', TRASH_API_VERSION), { method: 'DELETE' })
