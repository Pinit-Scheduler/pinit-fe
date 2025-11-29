import { useEffect, useMemo, useState } from 'react'
import type dayjs from 'dayjs'
import { getWeekDays, toDateKey } from '../utils/datetime'
import type { DateSchedulePresence } from '../types/schedule'
import type { ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { useScheduleCache } from '../context/ScheduleCacheContext'

type Options = {
  weekStart: dayjs.Dayjs
}

type UseWeeklySchedulePresenceReturn = {
  presenceMap: DateSchedulePresence
  isLoading: boolean
  refetch: () => void
}

const useWeeklySchedulePresence = ({ weekStart }: Options): UseWeeklySchedulePresenceReturn => {
  const { setDateSchedules } = useScheduleCache()
  const [presenceMap, setPresenceMap] = useState<DateSchedulePresence>({})
  const [isLoading, setIsLoading] = useState(true)
  const [requestId, setRequestId] = useState(() => Date.now())

  const dateKeys = useMemo(() => getWeekDays(weekStart).map(toDateKey), [weekStart])

  useEffect(() => {
    let isMounted = true

    const fetchPresence = async () => {
      setIsLoading(true)
      try {
        // 주간 일정을 한 번에 조회
        const time = weekStart.toISOString()
        const schedules = await fetchWeeklySchedules(time)

        // 날짜별로 일정 그룹화
        const schedulesByDate = schedules.reduce<Record<string, ScheduleResponse[]>>((acc, schedule) => {
          const dateKey = toDateKey(schedule.date)
          if (!acc[dateKey]) {
            acc[dateKey] = []
          }
          acc[dateKey].push(schedule)
          return acc
        }, {})

        // 각 날짜의 존재 여부 맵 생성 및 캐시 업데이트
        const map: DateSchedulePresence = {}
        dateKeys.forEach((dateKey) => {
          const schedulesForDate = schedulesByDate[dateKey] || []
          map[dateKey] = schedulesForDate.length > 0

          // 캐시에 저장 (ScheduleSummary 형식으로 변환)
          const summaries = schedulesForDate.map((s: ScheduleResponse) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            date: s.date,
            deadline: s.deadline,
            importance: s.importance,
            urgency: s.urgency,
            state: s.state,
            // taskType은 백엔드에서 제공하지 않으므로 생략
          }))
          setDateSchedules(dateKey, summaries)
        })

        if (isMounted) {
          setPresenceMap(map)
        }
      } catch {
        // 에러 시 모든 날짜를 false로 설정
        if (isMounted) {
          const map: DateSchedulePresence = {}
          dateKeys.forEach((dateKey) => {
            map[dateKey] = false
          })
          setPresenceMap(map)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKeys, requestId, weekStart])

  return {
    presenceMap,
    isLoading,
    refetch: () => setRequestId(Date.now()),
  }
}

export default useWeeklySchedulePresence

