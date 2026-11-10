import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import { ClientGuardError } from '@shared/api/errorMessage'
import { getSelectedScope } from '@features/spaces/store'
import {
  getMetadata,
  rememberMetadata,
  getResourceRevision,
  handleResourceReadError,
  isResourceUnavailable,
  rejectResourceResponse,
  type WorkspaceMetadata,
} from '@features/spaces/metadata'
import type {
  RecurrenceCreateRequest,
  RecurrenceDeleteResponse,
  RecurrenceEditResponse,
  RecurrenceListResponse,
  RecurrenceScope,
  RecurrenceSeries,
  RecurrenceStatus,
  RecurrenceUpdateRequest,
} from '../types/recurrence'

type View = WorkspaceMetadata & {
  recurrence: RecurrenceSeries
  previous?: RecurrenceSeries | null
  impact?: RecurrenceEditResponse['impact']
}
const url = (path = '') => buildApiUrl('/workspace/recurrences' + path, 'v2')
function normalize(view: View, remember = true, revision = getResourceRevision()): RecurrenceSeries {
  const { recurrence, previous: _previous, impact: _impact, ...metadata } = view
  void _previous
  void _impact
  const result = { ...recurrence, ...metadata }
  if (remember && recurrence.id !== null &&
    !rememberMetadata('series', recurrence.id, metadata, revision))
    rejectResourceResponse(result)
  return result
}
export async function createRecurrence(payload: RecurrenceCreateRequest) {
  const revision = getResourceRevision()
  const selected = getSelectedScope()
  const {
    spaceId = selected.spaceId,
    projectId = selected.projectId,
    assigneeId,
    ...recurrence
  } = payload
  return normalize(
    await httpClient<View>(url(), {
      method: 'POST',
      json: {
        recurrence,
        ...(spaceId == null
          ? {}
          : { location: { spaceId, projectId: projectId ?? null } }),
        ...(assigneeId === undefined
          ? {}
          : { assignee: { memberId: assigneeId } }),
      },
    }),
    true,
    revision,
  )
}
export async function fetchRecurrences(
  status: RecurrenceStatus = 'ACTIVE',
): Promise<RecurrenceListResponse> {
  const revision = getResourceRevision()
  const selected = getSelectedScope()
  const query = new URLSearchParams({ status })
  if (selected.spaceId !== null) query.set('spaceId', String(selected.spaceId))
  if (selected.projectId !== null)
    query.set('projectId', String(selected.projectId))
  const views = await httpClient<View[]>(url(`?${query}`))
  return { recurrences: views.map((view) => normalize(view, true, revision))
    .filter((series) => series.id === null || !isResourceUnavailable('series', series.id, series)) }
}
export async function fetchRecurrence(id: number) {
  const revision = getResourceRevision()
  try {
    const series = normalize(await httpClient<View>(url(`/${id}`)), true, revision)
    if (isResourceUnavailable('series', id, series))
      throw new ClientGuardError('반복 접근 권한이 변경됐습니다. 목록에서 다시 확인해 주세요.')
    return series
  } catch (error) {
    handleResourceReadError('series', id, error, revision)
    throw error
  }
}
async function versionOf(id: number, expectedVersion?: number) {
  if (expectedVersion !== undefined) return expectedVersion
  return (
    getMetadata('series', id)?.version ?? (await fetchRecurrence(id)).version
  )
}
export async function updateRecurrence(
  id: number,
  payload: RecurrenceUpdateRequest,
  dryRun = false,
): Promise<RecurrenceEditResponse> {
  const { expectedVersion, spaceId, projectId, assigneeId, ...recurrence } =
    payload
  const version = await versionOf(id, expectedVersion)
  const revision = getResourceRevision()
  if (version === undefined)
    throw new ClientGuardError('반복을 다시 열어 최신 버전을 확인해 주세요.')
  const view = await httpClient<
    View & { impact: RecurrenceEditResponse['impact'] }
  >(url(`/${id}?dryRun=${dryRun}`), {
    method: 'PATCH',
    json: {
      expectedVersion: version,
      recurrence,
      ...(spaceId === undefined
        ? {}
        : { location: { spaceId, projectId: projectId ?? null } }),
      ...(assigneeId === undefined
        ? {}
        : { assignee: { memberId: assigneeId } }),
    },
  })
  return {
    series: normalize(view, !dryRun, revision),
    previous: view.previous ?? null,
    impact: view.impact,
  }
}
export async function deleteRecurrence(
  id: number,
  scope: RecurrenceScope,
  fromDate?: string,
  dryRun = false,
  expectedVersion?: number,
) {
  const version = await versionOf(id, expectedVersion)
  if (version === undefined)
    throw new ClientGuardError('반복을 다시 열어 최신 버전을 확인해 주세요.')
  const query = new URLSearchParams({
    scope,
    dryRun: String(dryRun),
    expectedVersion: String(version),
  })
  if (fromDate) query.set('fromDate', fromDate)
  return httpClient<RecurrenceDeleteResponse>(url(`/${id}?${query}`), {
    method: 'DELETE',
  })
}
