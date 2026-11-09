import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type {
  DayReplanApplyRequest,
  DayReplanApplyResponse,
  DayReplanPreview,
  DayReplanRequest,
} from '../types/replan'

export const previewDayReplan = (payload: DayReplanRequest, signal?: AbortSignal) =>
  httpClient<DayReplanPreview>(buildApiUrl('/plans/replan', 'v2'), {
    method: 'POST',
    json: payload,
    signal,
  })

export const applyDayReplan = (payload: DayReplanApplyRequest) =>
  httpClient<DayReplanApplyResponse>(buildApiUrl('/plans/replan/apply', 'v2'), {
    method: 'POST',
    json: payload,
  })
