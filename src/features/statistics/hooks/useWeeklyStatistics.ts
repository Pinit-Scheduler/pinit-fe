import { useMemo } from 'react'
import type dayjs from 'dayjs'

import { fetchWeeklyStatistics } from '../api/statistics'
import { toWeeklyStatisticsView } from '@shared/utils/statisticsTransform'
import { getTodayWithOffset, toApiDateTimeWithZone } from '@shared/utils/datetime'
import type { WeeklyStatisticsView } from '../types/statistics'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import useRevalidatingQuery from '@shared/hooks/useRevalidatingQuery'

type Options = {
  weekStart?: dayjs.Dayjs
}

type UseWeeklyStatisticsReturn = {
  current: WeeklyStatisticsView | null
  previous: WeeklyStatisticsView | null
  /** Nothing loaded for this week yet. A refetch keeps the numbers and sets `isRefreshing`. */
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
  refetch: () => void
}

type WeeklyPair = {
  current: WeeklyStatisticsView
  previous: WeeklyStatisticsView | null
}

const weeklyError = (err: unknown) =>
  err instanceof Error ? err.message : '통계를 불러오는데 실패했습니다.'

/**
 * This week's statistics and the week before, for the schedules tab.
 * The numbers live in the app-wide query cache per week, so coming back to the tab shows them at once
 * and refreshes in the background. A schedule change refetches once; the numbers stay on screen meanwhile.
 * Another week's numbers are never returned.
 */
const useWeeklyStatistics = (options: Options = {}): UseWeeklyStatisticsReturn => {
  const { weekStart } = options
  const { offsetMinutes } = useTimePreferences()
  const timeBase = useMemo(() => {
    return weekStart ?? getTodayWithOffset(offsetMinutes)
  }, [offsetMinutes, weekStart])
  const timeParam = useMemo(() => toApiDateTimeWithZone(timeBase), [timeBase])
  const previousTimeParam = useMemo(
    () => toApiDateTimeWithZone(timeBase.subtract(7, 'day')),
    [timeBase],
  )
  // The week the shown numbers belong to. Another week never shows them.
  const weekKey = JSON.stringify(timeParam)

  const query = useRevalidatingQuery<WeeklyPair>(
    `weekly-statistics/${weekKey}`,
    async () => {
      const view = toWeeklyStatisticsView(await fetchWeeklyStatistics({ time: timeParam }))
      let previousView: WeeklyStatisticsView | null = null
      try {
        previousView = toWeeklyStatisticsView(
          await fetchWeeklyStatistics({ time: previousTimeParam }),
        )
      } catch (prevError) {
        console.warn('⚠️ Failed to fetch previous week statistics:', prevError)
      }
      return { current: view, previous: previousView }
    },
    {
      invalidateOn: ['schedule'],
      errorMessage: (err) => {
        console.error('❌ statistics fetch error:', err)
        return weeklyError(err)
      },
    },
  )

  return {
    current: query.data?.current ?? null,
    previous: query.data?.previous ?? null,
    isLoading: query.isInitialLoading,
    isRefreshing: query.isRefreshing,
    error: query.error,
    refetch: query.refetch,
  }
}

export default useWeeklyStatistics
