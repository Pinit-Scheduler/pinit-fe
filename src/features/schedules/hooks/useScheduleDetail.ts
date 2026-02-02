import { fetchScheduleDetail } from '../api/schedules'
import { useEffect, useState } from 'react'
import { useScheduleCache } from '@contexts/ScheduleCacheContext'
import type { ScheduleResponse } from '../types/schedule'

type UseScheduleDetailReturn = {
  schedule: ScheduleResponse | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const useScheduleDetail = (scheduleId?: string): UseScheduleDetailReturn => {
  const numericId = scheduleId ? Number(scheduleId) : undefined
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  const { setSchedule: cacheSchedule } = useScheduleCache()

  useEffect(() => {
    if (!numericId) {
      setSchedule(null)
      setIsLoading(false)
      setError('일정 ID가 유효하지 않습니다.')
      return
    }
    let isMounted = true

    const fetchSchedule = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchScheduleDetail(numericId)
        if (isMounted) {
          setSchedule(response)
          cacheSchedule(response)
        }
      } catch (err) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : '일정을 불러오지 못했습니다.'
          setError(message)
          setSchedule(null)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchSchedule()

    return () => {
      isMounted = false
    }
  }, [cacheSchedule, numericId, timestamp])

  return {
    schedule,
    isLoading,
    error,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useScheduleDetail
