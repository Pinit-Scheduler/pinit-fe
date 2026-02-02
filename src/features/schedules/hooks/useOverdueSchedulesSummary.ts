import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import type { OverdueSummary, ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { getTodayWithOffset, toApiDateTimeWithZone, toDateFromApi, toDateKey } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { onScheduleChanged } from '@shared/utils/events'

/**
 * 미완료된 일정 요약 정보를 반환하는 커스텀 훅
 * @returns 미완료된 일정 요약 정보, 로딩 상태, 재조회 함수
 */
const useOverdueSchedulesSummary = () => {
  const [summary, setSummary] = useState<OverdueSummary>({ hasOverdue: false })
  const [isLoading, setIsLoading] = useState(true)
  const [timestamp, setTimestamp] = useState(() => Date.now())
  const { offsetMinutes } = useTimePreferences()

  useEffect(() => {
    let isMounted = true

    const fetchSummary = async () => {
      setIsLoading(true)
      try {
        const today = getTodayWithOffset(offsetMinutes)
        const todayKey = toDateKey(today)

        // 현재 주의 일정을 조회 (v1 주간 API)
        const schedules = await fetchWeeklySchedules(toApiDateTimeWithZone(today))

        // 오늘 이전 날짜의 미완료 일정 필터링
        const overdueSchedules = schedules.filter((schedule: ScheduleResponse) => {
          const scheduleDate = toDateKey(schedule.date)
          const isBeforeToday = dayjs(scheduleDate).isBefore(todayKey, 'day')
          const isNotCompleted = schedule.state !== 'COMPLETED'
          return isBeforeToday && isNotCompleted
        })

        if (isMounted) {
          if (overdueSchedules.length > 0) {
            // 가장 오래된 일정 찾기
            const earliest = overdueSchedules.reduce((earliest: ScheduleResponse, current: ScheduleResponse) => {
              return dayjs(toDateFromApi(current.date)).isBefore(toDateFromApi(earliest.date)) ? current : earliest
            }, overdueSchedules[0])

            setSummary({
              hasOverdue: true,
              count: overdueSchedules.length,
              earliestDate: toDateKey(earliest.date),
            })
          } else {
            setSummary({ hasOverdue: false })
          }
        }
      } catch {
        // 에러 시 hasOverdue: false로 설정
        if (isMounted) {
          setSummary({ hasOverdue: false })
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchSummary()

    return () => {
      isMounted = false
    }
  }, [offsetMinutes, timestamp])

  useEffect(() => {
    const unsubscribe = onScheduleChanged(() => setTimestamp(Date.now()))
    return unsubscribe
  }, [])

  return {
    summary,
    isLoading,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useOverdueSchedulesSummary
