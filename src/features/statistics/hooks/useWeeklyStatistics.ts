import { useState, useEffect, useMemo } from 'react'
import type dayjs from 'dayjs'

import { fetchWeeklyStatistics } from '../api/statistics'
import { toWeeklyStatisticsView } from '@shared/utils/statisticsTransform'
import { getTodayWithOffset, toApiDateTimeWithZone } from '@shared/utils/datetime'
import type { WeeklyStatisticsView } from '../types/statistics'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { onScheduleChanged } from '@shared/utils/events'

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

const useWeeklyStatistics = (options: Options = {}): UseWeeklyStatisticsReturn => {
  const [current, setCurrent] = useState<WeeklyStatisticsView | null>(null)
  const [previous, setPrevious] = useState<WeeklyStatisticsView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
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
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    const fetchStats = async () => {
      setIsLoading(true)
      setError(null)

      console.log('📊 Fetching weekly statistics...')

      try {
        console.log('📊 Request params:', { time: timeParam })

        const response = await fetchWeeklyStatistics({ time: timeParam })

        console.log('📊 API Response:', response)

        const view = toWeeklyStatisticsView(response)

        console.log('📊 Transformed view:', view)

        let previousView: WeeklyStatisticsView | null = null
        try {
          const previousResponse = await fetchWeeklyStatistics({
            time: previousTimeParam,
          })
          previousView = toWeeklyStatisticsView(previousResponse)
          console.log('📊 Previous week view:', previousView)
        } catch (prevError) {
          console.warn('⚠️ Failed to fetch previous week statistics:', prevError)
        }

        if (isMounted) {
          setCurrent(view)
          setPrevious(previousView)
          setLoadedKey(weekKey)
        }
      } catch (err) {
        console.error('❌ statistics fetch error:', err)
        if (isMounted) {
          setError(err instanceof Error ? err.message : '통계를 불러오는데 실패했습니다.')
          setLoadedKey(weekKey)
        }
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    fetchStats()
    return () => {
      isMounted = false
    }
  }, [timestamp, timeParam, previousTimeParam, weekKey])

  useEffect(() => {
    const unsubscribe = onScheduleChanged(() => setTimestamp(Date.now()))
    return unsubscribe
  }, [])

  const fresh = loadedKey === weekKey
  return {
    current: fresh ? current : null,
    previous: fresh ? previous : null,
    isLoading: !fresh,
    isRefreshing: fresh && isLoading,
    error: fresh ? error : null,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useWeeklyStatistics
