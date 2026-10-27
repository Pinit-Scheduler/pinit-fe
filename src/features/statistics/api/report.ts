import { buildApiUrl } from '@shared/api/config'
import { httpClient } from '@shared/api/httpClient'
import type {
  PeriodStatisticsResponse,
  RecurrenceStatisticsListResponse,
  StatisticsTrendResponse,
  StatisticsUnit,
} from '../types/report'

const REPORT_API_VERSION = 'v2'

const withQuery = (path: string, params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value))
  })
  const text = query.toString()
  return buildApiUrl(text ? `${path}?${text}` : path, REPORT_API_VERSION)
}

/** 한 주(월요일 시작) 또는 한 달(1일 시작). start를 생략하면 지금이 속한 기간이다. */
export const fetchPeriodStatistics = (unit: StatisticsUnit, start?: string) =>
  httpClient<PeriodStatisticsResponse>(withQuery('/statistics/period', { unit, start }))

/** end로 끝나는 연속 기간, 오래된 것부터. count를 생략하면 주 8개, 달 6개다. */
export const fetchStatisticsTrend = (unit: StatisticsUnit, end?: string, count?: number) =>
  httpClient<StatisticsTrendResponse>(withQuery('/statistics/trend', { unit, end, count }))

/** 진행 중인(또는 끝난) 반복 시리즈별 완료율과 연속 기록. */
export const fetchRecurrenceStatistics = (status: 'ACTIVE' | 'ENDED' = 'ACTIVE') =>
  httpClient<RecurrenceStatisticsListResponse>(withQuery('/statistics/recurrences', { status }))
