import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type dayjs from 'dayjs'
import type { ScheduleSummary } from '../types/schedule'
import { toDateKey } from '@shared/utils/datetime'
import { fetchSchedules } from '../api/schedules'
import { onScheduleChanged } from '@shared/utils/events'

type UseScheduleListReturn = {
  schedules: ScheduleSummary[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const useScheduleList = (selectedDate: dayjs.Dayjs): UseScheduleListReturn => {
  const cacheRef = useRef<Record<string, ScheduleSummary[]>>({})
  const [schedules, setSchedules] = useState<ScheduleSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  const displayDateKey = useMemo(() => toDateKey(selectedDate), [selectedDate])
  const apiDateTime = useMemo(() => selectedDate.hour(12), [selectedDate])

  const applySchedules = useCallback((next: ScheduleSummary[]) => {
    setSchedules(next)
    cacheRef.current[displayDateKey] = next
  }, [displayDateKey])

  useEffect(() => {
    let isCancelled = false

    const cached = cacheRef.current[displayDateKey]
    if (cached) {
      setSchedules(cached)
      setIsLoading(false)
    } else {
      setSchedules([]) // 새 날짜에서는 기존 목록을 비워 일관성 유지
      setIsLoading(true)
    }

    const fetchList = async () => {
      setError(null)

      try {
        const response = await fetchSchedules(apiDateTime)
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
  }, [apiDateTime, applySchedules, displayDateKey, timestamp])

  useEffect(() => {
    const unsubscribe = onScheduleChanged((detail) => {
      const nextKey = detail.schedule ? toDateKey((detail.schedule as ScheduleSummary).date) : null
      const affectedKeys = [detail.previousDateKey, nextKey].filter(Boolean)
      if (affectedKeys.includes(displayDateKey)) {
        setTimestamp(Date.now())
      }
    })
    return unsubscribe
  }, [displayDateKey])

  return {
    schedules,
    isLoading,
    error,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useScheduleList
