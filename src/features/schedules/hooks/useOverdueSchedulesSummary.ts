import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import type { OverdueSummary, ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { getTodayWithOffset, toApiDateTimeWithZone, toDateFromApi, toDateKey } from '@shared/utils/datetime'
import { useTimePreferences } from '@contexts/TimePreferencesContext'
import { onScheduleChanged } from '@shared/utils/events'

type Options = { mine?: boolean }

/**
 * 미완료된 일정 요약 정보를 반환하는 커스텀 훅
 * @returns 미완료된 일정 요약 정보, 로딩 상태, 재조회 함수
 */
const useOverdueSchedulesSummary = ({ mine }: Options = {}) => {
  const [summary, setSummary] = useState<OverdueSummary>({ hasOverdue: false })
  const [isLoading, setIsLoading] = useState(true)
  // 내 일정/팀 전체를 바꾸면 이전 범위의 개수를 보여 주지 않는다.
  const audienceKey = String(mine)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
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
        const schedules = await fetchWeeklySchedules(toApiDateTimeWithZone(today), { mine })

        // 오늘 이전 날짜의 미완료 일정 필터링
        const overdueSchedules = schedules.filter((schedule: ScheduleResponse) => {
          const scheduleDate = toDateKey(schedule.date)
          const isBeforeToday = dayjs(scheduleDate).isBefore(todayKey, 'day')
          const isNotCompleted = schedule.state !== 'COMPLETED'
          return isBeforeToday && isNotCompleted
        })

        if (isMounted) {
          setLoadedKey(String(mine))
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
          setLoadedKey(String(mine))
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
  }, [mine, offsetMinutes, timestamp])

  useEffect(() => {
    const unsubscribe = onScheduleChanged(() => setTimestamp(Date.now()))
    return unsubscribe
  }, [])

  const fresh = loadedKey === audienceKey
  return {
    summary: fresh ? summary : { hasOverdue: false },
    isLoading: isLoading || !fresh,
    refetch: () => setTimestamp(Date.now()),
  }
}

export default useOverdueSchedulesSummary
