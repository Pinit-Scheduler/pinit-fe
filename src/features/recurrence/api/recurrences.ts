import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
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

const RECURRENCE_API_VERSION = 'v2'

/** 400이면 ApiError.data.errors[].field가 "rule.days"처럼 필드를 가리킨다. 409는 errors[0].rejectedValue가 코드다. */
export const createRecurrence = (payload: RecurrenceCreateRequest) =>
  httpClient<RecurrenceSeries>(buildApiUrl('/recurrences', RECURRENCE_API_VERSION), {
    method: 'POST',
    json: payload,
  })

export const fetchRecurrences = (status: RecurrenceStatus = 'ACTIVE') =>
  httpClient<RecurrenceListResponse>(
    buildApiUrl(`/recurrences?${new URLSearchParams({ status }).toString()}`, RECURRENCE_API_VERSION),
  )

export const fetchRecurrence = (seriesId: number) =>
  httpClient<RecurrenceSeries>(buildApiUrl(`/recurrences/${seriesId}`, RECURRENCE_API_VERSION))

/** dryRun이면 아무것도 바꾸지 않고 impact만 돌려준다. */
export const updateRecurrence = (seriesId: number, payload: RecurrenceUpdateRequest, dryRun = false) =>
  httpClient<RecurrenceEditResponse>(
    buildApiUrl(`/recurrences/${seriesId}?${new URLSearchParams({ dryRun: String(dryRun) }).toString()}`, RECURRENCE_API_VERSION),
    { method: 'PATCH', json: payload },
  )

export const deleteRecurrence = (seriesId: number, scope: RecurrenceScope, fromDate?: string, dryRun = false) => {
  const query = new URLSearchParams({ scope, dryRun: String(dryRun) })
  if (fromDate) query.set('fromDate', fromDate)
  return httpClient<RecurrenceDeleteResponse>(
    buildApiUrl(`/recurrences/${seriesId}?${query.toString()}`, RECURRENCE_API_VERSION),
    { method: 'DELETE' },
  )
}
