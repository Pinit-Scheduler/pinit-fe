import { useEffect, useMemo, useState } from 'react'
import type dayjs from 'dayjs'
import { toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import { onScheduleChanged } from '@shared/utils/events'
import { fetchWeeklySchedules } from '../api/schedules'
import { monthWeekStarts, summarizeByDate, type DaySummary } from '../utils/monthGrid'

type UseMonthlySchedulesReturn = {
  summaryByDate: Record<string, DaySummary>
  isLoading: boolean
  error: string | null
}

/**
 * 월간 달력용 날짜별 일정 요약. 월 범위 API가 없으므로 달력에 보이는 주마다 주간 API를 한 번씩 부른다.
 * 일정이 바뀌면 다시 받는다.
 */
const useMonthlySchedules = (month: dayjs.Dayjs, enabled = true): UseMonthlySchedulesReturn => {
  const monthKey = month.format('YYYY-MM')
  // month는 렌더마다 새 dayjs 객체라, 달(YYYY-MM)이 바뀔 때만 주 목록을 다시 만들어 재요청을 막는다.
  const weekStarts = useMemo(() => monthWeekStarts(month), [monthKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [summaryByDate, setSummaryByDate] = useState<Record<string, DaySummary>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => onScheduleChanged(() => setVersion((value) => value + 1)), [])

  useEffect(() => {
    if (!enabled) return
    let isMounted = true

    const fetchMonth = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const weeks = await Promise.all(weekStarts.map((week) => fetchWeeklySchedules(toApiDateTimeWithZone(week.hour(12)))))
        if (isMounted) setSummaryByDate(summarizeByDate(weeks.flat(), (schedule) => toDateKey(schedule.date)))
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : '월간 일정을 불러오지 못했어요.')
        setSummaryByDate({})
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    void fetchMonth()
    return () => {
      isMounted = false
    }
  }, [enabled, weekStarts, version])

  return { summaryByDate, isLoading, error }
}

export default useMonthlySchedules
