import { fetchScheduleDetail } from '../api/schedules'
import { useEffect, useState } from 'react'
import { useScheduleCache } from '../context/ScheduleCacheContext'
import type { ScheduleResponse } from '../types/schedule'

type UseScheduleDetailReturn = {
  schedule: ScheduleResponse | null
  isLoading: boolean
  refetch: () => void
}

const useScheduleDetail = (scheduleId?: string): UseScheduleDetailReturn => {
  const numericId = scheduleId ? Number(scheduleId) : undefined
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  const { setSchedule: cacheSchedule } = useScheduleCache()

  useEffect(() => {
    if (!numericId) return
    let isMounted = true

    const fetchSchedule = async () => {
      setIsLoading(true)
      try {
        const response = await fetchScheduleDetail(numericId)
        if (isMounted) {
          setSchedule(response)
          cacheSchedule(response)
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
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useScheduleDetail
