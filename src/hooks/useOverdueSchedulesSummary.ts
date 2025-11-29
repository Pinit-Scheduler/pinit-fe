import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import type { OverdueSummary, ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { getTodayKST, toDateKey } from '../utils/datetime'

const useOverdueSchedulesSummary = () => {
  const [summary, setSummary] = useState<OverdueSummary>({ hasOverdue: false })
  const [isLoading, setIsLoading] = useState(true)
  const [timestamp, setTimestamp] = useState(() => Date.now())

  useEffect(() => {
    let isMounted = true

    const fetchSummary = async () => {
      setIsLoading(true)
      try {
        const today = getTodayKST()
        const todayKey = toDateKey(today)

        // 현재 주의 일정을 조회
        const time = today.toISOString()
        const schedules = await fetchWeeklySchedules(time)

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
              return dayjs(current.date).isBefore(dayjs(earliest.date)) ? current : earliest
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
  }, [timestamp])

  return {
    summary,
    isLoading,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useOverdueSchedulesSummary

