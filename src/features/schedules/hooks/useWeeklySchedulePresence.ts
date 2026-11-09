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
  mine?: boolean
}

type UseWeeklySchedulePresenceReturn = {
  weeklySchedules: ScheduleResponse[]
  presenceMap: DateSchedulePresence
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const useWeeklySchedulePresence = ({ weekStart, anchorDate, mine }: Options): UseWeeklySchedulePresenceReturn => {
  const [presenceMap, setPresenceMap] = useState<DateSchedulePresence>({})
  const [weeklySchedules, setWeeklySchedules] = useState<ScheduleResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState(0)
  // 내 일정/팀 전체를 바꾸면 이전 범위의 결과를 보여 주지 않는다.
  const audienceKey = String(mine)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)

  const dateKeys = useMemo(() => getWeekDays(weekStart).map(toDateKey), [weekStart])

  useEffect(() => {
    let isMounted = true

    const fetchPresence = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const base = anchorDate ?? weekStart
        const time = toApiDateTimeWithZone(base.hour(12))
        const schedules = await fetchWeeklySchedules(time, { mine })
        if (!isMounted) return
        setLoadedKey(String(mine))
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
          setLoadedKey(String(mine))
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
  }, [anchorDate, dateKeys, mine, requestId, weekStart])

  useEffect(() => {
    const unsubscribe = onScheduleChanged(() => setRequestId((value) => value + 1))
    return unsubscribe
  }, [])

  const fresh = loadedKey === audienceKey
  return {
    weeklySchedules: fresh ? weeklySchedules : [],
    presenceMap: fresh ? presenceMap : {},
    isLoading: isLoading || !fresh,
    error: fresh ? error : null,
    refetch: () => setRequestId((value) => value + 1),
  }
}

export default useWeeklySchedulePresence
