import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type {
  RoutineOverride,
  RoutineOverrideRequest,
  RoutineOverridesResponse,
  RoutinesRequest,
  RoutinesResponse,
} from '../types/routine'

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

/** ADR-0027 날짜 예외. from 기본은 오늘, to 기본은 from + 90일(서버 기준) */
export const fetchRoutineOverrides = (range: { from?: string; to?: string } = {}) => {
  const params = new URLSearchParams()
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  const query = params.toString()
  return httpClient<RoutineOverridesResponse>(
    buildApiUrl(`/routines/overrides${query ? `?${query}` : ''}`, ROUTINE_API_VERSION),
  )
}

/**
 * 그 날짜 예외를 만들거나 통째로 바꾼다. 400이면 errors[].field가 date, note, routines, "routines[i].필드"다.
 */
export const saveRoutineOverride = (date: string, payload: RoutineOverrideRequest) =>
  httpClient<RoutineOverride>(buildApiUrl(`/routines/overrides/${date}`, ROUTINE_API_VERSION), {
    method: 'PUT',
    json: payload,
  })

/** 없어도 성공(204)이다 */
export const deleteRoutineOverride = (date: string) =>
  httpClient<void>(buildApiUrl(`/routines/overrides/${date}`, ROUTINE_API_VERSION), { method: 'DELETE' })
