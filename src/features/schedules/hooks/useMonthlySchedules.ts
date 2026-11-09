import { useCallback, useEffect, useMemo, useState } from 'react'
import type dayjs from 'dayjs'
import { toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import { onScheduleChanged } from '@shared/utils/events'
import { fetchWeeklySchedules } from '../api/schedules'
import { monthWeekStarts, summarizeByDate, type DaySummary } from '../utils/monthGrid'

type UseMonthlySchedulesReturn = {
  summaryByDate: Record<string, DaySummary>
  isLoading: boolean
  error: string | null
  refetch: () => void
}

/**
 * 월간 달력용 날짜별 일정 요약. 월 범위 API가 없으므로 달력에 보이는 주마다 주간 API를 한 번씩 부른다.
 * 다른 화면에서 일정이 바뀌면(schedule:changed) 다시 받고, 이 화면에서 바꾼 뒤에는 refetch를 부른다.
 */
const useMonthlySchedules = (month: dayjs.Dayjs, enabled = true, mine?: boolean): UseMonthlySchedulesReturn => {
  const monthKey = month.format('YYYY-MM')
  // month는 렌더마다 새 dayjs 객체라, 달(YYYY-MM)이 바뀔 때만 주 목록을 다시 만들어 재요청을 막는다.
  const weekStarts = useMemo(() => monthWeekStarts(month), [monthKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const [summaryByDate, setSummaryByDate] = useState<Record<string, DaySummary>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  // 내 일정/팀 전체를 바꾸면 이전 범위의 결과를 보여 주지 않는다.
  const audienceKey = String(mine)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  const refetch = useCallback(() => setVersion((value) => value + 1), [])

  useEffect(() => onScheduleChanged(refetch), [refetch])

  useEffect(() => {
    if (!enabled) return
    let isMounted = true

    const fetchMonth = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const weeks = await Promise.all(weekStarts.map((week) => fetchWeeklySchedules(toApiDateTimeWithZone(week.hour(12)), { mine })))
        if (!isMounted) return
        setLoadedKey(String(mine))
        setSummaryByDate(summarizeByDate(weeks.flat(), (schedule) => toDateKey(schedule.date)))
      } catch (err) {
        if (!isMounted) return
        setLoadedKey(String(mine))
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
  }, [enabled, mine, weekStarts, version])

  const fresh = loadedKey === audienceKey
  return {
    summaryByDate: fresh ? summaryByDate : {},
    isLoading: isLoading || !fresh,
    error: fresh ? error : null,
    refetch,
  }
}

export default useMonthlySchedules
