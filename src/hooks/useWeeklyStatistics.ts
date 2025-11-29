import { useState, useEffect } from 'react'

import { fetchWeeklyStatistics } from '../api/statistics'
import { toWeeklyStatisticsView } from '../utils/statisticsTransform'
import { getTodayKST } from '../utils/datetime'
import type { WeeklyStatisticsView } from '../types/statistics'

type UseWeeklyStatisticsReturn = {
  stats: WeeklyStatisticsView | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const useWeeklyStatistics = (): UseWeeklyStatisticsReturn => {
  const [stats, setStats] = useState<WeeklyStatisticsView | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    const fetchStats = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchWeeklyStatistics({
          memberId: 1,
          time: getTodayKST().toISOString(),
        })
        const view = toWeeklyStatisticsView(response)
        if (isMounted) setStats(view)
      } catch {
        if (isMounted) setError('통계를 불러오는데 실패했습니다.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    fetchStats()
    return () => {
      isMounted = false
    }
  }, [timestamp])

  return {
    stats,
    isLoading,
    error,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useWeeklyStatistics
