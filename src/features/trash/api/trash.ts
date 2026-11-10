import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import { ClientGuardError } from '@shared/api/errorMessage'
import {
  rememberMetadata,
  getResourceRevision,
  type WorkspaceTaskView,
  type WorkspaceScheduleView,
} from '@features/spaces/metadata'
import type {
  ScheduleRestoreResponse,
  TaskRestoreResponse,
  TrashContents,
} from '../types/trash'

const url = (path: string) => buildApiUrl(path, 'v2')
export const fetchTrash = () => httpClient<TrashContents>(url('/trash'))
async function versionOf(
  kind: 'tasks' | 'schedules',
  id: number,
  expectedVersion?: number,
) {
  if (expectedVersion !== undefined) return expectedVersion
  // Undo is a new explicit action after deletion. Read the deleted row's server version.
  const contents = await fetchTrash()
  const row =
    kind === 'tasks'
      ? contents.tasks.find((item) => item.taskId === id)
      : contents.schedules.find((item) => item.scheduleId === id)
  if (!row || row.version === undefined)
    throw new ClientGuardError('휴지통 목록에서 최신 상태를 확인한 뒤 다시 시도해 주세요.')
  return row.version
}
export async function restoreTask(
  id: number,
  expectedVersion?: number,
): Promise<TaskRestoreResponse | null> {
  const version = await versionOf('tasks', id, expectedVersion)
  const revision = getResourceRevision()
  const view = await httpClient<
    WorkspaceTaskView<{ id: number }> & { restoreResult?: TaskRestoreResponse }
  >(url(`/workspace/tasks/${id}/restore`), {
    method: 'POST',
    json: { expectedVersion: version },
  })
  rememberMetadata('task', id, view, revision)
  return view.restoreResult ?? null
}
export async function restoreSchedule(
  id: number,
  expectedVersion?: number,
): Promise<ScheduleRestoreResponse | null> {
  const version = await versionOf('schedules', id, expectedVersion)
  const revision = getResourceRevision()
  const view = await httpClient<
    WorkspaceScheduleView<{ id: number }> & {
      restoreResult?: ScheduleRestoreResponse
    }
  >(url(`/workspace/schedules/${id}/restore`), {
    method: 'POST',
    json: { expectedVersion: version },
  })
  rememberMetadata('schedule', id, view, revision)
  return view.restoreResult ?? null
}
export async function purgeTask(id: number, expectedVersion?: number) {
  const version = await versionOf('tasks', id, expectedVersion)
  return httpClient<void>(
    url(`/workspace/tasks/${id}/purge?expectedVersion=${version}`),
    { method: 'DELETE' },
  )
}
export async function purgeSchedule(id: number, expectedVersion?: number) {
  const version = await versionOf('schedules', id, expectedVersion)
  return httpClient<void>(
    url(`/workspace/schedules/${id}/purge?expectedVersion=${version}`),
    { method: 'DELETE' },
  )
}
/** The existing endpoint empties only the authenticated member's personal trash. */
export const emptyTrash = () =>
  httpClient<void>(url('/trash'), { method: 'DELETE' })
