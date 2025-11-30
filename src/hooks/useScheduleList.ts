import { useEffect, useMemo, useState, useCallback } from 'react'
import type dayjs from 'dayjs'
import type { ScheduleSummary } from '../types/schedule'
import { toDateKey } from '../utils/datetime'
import { fetchScheduleSummaries } from '../api/schedules'

type UseScheduleListReturn = {
  schedules: ScheduleSummary[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const useScheduleList = (selectedDate: dayjs.Dayjs): UseScheduleListReturn => {
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  const dateKey = useMemo(() => toDateKey(selectedDate), [selectedDate])

  const applySchedules = useCallback((next: ScheduleSummary[]) => {
    setSchedules(next)
  }, [])

  useEffect(() => {
    let isCancelled = false

    const fetchList = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetchScheduleSummaries(dateKey)
        if (isCancelled) return
        applySchedules(response)
      } catch (error) {
        if (isCancelled) return
        const message = error instanceof Error ? error.message : '일정을 불러오지 못했습니다.'
        setError(message)
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    fetchList()

    return () => {
      isCancelled = true
    }
  }, [applySchedules, dateKey, timestamp])

  return {
    schedules,
    isLoading,
    error,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useScheduleList
