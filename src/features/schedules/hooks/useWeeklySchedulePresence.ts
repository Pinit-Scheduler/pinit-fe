import { useEffect, useMemo, useState } from 'react'
import type dayjs from 'dayjs'
import { getWeekDays, toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import type { DateSchedulePresence } from '../types/schedule'
import type { ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { onScheduleChanged } from '@shared/utils/events'

type Options = {
  weekStart: dayjs.Dayjs
  anchorDate?: dayjs.Dayjs
}

type UseWeeklySchedulePresenceReturn = {
  weeklySchedules: ScheduleResponse[]
  presenceMap: DateSchedulePresence
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const useWeeklySchedulePresence = ({ weekStart, anchorDate }: Options): UseWeeklySchedulePresenceReturn => {
  const [presenceMap, setPresenceMap] = useState<DateSchedulePresence>({})
  const [weeklySchedules, setWeeklySchedules] = useState<ScheduleResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState(() => Date.now())

  const dateKeys = useMemo(() => getWeekDays(weekStart).map(toDateKey), [weekStart])

  useEffect(() => {
    let isMounted = true

    const fetchPresence = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const base = anchorDate ?? weekStart
        const time = toApiDateTimeWithZone(base.hour(12))
        const schedules = await fetchWeeklySchedules(time)
        if (!isMounted) return
        setWeeklySchedules(schedules)

        // 날짜별로 일정 그룹화
        const schedulesByDate = schedules.reduce<Record<string, ScheduleResponse[]>>(
          (acc, schedule) => {
            const dateKey = toDateKey(schedule.date)
            if (!acc[dateKey]) {
              acc[dateKey] = []
            }
            acc[dateKey].push(schedule)
            return acc
          },
          {},
        )

        // 각 날짜의 존재 여부 맵 생성 및 캐시 업데이트
        const map: DateSchedulePresence = {}
        dateKeys.forEach((dateKey) => {
          const schedulesForDate = schedulesByDate[dateKey] || []
          const hasSchedule = schedulesForDate.length > 0
          const hasOverdue = schedulesForDate.some(
            (item) => item.state !== 'COMPLETED',
          )
          map[dateKey] = { hasSchedule, hasOverdue }
        })

        if (isMounted) {
          setPresenceMap(map)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : '주간 일정을 불러오지 못했습니다.')
        }
        // 에러 시 모든 날짜를 false로 설정
        if (isMounted) {
          const emptyMap: DateSchedulePresence = {}
          dateKeys.forEach((dateKey) => {
            emptyMap[dateKey] = { hasSchedule: false, hasOverdue: false }
          })
          setPresenceMap(emptyMap)
          setWeeklySchedules([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchPresence()

    return () => {
      isMounted = false
    }
  }, [anchorDate, dateKeys, requestId, weekStart])

  useEffect(() => {
    const unsubscribe = onScheduleChanged(() => setRequestId(Date.now()))
    return unsubscribe
  }, [])

  return {
    weeklySchedules,
    presenceMap,
    isLoading,
    error,
    refetch: () => setRequestId(Date.now()),
  }
}

export default useWeeklySchedulePresence
