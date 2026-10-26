import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type { RoutinesRequest, RoutinesResponse } from '../types/routine'

const ROUTINE_API_VERSION = 'v2'

export const fetchRoutines = () =>
  httpClient<RoutinesResponse>(buildApiUrl('/routines', ROUTINE_API_VERSION))

/**
 * 생활 시간 전체 교체. 빈 배열은 전부 지운다. 400이면 ApiError.data.errors[].field가 "routines[i].필드"이고,
 * 409면 다른 곳에서 먼저 바뀐 것이다.
 */
export const saveRoutines = (payload: RoutinesRequest) =>
  httpClient<RoutinesResponse>(buildApiUrl('/routines', ROUTINE_API_VERSION), {
    method: 'PUT',
    json: payload,
  })
