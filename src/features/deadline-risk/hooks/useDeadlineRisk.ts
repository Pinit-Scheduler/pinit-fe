import { useCallback } from 'react'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { fetchDeadlineRisk } from '../api/deadlineRisk'
import type { DeadlineRiskDays, DeadlineRiskResponse } from '../types/deadlineRisk'

export const deadlineRiskKey = (days: DeadlineRiskDays, zoneId: string) =>
  `deadline-risk/${days}@${zoneId}`

/**
 * Personal deadline forecast for a range.
 * - A refresh (task/schedule change, window focus, "다시 조회") keeps the forecast on screen.
 * - Another range or zone never shows this one's forecast.
 * - A failed read hides the forecast: an outdated capacity estimate is never shown as current.
 */
export default function useDeadlineRisk(days: DeadlineRiskDays, zoneId: string) {
  const fetcher = useCallback(
    (signal: AbortSignal) => fetchDeadlineRisk(days, signal),
    [days],
  )
  const query = useRevalidatingQuery<DeadlineRiskResponse>(deadlineRiskKey(days, zoneId), fetcher, {
    invalidateOn: ['task', 'schedule'],
    group: 'deadline-risk/',
    refetchOnFocus: true,
    errorMessage: '마감 위험 예보를 불러오지 못했어요.',
  })
  const forecast = query.error ? null : (query.data ?? null)
  return {
    forecast,
    error: query.error,
    /** No forecast to show and a read is running: the only time to say it is calculating. */
    isLoading: forecast === null && (query.isInitialLoading || query.isFetching),
    /** A read is running behind the forecast on screen. */
    isRefreshing: forecast !== null && query.isFetching,
    refresh: query.refetch,
  }
}
