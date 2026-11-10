import { useMemo } from 'react'
import type dayjs from 'dayjs'
import { getWeekDays, toApiDateTimeWithZone, toDateKey } from '@shared/utils/datetime'
import type { DateSchedulePresence } from '../types/schedule'
import type { ScheduleResponse } from '../types/schedule'
import { fetchWeeklySchedules } from '../api/schedules'
import { useRevalidatingQuery } from '@shared/hooks/useRevalidatingQuery'
import { useSpaces } from '@features/spaces/store'

type Options = {
  weekStart: dayjs.Dayjs
  /** Kept for callers. The ISO week of any day in it is the same week, so it does not change the read. */
  anchorDate?: dayjs.Dayjs
  mine?: boolean
}

type UseWeeklySchedulePresenceReturn = {
  weeklySchedules: ScheduleResponse[]
  presenceMap: DateSchedulePresence
  /** Nothing loaded for this week and audience yet. */
  isLoading: boolean
  /** A refetch is running while this week's presence stays on screen. */
  isRefreshing: boolean
  error: string | null
  refetch: () => void
}

const EMPTY_SCHEDULES: ScheduleResponse[] = []

const useWeeklySchedulePresence = ({ weekStart, mine }: Options): UseWeeklySchedulePresenceReturn => {
  const dateKeys = useMemo(() => getWeekDays(weekStart).map(toDateKey), [weekStart])
  const time = toApiDateTimeWithZone(weekStart.hour(12))
  const { selectedSpaceId, selectedProjectId } = useSpaces()
  // Keyed on the week, not the selected day: picking another day in the same week reads nothing.
  // 내 일정/팀 전체나 주를 바꾸면 이전 범위의 결과를 보여 주지 않는다.
  const key = `schedules/week/${dateKeys[0]}@${time.zoneId}/${String(mine)}/${selectedSpaceId ?? 'all'}/${selectedProjectId ?? 'all'}`
  const query = useRevalidatingQuery<ScheduleResponse[]>(
    key,
    () => fetchWeeklySchedules(time, { mine }),
    { invalidateOn: ['schedule'], group: 'schedules/week/', errorMessage: '주간 일정을 불러오지 못했어요.' },
  )
  const weeklySchedules = query.data ?? EMPTY_SCHEDULES

  const presenceMap = useMemo(() => {
    const map: DateSchedulePresence = {}
    if (query.data === undefined && query.error === null) return map
    // 날짜별 일정 그룹화. 실패했으면 모든 날짜를 false로 둔다.
    const byDate = weeklySchedules.reduce<Record<string, ScheduleResponse[]>>((acc, schedule) => {
      const dateKey = toDateKey(schedule.date)
      ;(acc[dateKey] ??= []).push(schedule)
      return acc
    }, {})
    dateKeys.forEach((dateKey) => {
      const forDate = byDate[dateKey] || []
      map[dateKey] = {
        hasSchedule: forDate.length > 0,
        hasOverdue: forDate.some((item) => item.state !== 'COMPLETED'),
      }
    })
    return map
  }, [dateKeys, query.data, query.error, weeklySchedules])

  return {
    weeklySchedules,
    presenceMap,
    isLoading: query.isInitialLoading,
    isRefreshing: query.isRefreshing,
    error: query.error,
    refetch: query.refetch,
  }
}

export default useWeeklySchedulePresence
