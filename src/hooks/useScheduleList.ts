import { useEffect, useMemo, useState } from 'react'
import type dayjs from 'dayjs'
import type { ScheduleSummary } from '../types/schedule'
import { toDateKey } from '../utils/datetime'
import { fetchScheduleSummaries } from '../api/schedules'
import { useScheduleCache } from '../context/ScheduleCacheContext'

type UseScheduleListReturn = {
  schedules: ScheduleSummary[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const useScheduleList = (selectedDate: dayjs.Dayjs): UseScheduleListReturn => {
  const { getDateSchedules, setDateSchedules } = useScheduleCache()
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  const dateKey = useMemo(() => toDateKey(selectedDate), [selectedDate])

  useEffect(() => {
    let isMounted = true

    const fetchList = async () => {
      setIsLoading(true)
      setError(null)

      console.log('🔄 useScheduleList: Starting fetch', { dateKey, timestamp })

      // 개발 중 캐시 비활성화 (문제 진단을 위해 임시로 false)
      const USE_CACHE = false

      if (USE_CACHE) {
        const cached = getDateSchedules(dateKey)
        if (cached) {
          console.log('📦 Cache HIT:', {
            dateKey,
            count: cached.length,
            items: cached.map(s => ({ id: s.id, title: s.title, state: s.state }))
          })
          setSchedules(cached)
          setIsLoading(false)
          return
        }
      }

      console.log('🌐 Cache MISS, calling API:', dateKey)

      try {
        const response = await fetchScheduleSummaries(dateKey)
        console.log('✅ API Response received:', {
          dateKey,
          count: response.length,
          items: response.map(s => ({ id: s.id, title: s.title, state: s.state }))
        })

        if (isMounted) {
          setSchedules(response)
          setDateSchedules(dateKey, response)
          console.log('💾 Data saved to state and cache')
        }
      } catch (error) {
        console.error('❌ Fetch error:', { dateKey, error })
        if (isMounted) {
          const message = error instanceof Error ? error.message : '일정을 불러오지 못했습니다.'
          setError(message)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
          console.log('✅ useScheduleList: Fetch complete', { dateKey })
        }
      }
    }

    fetchList()

    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, timestamp])

  return {
    schedules,
    isLoading,
    error,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useScheduleList
